/// <reference lib="deno.ns" />
//
// ai-conversation — Gemini conversation-tutor proxy Edge Function (Deno).
//
// CH7 (2026-06-07, P1-#2): the speakingService.fetchAIConversationResponse
// call site has invoked this function since the S4 days, but the
// function file was never created in the fresh repo. Every call hit a
// 404 and the service silently fell back to the local mock
// (getMockAIResponse in speakingService.ts:73). In cloud mode
// Learners thought they were getting real AI feedback when they
// were not.
//
// PURPOSE (NFR-24): keep GEMINI_API_KEY server-side. The browser
// never holds the key on the shipped primary path. Contract
// (inferred from speakingService.ts:212-216 and the Gemini-only
// structured output schema in speakingService.ts:114-140):
//   Request:  POST { topic: string, history: ChatMessage[] }
//   Response: 200 { reply: string, feedback?: StructuredFeedback }
//             400/401/429/500/504 as below
//
// RUNTIME: Deno (Deno.serve). This file is NOT part of the Vite
// bundle and is NOT type-checked by `tsc -b` (tsconfig.app.json
// include:["src"] only). Deployed by the USER via the Supabase
// CLI (deployment-strategy.md §1) - the agent cannot deploy.
//
// verify_jwt POSTURE (NFR-25): relies on the Supabase platform
// default `verify_jwt = true`. The platform rejects any request
// without a valid Supabase JWT (HTTP 401) BEFORE this handler
// runs, so only authenticated Learners can spend Gemini quota.
// Do NOT deploy with `--no-verify-jwt` unless a decisiones.log
// exception exists.
//
// SECURITY: the key is read from runtime_secrets via the
// service_role key (NFR-24). It is NEVER read from the request
// body, NEVER returned in a response, and NEVER logged.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gemini model for the conversation tutor. Mirrors the
 *  gemini-2.5-flash default in the browser-side aiClient
 *  (PROVIDER_MODELS.gemini[0]). Pinning it here so a future
 *  rename does not silently change server behavior. */
const MODEL = "gemini-2.5-flash";

/** Server-side text guard (defense in depth; the client also
 *  trims). Matches the systemPrompt contract in
 *  speakingService.ts. */
const MAX_TOPIC_LEN = 200;
const MAX_HISTORY_LEN = 100;
const MAX_MSG_LEN = 2000;

/** Server-side upstream budget. The CLIENT also wraps the
 *  call in withTimeout; this is the server's own ceiling so
 *  the function never hangs a connection (-> 504). */
const UPSTREAM_TIMEOUT_MS = 25_000;

const GEMINI_HOST = "https://generativelanguage.googleapis.com";

/** Structured-output schema mirroring the Gemini-only path
 *  in speakingService.ts:114-140 (Change 3, BR-12). The result
 *  is ALWAYS run through parseStructuredReply (defense in
 *  depth, even though we control the schema here). */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    feedback: {
      type: "object",
      properties: {
        corrected_text: { type: "string" },
        errors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              original: { type: "string" },
              correction: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["original", "correction", "explanation"],
          },
        },
        better_phrasing: { type: "string" },
      },
      required: ["corrected_text", "errors"],
    },
  },
  required: ["reply", "feedback"],
} as const;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "rate_limited"
  | "ai_failed"
  | "upstream_timeout";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...(extraHeaders ?? {}),
    },
  });
}

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return jsonResponse(status, { error: { code, message } }, extraHeaders);
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ParsedRequest {
  topic: string;
  history: Array<{ role: string; content: string }>;
}

function validateBody(raw: unknown): { ok: true; value: ParsedRequest } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.topic !== "string") {
    return { ok: false, message: "topic is required and must be a string" };
  }
  const topic = body.topic.trim();
  if (topic.length === 0 || topic.length > MAX_TOPIC_LEN) {
    return { ok: false, message: `topic must be 1-${MAX_TOPIC_LEN} characters` };
  }

  if (!Array.isArray(body.history)) {
    return { ok: false, message: "history is required and must be an array" };
  }
  if (body.history.length > MAX_HISTORY_LEN) {
    return { ok: false, message: `history must be at most ${MAX_HISTORY_LEN} messages` };
  }
  const history: Array<{ role: string; content: string }> = [];
  for (const m of body.history) {
    if (typeof m !== "object" || m === null) {
      return { ok: false, message: "history items must be objects" };
    }
    const mm = m as Record<string, unknown>;
    if (mm.role !== "user" && mm.role !== "assistant" && mm.role !== "system") {
      return { ok: false, message: "history[].role must be 'user' | 'assistant' | 'system'" };
    }
    if (typeof mm.content !== "string") {
      return { ok: false, message: "history[].content must be a string" };
    }
    const c = mm.content.trim();
    if (c.length > MAX_MSG_LEN) {
      return { ok: false, message: `history[].content must be at most ${MAX_MSG_LEN} characters` };
    }
    history.push({ role: mm.role, content: c });
  }

  return { ok: true, value: { topic, history } };
}

// ---------------------------------------------------------------------------
// Gemini call (A10 SSRF-safe: host hardcoded)
// ---------------------------------------------------------------------------

type GeminiOutcome =
  | { kind: "ok"; text: string }
  | { kind: "rate_limited"; retryAfter: string | null }
  | { kind: "upstream_timeout" }
  | { kind: "failed" };

async function callGemini(apiKey: string, systemPrompt: string, history: Array<{ role: string; content: string }>): Promise<GeminiOutcome> {
  // Gemini message format: separate systemInstruction from contents,
  // and roles are "user" / "model" (not "assistant").
  const contents = history
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const url = `${GEMINI_HOST}/v1beta/models/${MODEL}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { kind: "upstream_timeout" };
    }
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    return { kind: "rate_limited", retryAfter: res.headers.get("Retry-After") };
  }
  if (!res.ok) {
    // Drain body but do NOT echo (could leak upstream detail).
    await res.text().catch(() => undefined);
    return { kind: "failed" };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { kind: "failed" };
  }
  const text = (data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  })?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) {
    return { kind: "failed" };
  }
  return { kind: "ok", text };
}

async function getApiKey(supabaseUrl: string, serviceKey: string): Promise<string> {
  if (!supabaseUrl || !serviceKey) return "";
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/runtime_secrets?select=value&name=eq.GEMINI_API_KEY&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!r.ok) return "";
    const rows = await r.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!row) return "";
    const v = (row as Record<string, unknown>).value;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_TEMPLATE = (topic: string): string =>
  `You are a friendly English conversation tutor helping a Vietnamese intermediate learner. The topic is "${topic}".

Respond with a SINGLE JSON object ONLY - no markdown, no code fences, no prose before or after it - with this exact shape:
{
  "reply": "your conversational response to the learner",
  "feedback": {
    "corrected_text": "the learner's last message rewritten in correct, natural English",
    "errors": [
      { "original": "the learner's exact phrase", "correction": "the corrected phrase", "explanation": "a short, encouraging explanation in simple English" }
    ],
    "better_phrasing": "an optional, more natural way to express the same idea"
  }
}

Rules:
- "reply" is REQUIRED, non-empty: keep it conversational, encouraging, intermediate level, 2-4 sentences, and ask a follow-up question to keep the conversation flowing.
- "feedback" corrects the LEARNER'S LAST message only (not your own reply).
- "corrected_text" is REQUIRED and non-empty: if the learner's message is already correct, repeat it unchanged.
- "errors" is REQUIRED and MUST be an array. If the learner made no mistakes, return an empty array []. Each item has "original", "correction", and "explanation".
- "better_phrasing" is OPTIONAL: include it only when a more natural alternative exists; otherwise omit it.`;

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "bad_request", "Method not allowed; use POST");
  }

  // Defensive auth check (platform also enforces via verify_jwt).
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return errorResponse(401, "unauthorized", "Missing or invalid authentication token");
  }

  // Server-side key only (NFR-24).
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = await getApiKey(supabaseUrl, serviceKey);
  if (!apiKey) {
    return errorResponse(500, "ai_failed", "Conversation AI is not configured");
  }

  // Parse + validate body.
  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return errorResponse(400, "bad_request", "Request body must be valid JSON");
  }
  const validated = validateBody(parsedBody);
  if (!validated.ok) {
    return errorResponse(400, "bad_request", validated.message);
  }

  const { topic, history } = validated.value;
  const outcome = await callGemini(apiKey, SYSTEM_PROMPT_TEMPLATE(topic), history);

  switch (outcome.kind) {
    case "ok":
      return jsonResponse(200, { reply: outcome.text });
    case "rate_limited":
      return errorResponse(
        429,
        "rate_limited",
        "Conversation AI temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined,
      );
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "Conversation AI upstream timed out");
    case "failed":
      return errorResponse(500, "ai_failed", "Conversation AI call failed");
  }
}

Deno.serve(handler);
