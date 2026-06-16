/// <reference lib="deno.ns" />
//
// _shared/gemini.ts — Gemini transport + text-tail helpers for the ai-* Edge
// Functions. Two-layer split (be-design.md §2.4, codebase-map §6 THE TRAP):
//
//   Layer 1  postGemini      — transport ONLY, text-agnostic, returns raw
//                              upstream JSON as `unknown`. timeoutMs is a PARAM
//                              (no ms literal lives here). Used by ai-speech
//                              (audio) AND the 3 JSON callers (via Layer 2).
//   Layer 2  callGeminiText  — extracts candidates[0].content.parts[0].text for
//                              the 3 JSON callers ONLY. ai-speech NEVER imports
//                              this — it extracts inlineData.data locally.
//
// A10 SSRF-safe: `host` is a caller-supplied hardcoded const, never user input.

/** Discriminated transport outcome. `ok` carries the RAW upstream JSON as
 *  `unknown` — no text/audio assumption. Each caller extracts locally. */
export type GeminiOutcome =
  | { kind: "ok"; data: unknown }
  | { kind: "rate_limited"; retryAfter: string | null }
  | { kind: "upstream_timeout" }
  | { kind: "failed" };

export interface PostGeminiOptions {
  apiKey: string;
  host: string;       // per-fn: GEMINI_HOST / GEMINI_TTS_HOST (same value, kept local)
  model: string;      // per-fn: MODEL / TTS_MODEL (kept local)
  body: unknown;      // per-fn assembled body (systemInstruction/contents/generationConfig)
  timeoutMs: number;  // per-fn: 9_000 / 25_000 / 25_000 / 30_000 — NEVER a literal here
}

/** A10 SSRF-safe: host is supplied by the caller as a hardcoded const, never
 *  user input. Timeout is the caller's own const passed as `timeoutMs`. */
export async function postGemini(opts: PostGeminiOptions): Promise<GeminiOutcome> {
  const url = `${opts.host}/v1beta/models/${opts.model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
      body: JSON.stringify(opts.body),
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
    await res.text().catch(() => undefined); // drain, never echo (NFR-24/35)
    return { kind: "failed" };
  }
  try {
    return { kind: "ok", data: await res.json() };
  } catch {
    return { kind: "failed" };
  }
}

/** Text-tail extraction for the 3 JSON callers ONLY (conversation/writing/
 *  exercises). Extracts candidates[0].content.parts[0].text. ai-speech does
 *  NOT import this — it extracts inlineData.data locally. */
export type GeminiTextOutcome =
  | { kind: "ok"; text: string }
  | { kind: "rate_limited"; retryAfter: string | null }
  | { kind: "upstream_timeout" }
  | { kind: "failed" };

export async function callGeminiText(opts: PostGeminiOptions): Promise<GeminiTextOutcome> {
  const out = await postGemini(opts);
  if (out.kind !== "ok") return out; // rate_limited | upstream_timeout | failed pass straight through
  const text = (out.data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  })?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return { kind: "failed" };
  return { kind: "ok", text };
}
