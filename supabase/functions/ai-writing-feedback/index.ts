/// <reference lib="deno.ns" />
//
// ai-writing-feedback - Gemini writing-tutor proxy Edge Function (Deno).
//
// CH7 (2026-06-07, P1-#2): writingService.submitWritingContent has
// invoked this function since S4, but the function file was never
// created in the fresh repo. Every call hit a 404 and the service
// silently fell back to analyzeGrammarMock (writingService.ts:77).
// In cloud mode Learners thought they were getting real AI
// feedback on their essays when they were not.
//
// PURPOSE (NFR-24): keep GEMINI_API_KEY server-side. Contract
// (inferred from writingService.ts:209-216 and the system
// prompt at writingService.ts:175-183):
//   Request:  POST { prompt: string, content: string }
//   Response: 200 { feedback: WritingFeedback }
//             400/401/429/500/504 as below
//
// WritingFeedback shape (matches writingService.ts:13-19):
//   {
//     overall_score: number (0-100),
//     strengths: string[],
//     errors: [{ original, corrected, explanation }],
//     suggestions: string[],
//     revised_text: string
//   }
//
// RUNTIME: Deno (Deno.serve). Deployed by the USER via the
// Supabase CLI. Agent cannot deploy.
//
// verify_jwt POSTURE (NFR-25): default `verify_jwt = true`.
// Platform rejects unauthenticated requests with 401 BEFORE
// the handler runs.
//
// SECURITY: the key is read from runtime_secrets via the
// service_role key (NFR-24). It is NEVER read from the request
// body, NEVER returned in a response, and NEVER logged.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "gemini-2.5-flash";

/** Server-side text guards. */
const MAX_PROMPT_LEN = 500;
const MAX_CONTENT_LEN = 5000;

/** Server-side upstream budget. */
const UPSTREAM_TIMEOUT_MS = 25_000;

const GEMINI_HOST = "https://generativelanguage.googleapis.com";

/** Structured-output schema mirroring WritingFeedback. The
 *  result is ALWAYS validated by the client (isValidWritingFeedback
 *  in llmValidation.ts), but schema-validity here is the first
 *  line of defense. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overall_score: { type: "number" },
    strengths: { type: "array", items: { type: "string" } },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          corrected: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["original", "corrected", "explanation"],
      },
    },
    suggestions: { type: "array", items: { type: "string" } },
    revised_text: { type: "string" },
  },
  required: ["overall_score", "strengths", "errors", "suggestions", "revised_text"],
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
  prompt: string;
  content: string;
}

function validateBody(raw: unknown): { ok: true; value: ParsedRequest } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.prompt !== "string") {
    return { ok: false, message: "prompt is required and must be a string" };
  }
  const prompt = body.prompt.trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LEN) {
    return { ok: false, message: `prompt must be 1-${MAX_PROMPT_LEN} characters` };
  }

  if (typeof body.content !== "string") {
    return { ok: false, message: "content is required and must be a string" };
  }
  const content = body.content.trim();
  if (content.length < 10) {
    return { ok: false, message: "content must be at least 10 characters" };
  }
  if (content.length > MAX_CONTENT_LEN) {
    return { ok: false, message: `content must be at most ${MAX_CONTENT_LEN} characters` };
  }

  return { ok: true, value: { prompt, content } };
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

interface GeminiOutcome {
  kind: "ok";
  text: string;
} | {
  kind: "rate_limited";
  retryAfter: string | null;
} | {
  kind: "upstream_timeout";
} | {
  kind: "failed";
}

async function callGemini(apiKey: string, prompt: string, content: string): Promise<GeminiOutcome> {
  const systemPrompt =
    `You are an English writing tutor. Analyze the student's essay and return a JSON object (no markdown fences) with this exact structure:
{
  "overall_score": <number 0-100>,
  "strengths": [<string>, ...],
  "errors": [{"original": "<wrong text>", "corrected": "<correct text>", "explanation": "<why>"}],
  "suggestions": [<string>, ...],
  "revised_text": "<improved version of the essay>"
}
Be thorough but encouraging. Focus on grammar, spelling, vocabulary, and coherence.`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: `Topic: ${prompt}\n\nEssay:\n${content}` }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
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

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "bad_request", "Method not allowed; use POST");
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return errorResponse(401, "unauthorized", "Missing or invalid authentication token");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = await getApiKey(supabaseUrl, serviceKey);
  if (!apiKey) {
    return errorResponse(500, "ai_failed", "Writing-feedback AI is not configured");
  }

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

  const { prompt, content } = validated.value;
  const outcome = await callGemini(apiKey, prompt, content);

  switch (outcome.kind) {
    case "ok":
      return jsonResponse(200, { feedback: outcome.text });
    case "rate_limited":
      return errorResponse(
        429,
        "rate_limited",
        "Writing-feedback AI temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined,
      );
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "Writing-feedback AI upstream timed out");
    case "failed":
      return errorResponse(500, "ai_failed", "Writing-feedback AI call failed");
  }
}

Deno.serve(handler);
