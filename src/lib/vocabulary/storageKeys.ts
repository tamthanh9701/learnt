// Char-identical to the inline template literals in vocabularyService.ts.
// Do NOT change these strings — storage compatibility (AC-06/AC-09) + Flag 1.
export const seededKey = (userId: string): string => `learnt_seeded_${userId}`;
export const topicsKey = (userId: string): string => `learnt_topics_${userId}`;
export const flashcardsKey = (userId: string): string => `learnt_flashcards_${userId}`;
export const learnerCardsKey = (userId: string): string => `learnt_learner_cards_${userId}`;
export const progressKey = (userId: string, today: string): string => `learnt_progress_${userId}_${today}`;
