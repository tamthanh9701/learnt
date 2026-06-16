/// <reference lib="deno.ns" />
//
// _shared/apiKey.ts — getApiKey shared across the 4 ai-* Edge Functions.
//
// Extract of the named getApiKey (byte-identical in ai-conversation 261-277,
// ai-writing-feedback 256-272, ai-generate-exercises 255-271). ai-speech's
// inlined single-quoted IIFE (271-289) migrates here behavior-equivalent, with
// the sole pre-approved normalization '→" (BA-AC-10): same env vars, same
// runtime_secrets query, same fail-closed "" on any miss.

/** Reads GEMINI_API_KEY from public.runtime_secrets via PostgREST using the
 *  service-role key. Fails closed (returns "") if either arg is empty, the
 *  request is not ok, or the row/value is missing. Args are passed in at
 *  runtime by the handler — no secret or URL is baked into _shared/. */
export async function getApiKey(supabaseUrl: string, serviceKey: string): Promise<string> {
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
