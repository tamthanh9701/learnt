import { fsrs, createEmptyCard } from 'ts-fsrs';
import type { Card as FSRSCard, Grade, Rating } from 'ts-fsrs';
import type { LearnerCardRecord } from '../learnerCard';

// Initialise FSRS with default parameters.
// MOVED verbatim from vocabularyService.ts (default params => identical scheduling).
// Singleton stays private to this module — same encapsulation as before.
const fsrsInstance = fsrs();

/**
 * Reconstruct a ts-fsrs Card from a persisted learner-card record.
 * Byte-equivalent to the 4 inline reconstruction blocks it replaces.
 * The Supabase `any` row is a structural superset of LearnerCardRecord
 * and passes through unchanged. The three coercions (`lapses || 0`,
 * `learning_steps || 0`, `last_review` ternary) are preserved verbatim.
 */
export const recordToFsrsCard = (lc: LearnerCardRecord): FSRSCard => ({
  due: new Date(lc.due),
  stability: lc.stability,
  difficulty: lc.difficulty,
  elapsed_days: lc.elapsed_days,
  scheduled_days: lc.scheduled_days,
  reps: lc.reps,
  lapses: lc.lapses || 0,
  state: lc.state,
  learning_steps: lc.learning_steps || 0,
  last_review: lc.last_review ? new Date(lc.last_review) : undefined,
});

/** Empty/new card for a first-ever review. 1:1 delegate to createEmptyCard. */
export const newFsrsCard = (now: Date): FSRSCard => createEmptyCard(now);

/**
 * Schedule the next card state. Exact replacement of
 * `fsrsInstance.repeat(card, now)[rating as Grade].card`.
 * The `rating as Grade` index cast is preserved (no remap, no off-by-one).
 */
export const scheduleReview = (card: FSRSCard, rating: Rating, now: Date): FSRSCard =>
  fsrsInstance.repeat(card, now)[rating as Grade].card;
