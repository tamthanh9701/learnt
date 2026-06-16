import { describe, it, expect } from 'vitest';
import { fsrs, createEmptyCard, Rating } from 'ts-fsrs';
import type { Card as FSRSCard, Grade } from 'ts-fsrs';
import {
  recordToFsrsCard,
  newFsrsCard,
  scheduleReview,
} from '../vocabulary/fsrsScheduler';
import type { LearnerCardRecord } from '../learnerCard';

// CHARACTERIZATION (A3 Slice 1) - unit pins of the extracted FSRS helpers.
// Verifies recordToFsrsCard / newFsrsCard / scheduleReview are byte-equivalent
// to the inline blocks they replaced in vocabularyService.ts.
// Covers TC-01/02/03/04/05/11. Additive (raises counts above baseline 237/32).
// Re-run: npx vitest run src/lib/__tests__/fsrsScheduler.test.ts

const FIXED_NOW = new Date('2026-06-16T12:00:00.000Z');

// A fully-populated, mid-schedule record (all optional fields present).
function fullRecord(overrides: Partial<LearnerCardRecord> = {}): LearnerCardRecord {
  return {
    learner_id: 'learner-fsrs',
    card_id: 'card-1',
    due: '2026-06-20T08:00:00.000Z',
    stability: 12.34,
    difficulty: 5.67,
    elapsed_days: 3,
    scheduled_days: 7,
    reps: 4,
    lapses: 2,
    state: 2,
    last_review: '2026-06-13T08:00:00.000Z',
    learning_steps: 1,
    ...overrides,
  };
}

describe('recordToFsrsCard [TC-01/TC-02/TC-11]', () => {
  it('TC-01 maps a full LearnerCardRecord to a byte-equivalent FSRS card', () => {
    const lc = fullRecord();
    const card = recordToFsrsCard(lc);

    expect(card.due).toEqual(new Date(lc.due));
    expect(card.due.toISOString()).toBe(lc.due);
    expect(card.stability).toBe(lc.stability);
    expect(card.difficulty).toBe(lc.difficulty);
    expect(card.elapsed_days).toBe(lc.elapsed_days);
    expect(card.scheduled_days).toBe(lc.scheduled_days);
    expect(card.reps).toBe(lc.reps);
    expect(card.lapses).toBe(lc.lapses);
    expect(card.state).toBe(lc.state);
    expect(card.learning_steps).toBe(lc.learning_steps);
    expect(card.last_review).toEqual(new Date(lc.last_review as string));
    expect((card.last_review as Date).toISOString()).toBe(lc.last_review);
  });

  it('TC-02 produces identical output across the former call sites for identical input', () => {
    // The 4 former inline blocks used identical field expressions. Re-running
    // the single helper on the same input must be deterministic/identical.
    const lc = fullRecord();
    const a = recordToFsrsCard(lc);
    const b = recordToFsrsCard({ ...lc });
    expect(a).toEqual(b);
  });

  it('TC-02 reconstruction round-trips a Date-string due losslessly', () => {
    const lc = fullRecord({ due: '2027-01-02T03:04:05.678Z' });
    const card = recordToFsrsCard(lc);
    expect(card.due.toISOString()).toBe('2027-01-02T03:04:05.678Z');
  });

  it('TC-11 coerces missing lapses to 0', () => {
    const lc = fullRecord();
    // Simulate a stored record where lapses is absent/undefined.
    delete (lc as Partial<LearnerCardRecord>).lapses;
    const card = recordToFsrsCard(lc);
    expect(card.lapses).toBe(0);
  });

  it('TC-11 coerces falsy lapses (0) through the || 0 path to 0', () => {
    const card = recordToFsrsCard(fullRecord({ lapses: 0 }));
    expect(card.lapses).toBe(0);
  });

  it('TC-11 coerces missing learning_steps to 0', () => {
    const lc = fullRecord();
    delete (lc as Partial<LearnerCardRecord>).learning_steps;
    const card = recordToFsrsCard(lc);
    expect(card.learning_steps).toBe(0);
  });

  it('TC-11 coerces falsy learning_steps (0) to 0', () => {
    const card = recordToFsrsCard(fullRecord({ learning_steps: 0 }));
    expect(card.learning_steps).toBe(0);
  });

  it('TC-11 maps null last_review to undefined (ternary path)', () => {
    const card = recordToFsrsCard(fullRecord({ last_review: null }));
    expect(card.last_review).toBeUndefined();
  });

  it('TC-11 maps a present last_review to a Date (ternary path)', () => {
    const card = recordToFsrsCard(
      fullRecord({ last_review: '2026-06-10T00:00:00.000Z' }),
    );
    expect(card.last_review).toEqual(new Date('2026-06-10T00:00:00.000Z'));
  });

  it('TC-11 preserves zero stability without coercion (no || on numeric fields)', () => {
    const card = recordToFsrsCard(fullRecord({ stability: 0 }));
    expect(card.stability).toBe(0);
  });

  it('TC-11 boundary record (missing optionals + zero stability + null last_review) does not throw and uses old defaults', () => {
    const lc: LearnerCardRecord = {
      learner_id: 'learner-edge',
      card_id: 'card-edge',
      due: '2026-06-16T00:00:00.000Z',
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: undefined as unknown as number,
      state: 0,
      last_review: null,
      // learning_steps intentionally omitted
    };
    const card = recordToFsrsCard(lc);
    expect(card.lapses).toBe(0);
    expect(card.learning_steps).toBe(0);
    expect(card.last_review).toBeUndefined();
    expect(card.stability).toBe(0);
    expect(card.state).toBe(0);
  });
});

describe('newFsrsCard [TC-03]', () => {
  it('TC-03 produces a card equal to createEmptyCard for the same now', () => {
    const expected = createEmptyCard(FIXED_NOW);
    const actual = newFsrsCard(FIXED_NOW);
    expect(actual).toEqual(expected);
  });

  it('TC-03 a new card starts in the New state (state 0) with zero reps/lapses', () => {
    const card = newFsrsCard(FIXED_NOW);
    expect(card.state).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
  });
});

describe('scheduleReview [TC-04/TC-05]', () => {
  const ratings: Array<{ name: string; rating: Rating }> = [
    { name: 'Again', rating: Rating.Again },
    { name: 'Hard', rating: Rating.Hard },
    { name: 'Good', rating: Rating.Good },
    { name: 'Easy', rating: Rating.Easy },
  ];

  it.each(ratings)(
    'TC-04 $name: equals fsrs().repeat(card, now)[rating as Grade].card',
    ({ rating }) => {
      const card: FSRSCard = createEmptyCard(FIXED_NOW);
      const expected = fsrs().repeat(card, FIXED_NOW)[rating as Grade].card;
      const actual = scheduleReview(card, rating, FIXED_NOW);
      expect(actual).toEqual(expected);
    },
  );

  it('TC-05 Rating enum indexing is exact (Again=1, Hard=2, Good=3, Easy=4) with no off-by-one', () => {
    expect(Rating.Again).toBe(1);
    expect(Rating.Hard).toBe(2);
    expect(Rating.Good).toBe(3);
    expect(Rating.Easy).toBe(4);
  });

  it('TC-05 each rating selects the matching Grade bucket (no remap)', () => {
    const card: FSRSCard = createEmptyCard(FIXED_NOW);
    const log = fsrs().repeat(card, FIXED_NOW);
    for (const { rating } of ratings) {
      const expected = log[rating as Grade].card;
      const actual = scheduleReview(card, rating, FIXED_NOW);
      expect(actual.due).toEqual(expected.due);
      expect(actual.scheduled_days).toBe(expected.scheduled_days);
      expect(actual.state).toBe(expected.state);
    }
  });

  it('TC-05 harder ratings are not scheduled later than easier ones (sanity, ordering preserved)', () => {
    const card: FSRSCard = createEmptyCard(FIXED_NOW);
    const again = scheduleReview(card, Rating.Again, FIXED_NOW);
    const easy = scheduleReview(card, Rating.Easy, FIXED_NOW);
    expect(easy.due.getTime()).toBeGreaterThanOrEqual(again.due.getTime());
  });
});
