import type { Card as FSRSCard } from 'ts-fsrs';

/**
 * Persisted shape of a Learner's FSRS scheduling state for a single Flashcard.
 * Mirrors the `learner_cards` table columns used by vocabularyService.
 * Dates are stored as ISO strings so the FSRSCard <-> record round-trip is lossless
 * (reconstructed via `new Date(...)`).
 */
export interface LearnerCardRecord {
  learner_id: string;
  card_id: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

/**
 * Maps a ts-fsrs Card into a persistable LearnerCardRecord.
 * `due` and `last_review` are Date objects on the FSRS card (see vocabularyService),
 * so they are serialized with `.toISOString()` to match the stored representation.
 */
export const cardToRecord = (
  card: FSRSCard,
  ids: { learnerId: string; cardId: string }
): LearnerCardRecord => ({
  learner_id: ids.learnerId,
  card_id: ids.cardId,
  due: card.due.toISOString(),
  stability: card.stability,
  difficulty: card.difficulty,
  elapsed_days: card.elapsed_days,
  scheduled_days: card.scheduled_days,
  reps: card.reps,
  lapses: card.lapses,
  state: card.state,
  last_review: card.last_review ? card.last_review.toISOString() : null,
});
