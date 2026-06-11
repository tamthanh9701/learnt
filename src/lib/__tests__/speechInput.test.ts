import { describe, it, expect } from 'vitest';
import { mergeSpeechTranscript } from '../speechInput';

describe('mergeSpeechTranscript [TC-SPEECH-MERGE]', () => {
  it('TC-SPEECH-MERGE-01 empty base -> just the transcript', () => {
    expect(mergeSpeechTranscript('', 'hello world')).toBe('hello world');
  });

  it('TC-SPEECH-MERGE-02 empty transcript -> just the base', () => {
    expect(mergeSpeechTranscript('typed text', '')).toBe('typed text');
  });

  it('TC-SPEECH-MERGE-03 both present -> single space seam', () => {
    expect(mergeSpeechTranscript('typed', 'spoken')).toBe('typed spoken');
  });

  it('TC-SPEECH-MERGE-04 trims stray whitespace at the seam', () => {
    expect(mergeSpeechTranscript('typed  ', '  spoken')).toBe('typed spoken');
  });

  it('TC-SPEECH-MERGE-05 REGRESSION: replacing a growing accumulation does not duplicate words', () => {
    // Simulates continuous-mode onResult: each chunk carries the FULL
    // accumulated transcript. Merging onto a fixed base must REPLACE, so the
    // final box never duplicates ("hello hello world").
    const base = '';
    const chunks = ['hello', 'hello world', 'hello world how', 'hello world how are you'];
    let box = base;
    for (const full of chunks) {
      box = mergeSpeechTranscript(base, full);
    }
    expect(box).toBe('hello world how are you');
  });

  it('TC-SPEECH-MERGE-06 REGRESSION: preserves pre-dictation typed text once', () => {
    const base = 'I think';
    const chunks = ['the', 'the answer', 'the answer is yes'];
    let box = base;
    for (const full of chunks) {
      box = mergeSpeechTranscript(base, full);
    }
    expect(box).toBe('I think the answer is yes');
  });
});
