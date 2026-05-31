import { describe, it, expect, beforeEach } from 'vitest';
import { Rating, createEmptyCard, fsrs } from 'ts-fsrs';
import type { Grade } from 'ts-fsrs';
import {
  fetchCardsForSession,
  submitCardReview,
  getDueCardsCount,
  fetchTopicsAndProgress,
} from '../vocabularyService';
import { seedFlashcards, seedTopics } from '../../data/seedVocabulary';

// CHARACTERIZATION (protected baseline) - vocabularyService mock path.
// Pins the CURRENT vocab review flow: seeding, due-filtering, learn/review
// split, FSRS round-trip, daily_progress counters. Must stay GREEN through
// CH1/CH2/CH3/CH6. Uses isMock=true so happy-dom localStorage is the store.
// Re-run: npx vitest run src/lib/__tests__/vocabularyReview.test.ts

const userId = 'learner-vocab';
const TOPIC = 'topic-business';
const topicCardCount = seedFlashcards.filter(c => c.topic_id === TOPIC).length;

beforeEach(() => {
  localStorage.clear();
});

describe('seedDatabaseIfNeeded / fetchTopicsAndProgress [TC-SEED]', () => {
  it('TC-SEED-01 seeds localStorage and returns all seeded topics with totals', async () => {
    const topics = await fetchTopicsAndProgress(userId, true);
    expect(topics.length).toBe(seedTopics.length);
    const biz = topics.find(t => t.id === TOPIC)!;
    expect(biz.totalCards).toBe(topicCardCount);
    expect(biz.learnedCards).toBe(0);
    expect(biz.dueCards).toBe(0);
  });
});

describe('fetchCardsForSession learn/review split [TC-SESSION]', () => {
  it('TC-SESSION-01 learn mode returns all unstudied cards in the topic', async () => {
    await fetchTopicsAndProgress(userId, true); // ensure seeded
    const learn = await fetchCardsForSession(userId, TOPIC, true, 'learn');
    expect(learn.length).toBe(topicCardCount);
    expect(learn.every(c => c.topic_id === TOPIC)).toBe(true);
    expect(learn[0].fsrsCard).toBeUndefined();
  });

  it('TC-SESSION-02 review mode returns nothing before any card is studied', async () => {
    await fetchTopicsAndProgress(userId, true);
    const review = await fetchCardsForSession(userId, TOPIC, true, 'review');
    expect(review).toEqual([]);
  });

  it('TC-SESSION-03 a studied card leaves learn mode (no longer unstudied)', async () => {
    await fetchTopicsAndProgress(userId, true);
    const learn = await fetchCardsForSession(userId, TOPIC, true, 'learn');
    const first = learn[0];
    await submitCardReview(userId, first.id, TOPIC, Rating.Good, true);

    const learnAfter = await fetchCardsForSession(userId, TOPIC, true, 'learn');
    expect(learnAfter.find(c => c.id === first.id)).toBeUndefined();
    expect(learnAfter.length).toBe(topicCardCount - 1);
  });

  it('TC-SESSION-04 a freshly-studied card is scheduled into the future (learning step), so it is NOT immediately due in review', async () => {
    await fetchTopicsAndProgress(userId, true);
    const learn = await fetchCardsForSession(userId, TOPIC, true, 'learn');
    const card = learn[0];
    const saved = await submitCardReview(userId, card.id, TOPIC, Rating.Again, true);

    // ts-fsrs defaults put an Again-rated new card in a learning step minutes ahead.
    expect(saved.due.getTime()).toBeGreaterThan(Date.now());

    const review = await fetchCardsForSession(userId, TOPIC, true, 'review');
    expect(review.find(c => c.id === card.id)).toBeUndefined();
  });
});

// Helper: back-date a persisted learner_card's `due` into the past so it
// surfaces in review mode (every rating on a fresh card schedules due ahead).
function backdateDue(uId: string, cardId: string) {
  const key = `learnt_learner_cards_${uId}`;
  const records = JSON.parse(localStorage.getItem(key) || '[]');
  const idx = records.findIndex((r: { card_id: string }) => r.card_id === cardId);
  records[idx].due = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  localStorage.setItem(key, JSON.stringify(records));
  return records[idx].due as string;
}

describe('submitCardReview FSRS round-trip + grade mapping [TC-FSRS]', () => {
  it('TC-FSRS-01 returns the exact next-state the ts-fsrs scheduler computes for the rating', async () => {
    await fetchTopicsAndProgress(userId, true);
    const card = (await fetchCardsForSession(userId, TOPIC, true, 'learn'))[0];

    // Independently reproduce the scheduler's expectation for an empty card.
    const fixedNow = new Date();
    const expected = fsrs().repeat(createEmptyCard(fixedNow), fixedNow)[Rating.Good as Grade].card;

    const result = await submitCardReview(userId, card.id, TOPIC, Rating.Good, true);
    // reps advances from 0->1 and state leaves the New(0) state, same as scheduler.
    expect(result.reps).toBe(expected.reps);
    expect(result.state).toBe(expected.state);
    expect(result.stability).toBeGreaterThan(0);
  });

  it('TC-FSRS-02 persisted learner_card round-trips back through fetchCardsForSession losslessly', async () => {
    await fetchTopicsAndProgress(userId, true);
    const card = (await fetchCardsForSession(userId, TOPIC, true, 'learn'))[0];
    const saved = await submitCardReview(userId, card.id, TOPIC, Rating.Again, true);
    // Back-date due so the card surfaces in review mode for reconstruction.
    const backdated = backdateDue(userId, card.id);

    const reloaded = (await fetchCardsForSession(userId, TOPIC, true, 'review')).find(c => c.id === card.id)!;
    expect(reloaded.fsrsCard!.due.toISOString()).toBe(backdated);
    expect(reloaded.fsrsCard!.stability).toBe(saved.stability);
    expect(reloaded.fsrsCard!.difficulty).toBe(saved.difficulty);
    expect(reloaded.fsrsCard!.reps).toBe(saved.reps);
    expect(reloaded.fsrsCard!.state).toBe(saved.state);
  });

  it('TC-FSRS-03 getDueCardsCount reflects a card whose due has elapsed', async () => {
    await fetchTopicsAndProgress(userId, true);
    const card = (await fetchCardsForSession(userId, TOPIC, true, 'learn'))[0];
    await submitCardReview(userId, card.id, TOPIC, Rating.Again, true);
    // Freshly-rated cards are scheduled ahead; none due yet.
    expect(await getDueCardsCount(userId, true)).toBe(0);
    // Once due elapses, it counts.
    backdateDue(userId, card.id);
    expect(await getDueCardsCount(userId, true)).toBeGreaterThanOrEqual(1);
  });
});

describe('vocab-path streak (currently working baseline) [TC-STREAKG]', () => {
  it('TC-STREAKG-01 first-ever vocab review sets current_streak=1 (AC-2.1)', async () => {
    await fetchTopicsAndProgress(userId, true);
    const card = (await fetchCardsForSession(userId, TOPIC, true, 'learn'))[0];
    const today = new Date().toISOString().split('T')[0];

    await submitCardReview(userId, card.id, TOPIC, Rating.Good, true);

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(1);
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });

  it('TC-STREAKG-02 second vocab review same day does NOT change streak (AC-2.4)', async () => {
    await fetchTopicsAndProgress(userId, true);
    const cards = await fetchCardsForSession(userId, TOPIC, true, 'learn');

    await submitCardReview(userId, cards[0].id, TOPIC, Rating.Good, true);
    await submitCardReview(userId, cards[1].id, TOPIC, Rating.Good, true);

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(1);
  });

  it('TC-STREAKG-03 active "yesterday" via vocab then today -> streak=prev+1 (AC-2.3)', async () => {
    await fetchTopicsAndProgress(userId, true);
    const card = (await fetchCardsForSession(userId, TOPIC, true, 'learn'))[0];

    // Simulate prior history: active yesterday with a streak of 3.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    localStorage.setItem(`learnt_last_activity_${userId}`, yesterday);
    localStorage.setItem(`learnt_profile_${userId}`, JSON.stringify({ current_streak: 3, longest_streak: 3 }));

    await submitCardReview(userId, card.id, TOPIC, Rating.Good, true);

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(4);
    expect(profile.longest_streak).toBe(4);
  });
});

describe('daily_progress counters (mock) [TC-PROG]', () => {
  it('TC-PROG-01 first review of the day creates the record at cards_reviewed=1', async () => {
    await fetchTopicsAndProgress(userId, true);
    const card = (await fetchCardsForSession(userId, TOPIC, true, 'learn'))[0];
    const today = new Date().toISOString().split('T')[0];

    await submitCardReview(userId, card.id, TOPIC, Rating.Good, true);
    const progress = JSON.parse(localStorage.getItem(`learnt_progress_${userId}_${today}`) || '{}');
    expect(progress.cards_reviewed).toBe(1);
  });

  it('TC-PROG-02 a second review the same day increments to 2 (no reset)', async () => {
    await fetchTopicsAndProgress(userId, true);
    const cards = await fetchCardsForSession(userId, TOPIC, true, 'learn');
    const today = new Date().toISOString().split('T')[0];

    await submitCardReview(userId, cards[0].id, TOPIC, Rating.Good, true);
    await submitCardReview(userId, cards[1].id, TOPIC, Rating.Good, true);

    const progress = JSON.parse(localStorage.getItem(`learnt_progress_${userId}_${today}`) || '{}');
    expect(progress.cards_reviewed).toBe(2);
  });
});
