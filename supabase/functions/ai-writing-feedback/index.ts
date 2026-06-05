/// <reference lib="deno.ns" />
//
// ai-writing-feedback — AI essay feedback proxy (Deno / Supabase Edge).
//
// G2 (diagnosis 2026-06-05): the client (writingService.ts) already calls
// supabase.functions.invoke('ai-writing-feedback', { body: { prompt, content } })
// as its non-mock fallback, but this function was never created. This restores
// the server-side path.
//
// SECURITY posture mirrors ai-speech (NFR-24/25/35): server-side key from
// public.runtime_secrets, verify_jwt ON, SSRF-safe hardcoded host, sanitized
// errors. Returns { feedback: WritingFeedback } matching isValidWritingFeedback.

const GEMINI_HOST = "https://generativelanguage.googleapis.com";
const MODEL = "gemini-2.5-flash";
const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_PROMPT_LEN = 500;
const MAX_CONTENT_LEN = 10_000;

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

function validate(raw: unknown): { ok: true; prompt: string; content: string } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.prompt !== "string" || body.prompt.length > MAX_PROMPT_LEN) {
    return { ok: false, message: "prompt is required (<= 500 chars)" };
  }
  if (typeof body.content !== "string" || body.content.trim().length === 0 || body.content.length > MAX_CONTENT_LEN) {
    return { ok: false, message: "content is required (1-10000 chars)" };
  }
  return { ok: true, prompt: body.prompt, content: body.content };
}

// Mirrors src/lib/llmValidation.ts isValidWritingFeedback so the function only
// returns a shape the client will accept (otherwise the client falls back).
function isValidWritingFeedback(x: unknown): boolean {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.overall_score !== "number") return false;
  if (!Array.isArray(o.strengths) || !o.strengths.every((s) => typeof s === "string")) return false;
  if (!Array.isArray(o.suggestions) || !o.suggestions.every((s) => typeof s === "string")) return false;
  if (typeof o.revised_text !== "string") return false;
  if (!Array.isArray(o.errors)) return false;
  return o.errors.every((e) => {
    if (typeof e !== "object" || e === null) return false;
    const ee = e as Record<string, unknown>;
    return typeof ee.original === "string" && typeof ee.corrected === "string" && typeof ee.explanation === "string";
  });
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
  | { kind: "ok"; feedback: unknown }
  | { kind: "rate_limited"; retryAfter: string | null }
  | { kind: "upstream_timeout" }
  | { kind: "failed" };

async function generate(apiKey: string, prompt: string, content: string): Promise<Outcome> {
  const systemPrompt =
    `You are an English writing tutor. Analyze the student's essay and return a JSON object ` +
    `(no markdown fences) with this exact structure: ` +
    `{ "overall_score": <number 0-100>, "strengths": [<string>], ` +
    `"errors": [{"original":"<wrong>","corrected":"<correct>","explanation":"<why>"}], ` +
    `"suggestions": [<string>], "revised_text": "<improved essay>" }. ` +
    `Be thorough but encouraging. Focus on grammar, spelling, vocabulary, coherence.`;
  const body = {
    contents: [{ role: "user", parts: [{ text: `Topic: ${prompt}\n\nEssay:\n${content}` }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: "application/json" },
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
  let feedback: unknown;
  try {
    feedback = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    return { kind: "failed" };
  }
  if (!isValidWritingFeedback(feedback)) return { kind: "failed" };
  return { kind: "ok", feedback };
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

  const outcome = await generate(apiKey, v.prompt, v.content);
  switch (outcome.kind) {
    case "ok":
      return jsonResponse(200, { feedback: outcome.feedback });
    case "rate_limited":
      return errorResponse(429, "rate_limited", "AI temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined);
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "AI upstream timed out");
    case "failed":
      return errorResponse(500, "ai_failed", "AI writing feedback failed");
  }
}

Deno.serve(handler);
