/// <reference lib="deno.ns" />
//
// _shared/http.ts — jsonResponse + errorResponse shared across the 4 ai-*
// Edge Functions.
//
// jsonResponse is byte-identical across all 4. errorResponse body is
// byte-identical across all 4; only the `code` parameter's TYPE differed
// (tts_failed vs ai_failed). Resolution (QA cond 3): the shared errorResponse
// takes `code: string`; EACH function keeps its own ErrorCode union locally
// and passes its typed code in. The shared union is NOT widened.

import { CORS_HEADERS } from "./cors.ts";

export function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...(extraHeaders ?? {}),
    },
  });
}

/** Sanitized error body — NEVER contains the API key, raw audio, or PII (NFR-24/35).
 *  `code` is typed `string` so each fn supplies its OWN ErrorCode union value
 *  (ai-speech `tts_failed`; the other 3 `ai_failed`). The shared union is NOT widened. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return jsonResponse(status, { error: { code, message } }, extraHeaders);
}
