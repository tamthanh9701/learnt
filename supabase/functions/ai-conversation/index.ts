/// <reference lib="deno.ns" />
//
// ai-conversation — AI English conversation tutor proxy (Deno / Supabase Edge).
//
// G2 (diagnosis 2026-06-05): the client (speakingService.ts) already calls
// supabase.functions.invoke('ai-conversation', { body: { topic, history } })
// as its non-mock fallback, but this function was never created — so every
// invoke failed and the flow silently dropped to a canned mock reply. This
// restores the server-side path.
//
// SECURITY posture mirrors ai-speech (NFR-24/25/35):
//   - GEMINI_API_KEY read ONLY from public.runtime_secrets via service-role
//     PostgREST; never from the request, never returned, never logged.
//   - verify_jwt platform default ON; only authenticated Learners spend quota.
//   - SSRF-safe: Gemini host is hardcoded.
//
// Contract: POST { topic: string, history: {role,content}[] } -> { reply: string }.

const GEMINI_HOST = "https://generativelanguage.googleapis.com";
// Free-tier-reliable default (runbook §8.3, verified 2026-06-05).
const MODEL = "gemini-2.5-flash";
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_TOPIC_LEN = 200;
const MAX_HISTORY = 50;
const MAX_MSG_LEN = 4_000;

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

interface Msg { role: "user" | "assistant"; content: string; }

function validate(raw: unknown): { ok: true; topic: string; history: Msg[] } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.topic !== "string" || body.topic.trim().length === 0 || body.topic.length > MAX_TOPIC_LEN) {
    return { ok: false, message: "topic is required (1-200 chars)" };
  }
  if (!Array.isArray(body.history) || body.history.length === 0 || body.history.length > MAX_HISTORY) {
    return { ok: false, message: "history must be a non-empty array (<= 50 turns)" };
  }
  const history: Msg[] = [];
  for (const m of body.history) {
    if (typeof m !== "object" || m === null) return { ok: false, message: "each history item must be an object" };
    const mm = m as Record<string, unknown>;
    const role = mm.role === "assistant" ? "assistant" : "user";
    if (typeof mm.content !== "string" || mm.content.length > MAX_MSG_LEN) {
      return { ok: false, message: "each history item needs content (<= 4000 chars)" };
    }
    history.push({ role, content: mm.content });
  }
  return { ok: true, topic: body.topic.trim(), history };
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
  | { kind: "ok"; reply: string }
  | { kind: "rate_limited"; retryAfter: string | null }
  | { kind: "upstream_timeout" }
  | { kind: "failed" };

async function generate(apiKey: string, topic: string, history: Msg[]): Promise<Outcome> {
  const systemPrompt =
    `You are a friendly English conversation tutor helping a Vietnamese intermediate learner. ` +
    `The topic is "${topic}". Keep replies conversational, encouraging, intermediate level, ` +
    `2-4 sentences, and ask a follow-up question to keep the conversation flowing. ` +
    `Reply with plain text only (no markdown, no JSON).`;
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
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
  if (typeof text !== "string" || text.trim().length === 0) return { kind: "failed" };
  return { kind: "ok", reply: text.trim() };
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

  const outcome = await generate(apiKey, v.topic, v.history);
  switch (outcome.kind) {
    case "ok":
      return jsonResponse(200, { reply: outcome.reply });
    case "rate_limited":
      return errorResponse(429, "rate_limited", "AI temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined);
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "AI upstream timed out");
    case "failed":
      return errorResponse(500, "ai_failed", "AI conversation failed");
  }
}

Deno.serve(handler);
