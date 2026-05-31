import { describe, it, expect, beforeEach } from 'vitest';
import { Rating } from 'ts-fsrs';
import {
  fetchCardsForSession,
  submitCardReview,
  fetchTopicsAndProgress,
} from '../vocabularyService';
import { submitWritingContent } from '../writingService';
import { fetchAIConversationResponse } from '../speakingService';
import { recordExerciseCompletion } from '../exerciseService';

// =============================================================================
// KNOWN-BUG characterization tests  [TODO_S4]  -- EXPECTED TO FAIL NOW.
//
// These assert the INTENDED behavior per business-rules.md (BR-STREAK / BR-LAPSES)
// for the two known defects that CH2 + CH3 will fix in Stage 4. They are written
// as plain failing tests on purpose: they are RED today and MUST go GREEN after
// the S4 fix. Do NOT "fix" them by editing the test -- they are the acceptance
// gate for S4. Do NOT convert to it.fails (that would invert the contract:
// green-now / red-after-fix).
//
// Run (will report failures NOW, by design):
//   npx vitest run src/lib/__tests__/knownBugs.todo-s4.test.ts
// =============================================================================

const userId = 'learner-bugs';
const TOPIC = 'topic-business';

beforeEach(() => {
  localStorage.clear();
});

// -----------------------------------------------------------------------------
// CH2 BR-STREAK: streak must advance on ANY of the four activities, and a day
// that had a non-vocab activity must NOT be treated as a missed day (the
// "streak reset on missed day" bug). Today only submitCardReview touches streak.
// -----------------------------------------------------------------------------
describe('CH2 streak any-activity [TODO_S4] (RED until S4)', () => {
  it('[TODO_S4] CH2-01 a Free Writing submission records activity + sets streak=1 (AC-2.1/2.2)', async () => {
    const today = new Date().toISOString().split('T')[0];
    await submitWritingContent(userId, 'Prompt', 'A short essay about my day and goals.', true);

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(1);
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });

  it('[TODO_S4] CH2-02 a Speaking session records activity + sets streak=1 (AC-2.2)', async () => {
    const today = new Date().toISOString().split('T')[0];
    await fetchAIConversationResponse(
      userId,
      'Technology',
      [{ role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
      true,
    );

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(1);
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });

  it('[TODO_S4] CH2-03 a Structured Exercise completion records activity + sets streak=1 (AC-2.2)', async () => {
    const today = new Date().toISOString().split('T')[0];
    await recordExerciseCompletion(userId, true);

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(1);
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });

  it('[TODO_S4] CH2-04 active yesterday via Writing then vocab today -> streak=prev+1, NOT reset (AC-2.3, headline missed-day bug)', async () => {
    // Simulate: yesterday the learner's only activity was a Writing submission,
    // recorded through the (future) shared activity path -> streak 2.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(`learnt_last_activity_${userId}`, yesterday);
    localStorage.setItem(`learnt_profile_${userId}`, JSON.stringify({ current_streak: 2, longest_streak: 2 }));

    // Today: do a Writing submission (a non-vocab activity) as the first action.
    await submitWritingContent(userId, 'Prompt', 'Continuing my streak with some writing today.', true);

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(3); // prev(2)+1, because yesterday counted
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });
});

// -----------------------------------------------------------------------------
// CH3 BR-LAPSES: the mock learner_card record must include `lapses` and must NOT
// carry the phantom `topic_id`. Today the mock savedRecord drops lapses and
// emits topic_id (cloud is correct). One shared cardToRecord mapper fixes this.
// -----------------------------------------------------------------------------
describe('CH3 mock/cloud lapses parity [TODO_S4] (RED until S4)', () => {
  async function persistOneMockReview() {
    await fetchTopicsAndProgress(userId, true); // seed
    const card = (await fetchCardsForSession(userId, TOPIC, true, 'learn'))[0];
    await submitCardReview(userId, card.id, TOPIC, Rating.Again, true);
    const records = JSON.parse(localStorage.getItem(`learnt_learner_cards_${userId}`) || '[]');
    return { card, record: records.find((r: { card_id: string }) => r.card_id === card.id) };
  }

  it('[TODO_S4] CH3-01 persisted mock record includes a numeric `lapses` field (AC-3.1/3.2)', async () => {
    const { record } = await persistOneMockReview();
    expect(record).toBeDefined();
    expect('lapses' in record).toBe(true);
    expect(typeof record.lapses).toBe('number');
  });

  it('[TODO_S4] CH3-02 persisted mock record does NOT carry phantom `topic_id` (AC-3.3)', async () => {
    const { record } = await persistOneMockReview();
    expect(record).toBeDefined();
    expect('topic_id' in record).toBe(false);
  });
});
