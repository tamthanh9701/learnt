/**
 * sentenceStreamer.ts — pure incremental sentence splitter for streaming TTS.
 *
 * Live v2 (pseudo-live streaming): the AI reply arrives token-by-token. To make
 * the partner "speak as it thinks", we feed the growing text through this
 * splitter, which emits each COMPLETE sentence the moment its terminator
 * (. ! ? or newline) arrives — so TTS can start on sentence 1 while the model
 * is still generating sentence 2.
 *
 * Pure + stateful-by-instance, NO I/O. The streaming transport (fetch reader,
 * provider SDK) lives elsewhere; this only decides "given more text, which new
 * complete sentences can I emit now?". That makes it unit-testable with plain
 * string pushes — no network, no timers.
 */

/** Sentence-ending punctuation. A newline also flushes (list items, etc). */
const TERMINATORS = /([.!?]+|\n)/;

export interface SentenceStreamer {
  /**
   * Append a chunk of newly-arrived text. Returns any sentences that became
   * COMPLETE as a result (may be empty). The trailing incomplete remainder is
   * buffered until a later push completes it or `flush()` is called.
   */
  push: (chunk: string) => string[];
  /**
   * Emit whatever remains in the buffer as a final sentence (used when the
   * stream ends without a terminator). Returns [] if the buffer is empty.
   */
  flush: () => string[];
}

/** Normalize a candidate sentence: collapse inner whitespace, trim. */
function clean(sentence: string): string {
  return sentence.replace(/\s+/g, ' ').trim();
}

/**
 * Create a streaming sentence splitter. Each instance keeps its own buffer.
 *
 * A "sentence" is the text up to and including a run of terminators. Multiple
 * sentences completed in one push are all returned, in order. Empty/whitespace
 * fragments (e.g. a stray newline) are dropped, never emitted as blank speech.
 */
export function createSentenceStreamer(): SentenceStreamer {
  let buffer = '';

  const push = (chunk: string): string[] => {
    buffer += chunk;
    const out: string[] = [];

    // Repeatedly peel a complete "...<terminator>" off the front of the buffer.
    // Split keeps the terminator group so we can re-attach it to its sentence.
    let match = TERMINATORS.exec(buffer);
    while (match) {
      const end = match.index + match[0].length;
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end);
      const sentence = clean(raw);
      // Drop fragments that are only punctuation/whitespace.
      if (sentence && /[A-Za-z0-9]/.test(sentence)) {
        out.push(sentence);
      }
      match = TERMINATORS.exec(buffer);
    }
    return out;
  };

  const flush = (): string[] => {
    const sentence = clean(buffer);
    buffer = '';
    if (sentence && /[A-Za-z0-9]/.test(sentence)) return [sentence];
    return [];
  };

  return { push, flush };
}
