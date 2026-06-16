import { describe, it, expect } from 'vitest';
import { buildCardHistoryStats } from '../pronunciationAttemptRepository';
import {
  PRONUNCIATION_TOPIC,
  type PronunciationSessionEntry,
} from '../pronunciationHistory';

function entry(
  id: string,
  sourceCardId: string,
  scores: number[],
): PronunciationSessionEntry {
  return {
    id,
    topic: PRONUNCIATION_TOPIC,
    created_at: new Date().toISOString(),
    attempt: {
      sentence: `sentence ${sourceCardId}`,
      source_card_id: sourceCardId,
      overall_band: 'good',
      phonemes: scores.map((score, i) => ({
        phoneme: `p${i}`,
        score,
        band: score >= 0.8 ? 'good' : score >= 0.5 ? 'borderline' : 'off',
      })),
    },
  };
}

describe('buildCardHistoryStats [TC-HSTAT]', () => {
  it('TC-HSTAT-01 empty list -> empty map', () => {
    expect(buildCardHistoryStats([])).toEqual({});
  });

  it('TC-HSTAT-02 counts attempts per source card', () => {
    const stats = buildCardHistoryStats([
      entry('1', 'card-a', [1]),
      entry('2', 'card-a', [1]),
      entry('3', 'card-b', [1]),
    ]);
    expect(stats['card-a'].attempts).toBe(2);
    expect(stats['card-b'].attempts).toBe(1);
  });

  it('TC-HSTAT-03 meanScore averages overall scores across attempts', () => {
    // attempt 1 overall = (1.0 + 0.0)/2 = 0.5 ; attempt 2 overall = 1.0
    // mean of [0.5, 1.0] = 0.75
    const stats = buildCardHistoryStats([
      entry('1', 'card-a', [1.0, 0.0]),
      entry('2', 'card-a', [1.0]),
    ]);
    expect(stats['card-a'].meanScore).toBeCloseTo(0.75, 5);
  });

  it('TC-HSTAT-04 attempt with no phonemes -> meanScore null when no scored attempts', () => {
    const stats = buildCardHistoryStats([entry('1', 'card-a', [])]);
    expect(stats['card-a'].attempts).toBe(1);
    expect(stats['card-a'].meanScore).toBeNull();
  });

  it('TC-HSTAT-05 ignores entries with empty source_card_id', () => {
    const stats = buildCardHistoryStats([entry('1', '', [1])]);
    expect(Object.keys(stats)).toHaveLength(0);
  });
});
