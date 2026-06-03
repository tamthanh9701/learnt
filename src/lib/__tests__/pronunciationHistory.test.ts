import { describe, it, expect } from 'vitest';
import {
  bandForScore,
  serializePronunciationAttempt,
  deserializePronunciationAttempt,
  deserializePronunciationHistory,
  PRONUNCIATION_TOPIC,
} from '../pronunciationHistory';
import type { PronunciationSessionEntry } from '../pronunciationHistory';

// QA S4 unit tests — pronunciation history: score→band map + serializers.
// Realizes TC-PRON-01-2 (banding, F-G boundaries), TC-PRON-03-1 (F-F
// round-trip) and TC-PRON-03-4 (sentinel separation). Backs BR-18 / BR-20.
// Fixtures F-F / F-G are from
// .agents/store/20260602-0751-learnt-v2/test-data-requirements.md.
// Re-run: npx vitest run src/lib/__tests__/pronunciationHistory.test.ts

// ---------------------------------------------------------------------------
// F-F — pronunciation-attempt entry via PRONUNCIATION_TOPIC sentinel
// ---------------------------------------------------------------------------
const F_F: PronunciationSessionEntry = {
  id: 'sess-pron-001',
  topic: PRONUNCIATION_TOPIC,
  created_at: '2026-06-02T10:40:00.000Z',
  attempt: {
    sentence: 'We need to negotiate the terms of the contract before signing.',
    source_card_id: 'card-topic-business-101',
    overall_band: 'borderline',
    phonemes: [
      { phoneme: 'n', score: 0.92, band: 'good' },
      { phoneme: 'ɪ', score: 0.81, band: 'good' },
      { phoneme: 'ɡ', score: 0.64, band: 'borderline' },
      { phoneme: 'oʊ', score: 0.41, band: 'off' },
      { phoneme: 'ʃ', score: 0.55, band: 'borderline' },
      { phoneme: 't', score: 0.88, band: 'good' },
    ],
  },
};

describe('bandForScore (BR-18, F-G boundaries — lower-inclusive)', () => {
  it('TC-PRON-01-2 0.80 → good (lower-inclusive boundary)', () => {
    expect(bandForScore(0.8)).toBe('good');
  });

  it('TC-PRON-01-2 0.79 → borderline (just below good)', () => {
    expect(bandForScore(0.79)).toBe('borderline');
  });

  it('TC-PRON-01-2 0.50 → borderline (lower-inclusive boundary)', () => {
    expect(bandForScore(0.5)).toBe('borderline');
  });

  it('TC-PRON-01-2 0.49 → off (just below borderline)', () => {
    expect(bandForScore(0.49)).toBe('off');
  });

  it('TC-PRON-01-2 1.0 → good (clamp high end)', () => {
    expect(bandForScore(1.0)).toBe('good');
  });

  it('TC-PRON-01-2 0 → off (clamp low end)', () => {
    expect(bandForScore(0)).toBe('off');
  });
});

describe('serialize ↔ deserialize PronunciationAttempt (BR-20, F-F)', () => {
  it('TC-PRON-03-1 serialize then deserialize is an identity round-trip', () => {
    const serialized = serializePronunciationAttempt(F_F);
    const restored = deserializePronunciationAttempt(serialized);
    expect(restored).toEqual(F_F);
  });

  it('TC-PRON-03-1 the PRONUNCIATION_TOPIC sentinel is present on the entry', () => {
    const serialized = serializePronunciationAttempt(F_F) as {
      topic: string;
    };
    expect(serialized.topic).toBe(PRONUNCIATION_TOPIC);
    expect(serialized.topic).toBe('__PRONUNCIATION__');

    const restored = deserializePronunciationAttempt(serialized);
    expect(restored?.topic).toBe(PRONUNCIATION_TOPIC);
  });

  it('TC-PRON-03-1 every phoneme survives the round-trip with identity + score + band', () => {
    const restored = deserializePronunciationAttempt(
      serializePronunciationAttempt(F_F),
    );
    expect(restored?.attempt.phonemes).toEqual(F_F.attempt.phonemes);
  });
});

describe('deserializePronunciationHistory (BR-20 separation, TC-PRON-03-4)', () => {
  it('TC-PRON-03-4 keeps ONLY sentinel pronunciation rows from a mixed dialogue_history', () => {
    const conversationRow = {
      id: 'sess-conv-001',
      topic: 'topic-travel',
      created_at: '2026-06-02T10:15:00.000Z',
      messages: [
        { role: 'user', content: 'I go to Da Nang last summer.' },
        { role: 'assistant', content: 'How long did you stay?' },
      ],
    };

    const mixed: unknown[] = [
      conversationRow,
      serializePronunciationAttempt(F_F),
      { topic: 'topic-business', messages: [] }, // another conversation row
    ];

    const result = deserializePronunciationHistory(mixed);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(F_F);
  });

  it('TC-PRON-03-4 ignores conversation-only stores (returns empty array)', () => {
    const conversationOnly: unknown[] = [
      { id: 'a', topic: 'topic-travel', messages: [] },
      { id: 'b', topic: 'topic-business', messages: [] },
    ];
    expect(deserializePronunciationHistory(conversationOnly)).toEqual([]);
  });

  it('TC-PRON-03-4 keeps multiple pronunciation entries in order', () => {
    const second: PronunciationSessionEntry = {
      ...F_F,
      id: 'sess-pron-002',
      created_at: '2026-06-02T10:45:00.000Z',
    };
    const mixed: unknown[] = [
      serializePronunciationAttempt(F_F),
      { id: 'c', topic: 'topic-travel', messages: [] },
      serializePronunciationAttempt(second),
    ];
    const result = deserializePronunciationHistory(mixed);
    expect(result.map((e) => e.id)).toEqual(['sess-pron-001', 'sess-pron-002']);
  });

  it('TC-PRON-03-4 never throws on a non-array input (returns empty array)', () => {
    expect(() =>
      deserializePronunciationHistory(null as unknown as unknown[]),
    ).not.toThrow();
    expect(deserializePronunciationHistory(null as unknown as unknown[])).toEqual(
      [],
    );
  });
});
