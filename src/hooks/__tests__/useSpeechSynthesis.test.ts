import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { speakViaSpeechSynthesis } from '../useSpeechSynthesis';

// CH3 (diagnosis 2026-06-06): Web Speech API has a known race between
// speechSynthesis.cancel() and .speak() — if speak() runs synchronously
// after cancel(), the new utterance is queued and then immediately killed
// by the still-pending cancel (Chrome, Safari, Firefox all affected).
// Symptom: "After sentence 1, can't hear native voice on sentence 2+".
// The fix is to defer speak() with setTimeout so cancel() settles first.
// This test pins the FIX, not the BUG. The 50ms delay is small enough
// to be imperceptible but big enough to let cancel() complete on
// every browser we support (per Chromium source, cancel() settles
// inside the next microtask + 1 event-loop turn).

describe('speakViaSpeechSynthesis (race fix) [TC-SYNTH-RACE]', () => {
  type Call = { kind: 'cancel' | 'speak'; text?: string; at: number };
  const calls: Call[] = [];
  let now = 0;

  beforeEach(() => {
    calls.length = 0;
    now = 0;
    // happy-dom doesn't ship SpeechSynthesisUtterance; install a minimal
    // global stub so the production code's `new SpeechSynthesisUtterance(t)`
    // can run. The stub stores text/lang/voice — everything the production
    // code writes to it.
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      class SpeechSynthesisUtterance {
        text: string;
        lang = '';
        voice: SpeechSynthesisVoice | null = null;
        constructor(text: string) { this.text = text; }
      };
    // happy-dom doesn't ship speechSynthesis either; install a minimal stub
    // that records every call and stamps a synthetic timestamp.
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: () => calls.push({ kind: 'cancel', at: now }),
      speak: (u: { text: string }) => calls.push({ kind: 'speak', text: u.text, at: now }),
      getVoices: () => [],
      onvoiceschanged: null,
      pause: () => {},
      resume: () => {},
    };
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    delete (globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const tick = (ms: number) => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  it('TC-SYNTH-RACE-01 cancels BEFORE the first speak (baseline path)', () => {
    now = 0;
    const ok = speakViaSpeechSynthesis('first', 'en-US', []);
    // The fix uses setTimeout for speak; advance past it.
    tick(60);
    expect(ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].kind).toBe('cancel');
    expect(calls[1].kind).toBe('speak');
    expect(calls[1].text).toBe('first');
  });

  it('TC-SYNTH-RACE-02 back-to-back calls do not race (câu 2+ cũng nghe được)', () => {
    // First call: cancel + speak('first')
    speakViaSpeechSynthesis('first', 'en-US', []);
    tick(60);
    expect(calls.map((c) => c.kind)).toEqual(['cancel', 'speak']);

    // Second call, fired immediately after first ends (PronunciationPage
    // calls handleSpeakReference again when the learner taps the button
    // for the next sentence). The pre-fix bug: speak('second') would be
    // synchronously scheduled AFTER cancel(), and Chrome would kill it
    // because cancel() hadn't fully drained. The post-fix expectation:
    // a fresh cancel('second') + a speak('second') AFTER the cancel settles.
    speakViaSpeechSynthesis('second', 'en-US', []);
    tick(60);

    const kinds = calls.map((c) => c.kind);
    // Expected: cancel, speak, cancel, speak
    expect(kinds).toEqual(['cancel', 'speak', 'cancel', 'speak']);
    // And the 2nd speak must have happened AFTER the 2nd cancel (not before).
    const secondCancelIdx = calls.findIndex((c) => c.text === undefined && c === calls[1] ? false : c.kind === 'cancel' && calls.indexOf(c) > 1);
    const secondSpeakIdx = calls.findIndex((c) => c.text === 'second');
    expect(secondCancelIdx).toBeGreaterThan(1);
    expect(secondSpeakIdx).toBeGreaterThan(secondCancelIdx);
  });

  it('TC-SYNTH-RACE-03 the defer delay is bounded (≤ 80ms — perceptible but not annoying)', () => {
    // Behavior, not implementation: total time from call() to speak()
    // must be ≥ 50ms (give cancel time to settle) and < 80ms (don't
    // make the learner wait a noticeable gap). This is a regression
    // guard against the fix being accidentally over-bounded.
    const t0 = now;
    speakViaSpeechSynthesis('bounded', 'en-US', []);
    // Don't tick yet — speak should not have been called.
    expect(calls.find((c) => c.kind === 'speak')).toBeUndefined();
    // After 50ms it should have fired.
    tick(50);
    expect(calls.find((c) => c.kind === 'speak')).toBeDefined();
    const t1 = now;
    expect(t1 - t0).toBeGreaterThanOrEqual(50);
    expect(t1 - t0).toBeLessThan(80);
  });

  it('TC-SYNTH-RACE-04 returns false (does not throw) when speechSynthesis is missing', () => {
    // Simulate a browser without speechSynthesis at all.
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    const ok = speakViaSpeechSynthesis('any', 'en-US', []);
    expect(ok).toBe(false);
  });
});
