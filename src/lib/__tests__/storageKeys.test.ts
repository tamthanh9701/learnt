import { describe, it, expect } from 'vitest';
import {
  seededKey,
  topicsKey,
  flashcardsKey,
  learnerCardsKey,
  progressKey,
} from '../vocabulary/storageKeys';

// CHARACTERIZATION (A3 Slice 1) - unit pins of the extracted storage-key builders.
// Asserts each builder returns the EXACT legacy localStorage key string so that
// returning local/mock users keep reading their existing saved data (AC-06/AC-09).
// Covers TC-06. Additive (raises counts above baseline 237/32).
// Re-run: npx vitest run src/lib/__tests__/storageKeys.test.ts

describe('storageKeys builders [TC-06]', () => {
  const userId = 'learner-vocab';
  const today = '2026-06-16';

  it('TC-06 seededKey === learnt_seeded_${userId}', () => {
    expect(seededKey(userId)).toBe('learnt_seeded_learner-vocab');
    expect(seededKey(userId)).toBe(`learnt_seeded_${userId}`);
  });

  it('TC-06 topicsKey === learnt_topics_${userId}', () => {
    expect(topicsKey(userId)).toBe('learnt_topics_learner-vocab');
    expect(topicsKey(userId)).toBe(`learnt_topics_${userId}`);
  });

  it('TC-06 flashcardsKey === learnt_flashcards_${userId}', () => {
    expect(flashcardsKey(userId)).toBe('learnt_flashcards_learner-vocab');
    expect(flashcardsKey(userId)).toBe(`learnt_flashcards_${userId}`);
  });

  it('TC-06 learnerCardsKey === learnt_learner_cards_${userId}', () => {
    expect(learnerCardsKey(userId)).toBe('learnt_learner_cards_learner-vocab');
    expect(learnerCardsKey(userId)).toBe(`learnt_learner_cards_${userId}`);
  });

  it('TC-06 progressKey === learnt_progress_${userId}_${today} (join order preserved)', () => {
    expect(progressKey(userId, today)).toBe('learnt_progress_learner-vocab_2026-06-16');
    expect(progressKey(userId, today)).toBe(`learnt_progress_${userId}_${today}`);
  });
});

describe('storageKeys special-character userId [TC-06]', () => {
  // userId is an opaque token; builders must NOT trim/encode/normalize it.
  const weird = 'a b/c?#&_=:%20.@x';
  const today = '2026-12-31';

  it('TC-06 seededKey passes special chars through verbatim', () => {
    expect(seededKey(weird)).toBe(`learnt_seeded_${weird}`);
  });

  it('TC-06 topicsKey passes special chars through verbatim', () => {
    expect(topicsKey(weird)).toBe(`learnt_topics_${weird}`);
  });

  it('TC-06 flashcardsKey passes special chars through verbatim', () => {
    expect(flashcardsKey(weird)).toBe(`learnt_flashcards_${weird}`);
  });

  it('TC-06 learnerCardsKey passes special chars through verbatim', () => {
    expect(learnerCardsKey(weird)).toBe(`learnt_learner_cards_${weird}`);
  });

  it('TC-06 progressKey passes special chars + underscore-joined today verbatim', () => {
    expect(progressKey(weird, today)).toBe(`learnt_progress_${weird}_${today}`);
    // Explicit guard against any reordering to today_userId.
    expect(progressKey('u', 'd')).toBe('learnt_progress_u_d');
  });

  it('TC-06 progressKey handles empty userId without dropping the join underscore', () => {
    expect(progressKey('', today)).toBe(`learnt_progress__${today}`);
  });
});
