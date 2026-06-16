/// <reference lib="deno.ns" />
//
// ai-generate-exercises - Gemini exercise-generator proxy Edge Function.
//
// CH7 (2026-06-07, P1-#2): exerciseService.fetchExercisesForTopic
// has invoked this function since S4, but the function file was
// never created in the fresh repo. Every call hit a 404 and the
// service silently fell back to seedExercises (the 2 hard-coded
// topics) or the inline fallback generator. In cloud mode
// Learners on Travel / Daily topics only ever saw the 2 hard-coded
// topic-generic exercises, not AI-generated ones.
//
// PURPOSE (NFR-24): keep GEMINI_API_KEY server-side. Contract
// (inferred from exerciseService.ts:208-216 and the system
// prompt at exerciseService.ts:114-147):
//   Request:  POST { topic_id: string }
//   Response: 200 { questions: ExerciseQuestion[] }  (array of 3)
//             400/401/429/500/504 as below
//
// ExerciseQuestion shape (matches exerciseService.ts:9-29):
//   { id, type ('mcq'|'cloze'|'reorder'), prompt_en, prompt_vi,
//     options? (mcq), correct_option? (mcq), sentence_with_blank?
//     (cloze), correct_answer? (cloze), scrambled_words? (reorder),
//     correct_sentence? (reorder), explanation_en, explanation_vi }
//
// RUNTIME: Deno (Deno.serve). Deployed by the USER via the
// Supabase CLI. Agent cannot deploy.
//
// verify_jwt POSTURE (NFR-25): default `verify_jwt = true`.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "gemini-2.5-flash";

/** Server-side text guards. */
const MAX_TOPIC_LEN = 100;

/** Server-side upstream budget. */
const UPSTREAM_TIMEOUT_MS = 30_000;

const GEMINI_HOST = "https://generativelanguage.googleapis.com";

/** Structured-output schema for the 3-exercise array. */
const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["mcq", "cloze", "reorder"] },
      prompt_en: { type: "string" },
      prompt_vi: { type: "string" },
      options: { type: "array", items: { type: "string" } },
      correct_option: { type: "string" },
      sentence_with_blank: { type: "string" },
      correct_answer: { type: "string" },
      scrambled_words: { type: "array", items: { type: "string" } },
      correct_sentence: { type: "string" },
      explanation_en: { type: "string" },
      explanation_vi: { type: "string" },
    },
    required: ["id", "type", "prompt_en", "prompt_vi", "explanation_en", "explanation_vi"],
  },
  minItems: 3,
  maxItems: 3,
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

/** Parse a Gemini JSON text payload. Gemini is called with
 *  responseMimeType "application/json" + a responseSchema, so `raw`
 *  SHOULD already be valid JSON, but it MIGHT occasionally arrive
 *  wrapped in ```json markdown fences. Strip fences if present, then
 *  JSON.parse. Returns undefined if parsing throws — the caller maps
 *  that to a clean ai_failed rather than emitting a malformed 200.
 *  Kept LOCAL to this Edge function (separate deploy unit; imports
 *  nothing from src/). */
function parseGeminiJson(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ParsedRequest {
  topic_id: string;
}

function validateBody(raw: unknown): { ok: true; value: ParsedRequest } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.topic_id !== "string") {
    return { ok: false, message: "topic_id is required and must be a string" };
  }
  const topic_id = body.topic_id.trim();
  if (topic_id.length === 0 || topic_id.length > MAX_TOPIC_LEN) {
    return { ok: false, message: `topic_id must be 1-${MAX_TOPIC_LEN} characters` };
  }
  return { ok: true, value: { topic_id } };
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

type GeminiOutcome =
  | { kind: "ok"; text: string }
  | { kind: "rate_limited"; retryAfter: string | null }
  | { kind: "upstream_timeout" }
  | { kind: "failed" };

async function callGemini(apiKey: string, topicId: string): Promise<GeminiOutcome> {
  const systemPrompt = `You are an English language exercise generator. Generate exactly 3 exercises for the topic "${topicId}". Return a JSON array (no markdown fences) with this structure:
[
  {
    "id": "ex-ai-1",
    "type": "mcq",
    "prompt_en": "<question in English>",
    "prompt_vi": "<question in Vietnamese>",
    "options": ["<option1>", "<option2>", "<option3>", "<option4>"],
    "correct_option": "<correct option text>",
    "explanation_en": "<explanation in English>",
    "explanation_vi": "<explanation in Vietnamese>"
  },
  {
    "id": "ex-ai-2",
    "type": "cloze",
    "prompt_en": "Fill in the blank:",
    "prompt_vi": "Điền vào chỗ trống:",
    "sentence_with_blank": "<sentence with [blank]>",
    "correct_answer": "<answer>",
    "explanation_en": "<explanation>",
    "explanation_vi": "<explanation>"
  },
  {
    "id": "ex-ai-3",
    "type": "reorder",
    "prompt_en": "Reorder the words:",
    "prompt_vi": "Sắp xếp lại các từ:",
    "scrambled_words": ["word1", "word2", ...],
    "correct_sentence": "<correct sentence lowercase>",
    "explanation_en": "<explanation>",
    "explanation_vi": "<explanation>"
  }
]
Make exercises relevant, educational, and at intermediate English level.`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: `Generate 3 English exercises for the topic: "${topicId}"` }] }],
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
    return errorResponse(500, "ai_failed", "Exercise-generation AI is not configured");
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

  const outcome = await callGemini(apiKey, validated.value.topic_id);

  switch (outcome.kind) {
    case "ok": {
      // Contract (header line 17) is { questions: ExerciseQuestion[] }, an
      // ARRAY. outcome.text is the raw Gemini JSON string, so parse it
      // server-side before wrapping. If it fails to parse or is the wrong
      // shape (not an array), return ai_failed instead of a bad 200 so the
      // client falls cleanly to its next tier (seed/inline) rather than
      // rejecting a malformed payload via isValidExerciseList.
      const questions = parseGeminiJson(outcome.text);
      if (!Array.isArray(questions)) {
        return errorResponse(500, "ai_failed", "Exercise-generation AI returned an unparseable response");
      }
      return jsonResponse(200, { questions });
    }
    case "rate_limited":
      return errorResponse(
        429,
        "rate_limited",
        "Exercise-generation AI temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined,
      );
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "Exercise-generation AI upstream timed out");
    case "failed":
      return errorResponse(500, "ai_failed", "Exercise-generation AI call failed");
  }
}

Deno.serve(handler);
