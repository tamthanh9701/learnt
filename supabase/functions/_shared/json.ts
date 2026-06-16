/// <reference lib="deno.ns" />
//
// _shared/json.ts — parseGeminiJson, shared by ai-writing-feedback +
// ai-generate-exercises ONLY (byte-identical in both; codebase-map §2).
// NOT introduced to ai-speech or ai-conversation.

/** Parse a Gemini JSON text payload. Gemini is called with
 *  responseMimeType "application/json" + a responseSchema, so `raw`
 *  SHOULD already be valid JSON, but it MIGHT occasionally arrive
 *  wrapped in ```json markdown fences. Strip fences if present, then
 *  JSON.parse. Returns undefined if parsing throws — the caller maps
 *  that to a clean ai_failed rather than emitting a malformed 200.
 *  Imported by ai-writing-feedback + ai-generate-exercises ONLY. */
export function parseGeminiJson(raw: string): unknown {
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
