/// <reference lib="deno.ns" />
//
// ai-generate-exercises — AI grammar/vocab exercise generator (Deno / Supabase Edge).
//
// G2 (diagnosis 2026-06-05): the client (exerciseService.ts) already calls
// supabase.functions.invoke('ai-generate-exercises', { body: { topic_id } })
// as its non-mock fallback, but this function was never created. This restores
// the server-side path.
//
// SECURITY posture mirrors ai-speech (NFR-24/25/35): server-side key from
// public.runtime_secrets, verify_jwt ON, SSRF-safe hardcoded host, sanitized
// errors. Returns { questions: ExerciseQuestion[] } matching isValidExerciseList.

const GEMINI_HOST = "https://generativelanguage.googleapis.com";
const MODEL = "gemini-2.5-flash";
const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_TOPIC_ID_LEN = 200;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ErrorCode = "bad_request" | "unauthorized" | "rate_limited" | "ai_failed" | "upstream_timeout";

function jsonResponse(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...(extra ?? {}) },
  });
}

function errorResponse(status: number, code: ErrorCode, message: string, extra?: Record<string, string>): Response {
  return jsonResponse(status, { error: { code, message } }, extra);
}

function validate(raw: unknown): { ok: true; topicId: string } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.topic_id !== "string" || body.topic_id.trim().length === 0 || body.topic_id.length > MAX_TOPIC_ID_LEN) {
    return { ok: false, message: "topic_id is required (1-200 chars)" };
  }
  return { ok: true, topicId: body.topic_id.trim() };
}

// Mirrors src/lib/llmValidation.ts isValidExerciseList so the function only
// returns a shape the client will accept (otherwise the client falls back).
function isExerciseType(t: unknown): t is "mcq" | "cloze" | "reorder" {
  return t === "mcq" || t === "cloze" || t === "reorder";
}
function okItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isExerciseType(v.type)) return false;
  if (typeof v.prompt_en !== "string" || v.prompt_en.length === 0) return false;
  switch (v.type) {
    case "mcq":
      return Array.isArray(v.options) && v.options.length >= 2 && typeof v.correct_option === "string";
    case "cloze":
      return typeof v.sentence_with_blank === "string" && typeof v.correct_answer === "string";
    case "reorder":
      return Array.isArray(v.scrambled_words) && v.scrambled_words.length > 0 && typeof v.correct_sentence === "string";
    default:
      return false;
  }
}
function isValidExerciseList(x: unknown): boolean {
  return Array.isArray(x) && x.length > 0 && x.every(okItem);
}

async function getApiKey(): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return "";
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/runtime_secrets?select=value&name=eq.GEMINI_API_KEY&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!r.ok) return "";
    const rows = await r.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const v = row ? (row as Record<string, unknown>).value : null;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

type Outcome =
  | { kind: "ok"; questions: unknown }
  | { kind: "rate_limited"; retryAfter: string | null }
  | { kind: "upstream_timeout" }
  | { kind: "failed" };

async function generate(apiKey: string, topicId: string): Promise<Outcome> {
  const systemPrompt =
    `You are an English language exercise generator. Generate exactly 3 exercises for the topic "${topicId}". ` +
    `Return a JSON array (no markdown fences) where each item is one of: ` +
    `{ "id": "<id>", "type": "mcq", "prompt_en": "<q>", "prompt_vi": "<q>", "options": ["a","b","c","d"], "correct_option": "<one option>", "explanation_en": "<e>", "explanation_vi": "<e>" } ` +
    `OR { "id": "<id>", "type": "cloze", "prompt_en": "<q>", "prompt_vi": "<q>", "sentence_with_blank": "<... [blank] ...>", "correct_answer": "<a>", "explanation_en": "<e>", "explanation_vi": "<e>" } ` +
    `OR { "id": "<id>", "type": "reorder", "prompt_en": "<q>", "prompt_vi": "<q>", "scrambled_words": ["w1","w2"], "correct_sentence": "<lowercase sentence>", "explanation_en": "<e>", "explanation_vi": "<e>" }. ` +
    `Make them relevant, educational, intermediate level.`;
  const body = {
    contents: [{ role: "user", parts: [{ text: `Generate 3 English exercises for the topic: "${topicId}"` }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.6, maxOutputTokens: 2048, responseMimeType: "application/json" },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_HOST}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { kind: "upstream_timeout" };
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) return { kind: "rate_limited", retryAfter: res.headers.get("Retry-After") };
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
  if (typeof text !== "string") return { kind: "failed" };
  let questions: unknown;
  try {
    questions = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    return { kind: "failed" };
  }
  if (!isValidExerciseList(questions)) return { kind: "failed" };
  return { kind: "ok", questions };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse(405, "bad_request", "Method not allowed; use POST");

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return errorResponse(401, "unauthorized", "Missing or invalid authentication token");
  }

  const apiKey = await getApiKey();
  if (!apiKey) return errorResponse(500, "ai_failed", "AI service is not configured");

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return errorResponse(400, "bad_request", "Request body must be valid JSON");
  }
  const v = validate(parsed);
  if (!v.ok) return errorResponse(400, "bad_request", v.message);

  const outcome = await generate(apiKey, v.topicId);
  switch (outcome.kind) {
    case "ok":
      return jsonResponse(200, { questions: outcome.questions });
    case "rate_limited":
      return errorResponse(429, "rate_limited", "AI temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined);
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "AI upstream timed out");
    case "failed":
      return errorResponse(500, "ai_failed", "AI exercise generation failed");
  }
}

Deno.serve(handler);
