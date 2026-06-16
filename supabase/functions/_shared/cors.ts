/// <reference lib="deno.ns" />
//
// _shared/cors.ts — CORS_HEADERS shared across the 4 ai-* Edge Functions.
//
// Byte-identical extract (origin "*") of the per-fn CORS_HEADERS block
// (ai-speech 60-64, ai-conversation 93-97, ai-writing-feedback 81-85,
// ai-generate-exercises 70-74). Authorization is required (verify_jwt);
// allow it through preflight.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
