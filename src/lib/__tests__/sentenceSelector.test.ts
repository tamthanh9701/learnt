import { describe, it, expect } from 'vitest';
import {
  selectNextSentenceIndex,
  computePracticeCounters,
  type SentenceCandidate,
  type CardHistoryStat,
} from '../sentenceSelector';

const pool: SentenceCandidate[] = [
  { sourceCardId: 'a', sentence: 'Alpha sentence.' },
  { sourceCardId: 'b', sentence: 'Bravo sentence.' },
  { sourceCardId: 'c', sentence: 'Charlie sentence.' },
];

// Deterministic RNG: always returns a fixed value so jitter never reorders.
const rng0 = () => 0;

describe('selectNextSentenceIndex [TC-SEL]', () => {
  it('TC-SEL-01 empty pool returns 0', () => {
    expect(selectNextSentenceIndex([], { history: {} })).toBe(0);
  });

  it('TC-SEL-02 single-item pool returns 0', () => {
    expect(
      selectNextSentenceIndex([pool[0]], { history: {}, lastIndex: 0 }),
    ).toBe(0);
  });

  it('TC-SEL-03 coverage: prefers the least-practiced sentence', () => {
    const history: Record<string, CardHistoryStat> = {
      a: { attempts: 5 },
      b: { attempts: 0 },
      c: { attempts: 3 },
    };
    // b has 0 attempts -> highest priority.
    expect(
      selectNextSentenceIndex(pool, { history, lastIndex: -1, rng: rng0 }),
    ).toBe(1);
  });

  it('TC-SEL-04 never immediately repeats the last index', () => {
    // All equal attempts; with rng0 the sort is stable, so index 0 would win —
    // but lastIndex=0 must be excluded, so it picks the next eligible (1).
    const history: Record<string, CardHistoryStat> = {
      a: { attempts: 1 },
      b: { attempts: 1 },
      c: { attempts: 1 },
    };
    const idx = selectNextSentenceIndex(pool, {
      history,
      lastIndex: 0,
      rng: rng0,
    });
    expect(idx).not.toBe(0);
  });

  it('TC-SEL-05 a brand-new sentence (no history entry) is treated as 0 attempts', () => {
    const history: Record<string, CardHistoryStat> = {
      a: { attempts: 2 },
      b: { attempts: 2 },
      // c missing -> 0 attempts -> should be picked
    };
    expect(
      selectNextSentenceIndex(pool, { history, lastIndex: -1, rng: rng0 }),
    ).toBe(2);
  });

  it('TC-SEL-06 mastery off: score is ignored, only coverage matters', () => {
    const history: Record<string, CardHistoryStat> = {
      a: { attempts: 1, meanScore: 0.1 },
      b: { attempts: 1, meanScore: 0.9 },
      c: { attempts: 1, meanScore: 0.5 },
    };
    // useMastery defaults false; equal attempts -> rng0 keeps order -> index 0.
    expect(
      selectNextSentenceIndex(pool, { history, lastIndex: -1, rng: rng0 }),
    ).toBe(0);
  });

  it('TC-SEL-07 mastery on: among equal coverage, lowest score wins', () => {
    const history: Record<string, CardHistoryStat> = {
      a: { attempts: 1, meanScore: 0.9 },
      b: { attempts: 1, meanScore: 0.1 },
      c: { attempts: 1, meanScore: 0.5 },
    };
    expect(
      selectNextSentenceIndex(pool, {
        history,
        lastIndex: -1,
        rng: rng0,
        useMastery: true,
      }),
    ).toBe(1);
  });

  it('TC-SEL-08 coverage outranks mastery (fewer attempts beats lower score)', () => {
    const history: Record<string, CardHistoryStat> = {
      a: { attempts: 5, meanScore: 0.0 }, // worst score but most practiced
      b: { attempts: 0, meanScore: 1.0 }, // never practiced
      c: { attempts: 3, meanScore: 0.2 },
    };
    expect(
      selectNextSentenceIndex(pool, {
        history,
        lastIndex: -1,
        rng: rng0,
        useMastery: true,
      }),
    ).toBe(1);
  });
});

describe('computePracticeCounters [TC-CNT]', () => {
  it('TC-CNT-01 empty history -> zero counters', () => {
    expect(computePracticeCounters({})).toEqual({
      totalAttempts: 0,
      distinctSentences: 0,
    });
  });

  it('TC-CNT-02 sums attempts and counts distinct practiced sentences', () => {
    const history: Record<string, CardHistoryStat> = {
      a: { attempts: 3 },
      b: { attempts: 1 },
      c: { attempts: 0 }, // present but never practiced -> not distinct
    };
    expect(computePracticeCounters(history)).toEqual({
      totalAttempts: 4,
      distinctSentences: 2,
    });
  });
});
