/// <reference lib="deno.ns" />
//
// ai-speech — Zephyr TTS proxy Edge Function (Deno runtime, Supabase Edge Functions).
//
// PURPOSE (D2 / NFR-24): keep GEMINI_API_KEY server-side. The browser never holds the
// key on the shipped primary path; it POSTs {text, voice?, format?} here and receives
// base64 PCM16 audio. Contract (LOCKED):
//   .agents/store/20260602-0751-learnt-v2/contract.yaml
//
// RUNTIME: Deno (Deno.serve). This file is NOT part of the app / Vite bundle and is NOT
// type-checked by `tsc -b` (tsconfig.app.json include:["src"] only). It is deployed by
// the USER via the Supabase CLI (deployment-strategy.md §1) — the agent cannot deploy.
//
// verify_jwt POSTURE (NFR-25): relies on the Supabase platform default `verify_jwt = true`.
// The platform rejects any request without a valid Supabase JWT (HTTP 401) BEFORE this
// handler runs, so only authenticated Learners can spend Gemini TTS quota. Do NOT deploy
// with `--no-verify-jwt` unless a decisions.log exception exists (see deno.json note).
//
// SECURITY: the key is read from Deno.env ONLY. It is NEVER read from the request body,
// NEVER returned in a response, and NEVER logged (NFR-24 / NFR-35). Error messages are
// sanitized constants.
//
// PHASE-A SLOT: a sibling /ai-live-token function (mint a short-lived Gemini Live
// ephemeral token) would slot in under supabase/functions/, reusing the SAME verify_jwt
// + server-side-key posture. Out of scope for Phase B (turn-based).

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gemini TTS-capable model (be-design.md §2.4). Pinned in ONE place — if Google
 *  renames it, this is the single point of change; the client always has the
 *  speechSynthesis fallback (BR-10), so a rename degrades gracefully. */
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

/** Only Zephyr is offered in Phase B (contract enum). */
const ALLOWED_VOICES = ["Zephyr"] as const;
const DEFAULT_VOICE = "Zephyr";

/** Only pcm16 is offered in Phase B (contract enum). */
const ALLOWED_FORMATS = ["pcm16"] as const;
const DEFAULT_FORMAT = "pcm16";

/** Server-side text guard (A03 oversize/injection). Mirrors contract maxLength. */
const MAX_TEXT_LEN = 1000;

/** Gemini TTS native output (contract: mimeType audio/L16, sampleRate 24000). */
const RESPONSE_MIME = "audio/L16";
const RESPONSE_SAMPLE_RATE = 24000;

/** Server-side upstream budget. The CLIENT also wraps the call in withTimeout(10s)
 *  (NFR-04/16) and may fall back to speechSynthesis before this fires; this is the
 *  server's own ceiling so the function never hangs a connection (-> 504). */
const UPSTREAM_TIMEOUT_MS = 9_000;

const GEMINI_TTS_HOST = "https://generativelanguage.googleapis.com";

// CORS — browser calls this cross-origin from the Vercel-hosted SPA.
// Authorization is required (verify_jwt); allow it through preflight.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "rate_limited"
  | "tts_failed"
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

/** Sanitized error body — NEVER contains the API key, raw audio, or PII (NFR-24/35). */
function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return jsonResponse(status, { error: { code, message } }, extraHeaders);
}

// ---------------------------------------------------------------------------
// Request validation (A03/A04 server-side validation)
// ---------------------------------------------------------------------------

interface ParsedRequest {
  text: string;
  voice: string;
  format: string;
}

function validateBody(raw: unknown): { ok: true; value: ParsedRequest } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  // text — REQUIRED, non-empty, <= MAX_TEXT_LEN after trim.
  if (typeof body.text !== "string") {
    return { ok: false, message: "text is required and must be 1-1000 characters" };
  }
  const text = body.text.trim();
  if (text.length === 0 || text.length > MAX_TEXT_LEN) {
    return { ok: false, message: "text is required and must be 1-1000 characters" };
  }

  // voice — OPTIONAL, enum-validated, default Zephyr.
  let voice = DEFAULT_VOICE;
  if (body.voice !== undefined) {
    if (typeof body.voice !== "string" || !ALLOWED_VOICES.includes(body.voice as typeof ALLOWED_VOICES[number])) {
      return { ok: false, message: "voice must be one of: Zephyr" };
    }
    voice = body.voice;
  }

  // format — OPTIONAL, enum-validated, default pcm16.
  let format = DEFAULT_FORMAT;
  if (body.format !== undefined) {
    if (typeof body.format !== "string" || !ALLOWED_FORMATS.includes(body.format as typeof ALLOWED_FORMATS[number])) {
      return { ok: false, message: "format must be one of: pcm16" };
    }
    format = body.format;
  }

  return { ok: true, value: { text, voice, format } };
}

// ---------------------------------------------------------------------------
// Gemini TTS call (A10 SSRF-safe: host is hardcoded, no user-supplied URL)
// ---------------------------------------------------------------------------

interface TtsResult {
  audioBase64: string;
  mimeType: string;
}

type TtsOutcome =
  | { kind: "ok"; result: TtsResult }
  | { kind: "rate_limited"; retryAfter: string | null }
  | { kind: "upstream_timeout" }
  | { kind: "failed" };

async function synthesize(apiKey: string, text: string, voice: string): Promise<TtsOutcome> {
  // Mirrors the existing aiClient.callGemini request style (x-goog-api-key header,
  // generativelanguage v1beta) — but the key comes from Deno.env, never the client.
  const url = `${GEMINI_TTS_HOST}/v1beta/models/${TTS_MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  };

  // Server-side timeout via AbortController -> 504 (never hang the connection).
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
    // Network / DNS / TLS error — sanitized, no key, no detail leak.
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    // Propagate upstream rate limit + Retry-After passthrough (contract 429).
    return { kind: "rate_limited", retryAfter: res.headers.get("Retry-After") };
  }

  if (!res.ok) {
    // Drain body so the connection is reusable; do NOT echo it (could contain
    // upstream detail). Sanitized failure only (NFR-24/35).
    await res.text().catch(() => undefined);
    return { kind: "failed" };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { kind: "failed" };
  }

  // Extract candidates[0].content.parts[0].inlineData {data, mimeType}.
  const parts = (data as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  })?.candidates?.[0]?.content?.parts;
  const inline = Array.isArray(parts)
    ? parts.find((p) => p?.inlineData?.data)?.inlineData
    : undefined;
  const audioBase64 = inline?.data;

  if (typeof audioBase64 !== "string" || audioBase64.length === 0) {
    // Empty audio -> tts_failed (contract 500).
    return { kind: "failed" };
  }

  return {
    kind: "ok",
    result: { audioBase64, mimeType: inline?.mimeType ?? RESPONSE_MIME },
  };
}
// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  // CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Method guard — only POST synthesizes (405).
  if (req.method !== "POST") {
    return errorResponse(405, "bad_request", "Method not allowed; use POST");
  }

  // NOTE on 401: with verify_jwt=true the Supabase platform rejects unauthenticated
  // requests (401) BEFORE this handler runs, so the contract's 401 is enforced by the
  // platform, not here. This defends the handler if it is ever deployed with verify_jwt
  // disabled — but the deploy posture (deployment-strategy.md §1.4) keeps it ON.
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return errorResponse(401, "unauthorized", "Missing or invalid authentication token");
  }

  // The key lives ONLY in the function secret store (NFR-24). Never from the request.
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    // Misconfiguration — do not reveal which secret is missing beyond a generic message.
    return errorResponse(500, "tts_failed", "Speech synthesis is not configured");
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

  const { text, voice } = validated.value;

  // Synthesize. Note: we do NOT log `text` (could be transcript PII) or the key.
  const outcome = await synthesize(apiKey, text, voice);

  switch (outcome.kind) {
    case "ok":
      return jsonResponse(200, {
        audioBase64: outcome.result.audioBase64,
        mimeType: RESPONSE_MIME,
        sampleRate: RESPONSE_SAMPLE_RATE,
      });
    case "rate_limited":
      return errorResponse(
        429,
        "rate_limited",
        "TTS temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined,
      );
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "TTS upstream timed out");
    case "failed":
      return errorResponse(500, "tts_failed", "Speech synthesis failed");
  }
}

Deno.serve(handler);

