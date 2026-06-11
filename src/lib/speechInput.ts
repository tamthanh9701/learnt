/**
 * speechInput.ts — pure helper for merging dictated speech into a text box.
 *
 * The Web Speech recognizer (continuous mode) calls onResult with the FULL
 * accumulated transcript on every finalized chunk — not a delta. A naive
 * `input = input + transcript` therefore re-appends the whole accumulation each
 * chunk and words duplicate ("hello hello world"). This was the live-conversation
 * "lặp từ" bug.
 *
 * The fix: keep the text the Learner typed BEFORE dictation started (`base`) and
 * REPLACE the speech portion onto it each time. This function encodes that merge
 * so it can be unit-tested without a recognizer or a DOM.
 */

/**
 * Merge the latest full speech transcript onto the pre-dictation base text.
 * - empty base -> just the transcript
 * - empty transcript -> just the base
 * - both -> "base transcript" with a single separating space
 * Always trims the seam so there are never double spaces.
 */
export function mergeSpeechTranscript(base: string, transcript: string): string {
  const b = base.trim();
  const t = transcript.trim();
  if (!b) return t;
  if (!t) return b;
  return `${b} ${t}`;
}
