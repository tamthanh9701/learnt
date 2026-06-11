import { describe, it, expect } from 'vitest';
import { createSentenceStreamer } from '../sentenceStreamer';

describe('createSentenceStreamer [TC-STREAM]', () => {
  it('TC-STREAM-01 emits a sentence as soon as its terminator arrives', () => {
    const s = createSentenceStreamer();
    expect(s.push('Hello there')).toEqual([]);
    expect(s.push('. How are you')).toEqual(['Hello there.']);
    expect(s.push('?')).toEqual(['How are you?']);
  });

  it('TC-STREAM-02 emits multiple complete sentences from one chunk', () => {
    const s = createSentenceStreamer();
    expect(s.push('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('TC-STREAM-03 buffers an incomplete remainder until completed', () => {
    const s = createSentenceStreamer();
    expect(s.push('A complete one. And an incomp')).toEqual([
      'A complete one.',
    ]);
    expect(s.push('lete one.')).toEqual(['And an incomplete one.']);
  });

  it('TC-STREAM-04 newline acts as a terminator', () => {
    const s = createSentenceStreamer();
    expect(s.push('Line one\nLine two\n')).toEqual(['Line one', 'Line two']);
  });

  it('TC-STREAM-05 collapses inner whitespace and trims', () => {
    const s = createSentenceStreamer();
    expect(s.push('  messy    spacing   here.  ')).toEqual([
      'messy spacing here.',
    ]);
  });

  it('TC-STREAM-06 drops punctuation/whitespace-only fragments', () => {
    const s = createSentenceStreamer();
    // leading stray terminators should not emit blank "sentences"
    expect(s.push('...')).toEqual([]);
    expect(s.push('\n\n')).toEqual([]);
  });

  it('TC-STREAM-07 flush emits the trailing remainder with no terminator', () => {
    const s = createSentenceStreamer();
    expect(s.push('No terminator yet')).toEqual([]);
    expect(s.flush()).toEqual(['No terminator yet']);
    // buffer cleared after flush
    expect(s.flush()).toEqual([]);
  });

  it('TC-STREAM-08 token-by-token push reconstructs sentences in order', () => {
    const s = createSentenceStreamer();
    const out: string[] = [];
    for (const tok of ['Hel', 'lo', '. ', 'Wor', 'ld', '!']) {
      out.push(...s.push(tok));
    }
    out.push(...s.flush());
    expect(out).toEqual(['Hello.', 'World!']);
  });
});
