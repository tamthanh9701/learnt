import { supabase } from './supabase';
import { Rating } from 'ts-fsrs';
import type { Card as FSRSCard } from 'ts-fsrs';
import { recordActivity } from './streak';
import { cardToRecord } from './learnerCard';
import type { LearnerCardRecord } from './learnerCard';
import { seedTopics, seedFlashcards } from '../data/seedVocabulary';
import type { SeedTopic, SeedFlashcard } from '../data/seedVocabulary';
import { withTimeout } from './timeout';
import { recordToFsrsCard, newFsrsCard, scheduleReview } from './vocabulary/fsrsScheduler';
import { seededKey, topicsKey, flashcardsKey, learnerCardsKey, progressKey } from './vocabulary/storageKeys';


export interface TopicProgress {
  id: string;
  name_en: string;
  name_vi: string;
  description_en: string;
  description_vi: string;
  totalCards: number;
  learnedCards: number;
  dueCards: number;
}

// CH4 (diagnosis 2026-06-06, fix-4): typed errors so the page can
// render a useful message + retry button. The pre-fix code
// `console.error`'d the seed failure and silently returned an empty
// topic list, so Learners had no way to know whether the cause was
// RLS, an empty topics table, a network error, or a 401 from a
// stale JWT. Now we throw a small union of `kind`s, the page
// branches on them.
export type VocabErrorKind = 'seed_failed' | 'fetch_failed' | 'empty';

export class VocabError extends Error {
  kind: VocabErrorKind;
  cause?: unknown;
  constructor(kind: VocabErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'VocabError';
    this.kind = kind;
    this.cause = cause;
  }
}

export interface ReviewSessionCard {
  id: string;
  topic_id?: string;
  word: string;
  part_of_speech: string;
  phonetic: string;
  definition_en: string;
  definition_vi: string;
  example_en: string;
  example_vi: string;
  // FSRS scheduler card state if already studied
  fsrsCard?: FSRSCard;
}

/**
 * Seeding helper to populate localStorage or Supabase on first run.
 *
 * CH4: this function USED to swallow seed failures (console.error
 * only) and return normally. The page then saw an empty topic list
 * and had no way to surface the cause. Now we throw a typed
 * VocabError('seed_failed', ...) so the page can render a useful
 * message ("check RLS policies on topics/flashcards") and a retry
 * button. The function still never throws in the happy path.
 *
 * CH7 (2026-06-07, P1-#3): in cloud mode this function is effectively
 * dead code - migration 004 enabled RLS on `topics` and
 * `flashcards` with ONLY a SELECT policy, so the INSERT path
 * below ALWAYS fails with a 42501 (RLS violation) for an
 * authenticated user. The CH4 error path correctly surfaces this
 * as a 'seed_failed' VocabError with an RLS hint. The proper
 * remediation is migration 005 (run by the project owner) which
 * seeds via the service_role key. Until then, the app works
 * because migrations 001-004 are assumed to have already seeded
 * the topics and flashcards tables.
 */
export const seedDatabaseIfNeeded = async (userId: string, isMock: boolean): Promise<void> => {
  if (isMock) {
    // Check if topics are seeded
    const seeded = localStorage.getItem(seededKey(userId));
    if (!seeded) {
      localStorage.setItem(topicsKey(userId), JSON.stringify(seedTopics));
      localStorage.setItem(flashcardsKey(userId), JSON.stringify(seedFlashcards));
      localStorage.setItem(learnerCardsKey(userId), JSON.stringify([]));
      localStorage.setItem(seededKey(userId), 'true');
    }
    return;
  }
  // Supabase Seeding
  // 1. Check if topics table is populated
  const { data: topics, error: topicsError } = await supabase.from('topics').select('id');
  if (topicsError) {
    throw new VocabError(
      'seed_failed',
      `Could not query the topics table: ${topicsError.message || topicsError.code || 'unknown'}. If you are running this in your own Supabase project, check the RLS policy on the topics table.`,
      topicsError,
    );
  }

  if (topics && topics.length > 0) {
    return; // already seeded
  }

  // 2. Seed topics (RLS may block this; surface the error)
  const { error: insertTopicsError } = await supabase.from('topics').insert(
    seedTopics.map(t => ({
      id: t.id,
      name_en: t.name_en,
      name_vi: t.name_vi,
      description_en: t.description_en,
      description_vi: t.description_vi,
    })),
  );
  if (insertTopicsError) {
    throw new VocabError(
      'seed_failed',
      `Could not insert seed topics: ${insertTopicsError.message || insertTopicsError.code || 'unknown'}. Most often this is an RLS policy blocking the authenticated user from writing to the topics table. The topics table must allow INSERT for authenticated users, OR a service_role key must seed the rows via a migration / Edge Function.`,
      insertTopicsError,
    );
  }

  // 3. Seed flashcards
  const { error: insertCardsError } = await supabase.from('flashcards').insert(
    seedFlashcards.map(c => ({
      id: c.id,
      topic_id: c.topic_id,
      word: c.word,
      part_of_speech: c.part_of_speech,
      phonetic: c.phonetic,
      definition_en: c.definition_en,
      definition_vi: c.definition_vi,
      example_en: c.example_en,
      example_vi: c.example_vi,
    })),
  );
  if (insertCardsError) {
    throw new VocabError(
      'seed_failed',
      `Topics were inserted but flashcards failed: ${insertCardsError.message || insertCardsError.code || 'unknown'}. Check the flashcards table RLS policy and that the topics foreign key exists.`,
      insertCardsError,
    );
  }
};

/**
 * Fetch topics with FSRS progress details
 */
export const fetchTopicsAndProgress = async (userId: string, isMock: boolean): Promise<TopicProgress[]> => {
  // CH4: surface seed failures (RLS-blocked inserts etc) so the
  // page can render them, instead of silently returning an empty
  // topic list.
  await seedDatabaseIfNeeded(userId, isMock);

  if (isMock) {
    const topics: SeedTopic[] = JSON.parse(localStorage.getItem(topicsKey(userId)) || '[]');
    const flashcards: SeedFlashcard[] = JSON.parse(localStorage.getItem(flashcardsKey(userId)) || '[]');
    const learnerCards: LearnerCardRecord[] = JSON.parse(localStorage.getItem(learnerCardsKey(userId)) || '[]');

    const now = new Date();

    if (topics.length === 0) {
      // Should not happen since seedDatabaseIfNeeded populates
      // localStorage on first call, but guard against the case
      // where the user cleared localStorage between page loads
      // and we re-fetched before the seed write completed.
      throw new VocabError(
        'empty',
        'No topics were found in local storage. Try the "Reset Progress" action in Settings to re-seed.',
      );
    }

    return topics.map(topic => {
      const topicCards = flashcards.filter(c => c.topic_id === topic.id);
      const totalCards = topicCards.length;

      const topicLearnedCards = learnerCards.filter(lc => {
        const cardObj = topicCards.find(c => c.id === lc.card_id);
        return !!cardObj;
      });

      const learnedCards = topicLearnedCards.length;
      const dueCards = topicLearnedCards.filter(lc => new Date(lc.due) <= now).length;

      return {
        ...topic,
        totalCards,
        learnedCards,
        dueCards,
      };
    });
  }
  // Supabase implementation
  const { data: topics, error: topicsErr } = await supabase.from('topics').select('*');
  if (topicsErr) {
    throw new VocabError(
      'fetch_failed',
      `Could not read topics: ${topicsErr.message || topicsErr.code || 'unknown'}. This is usually a network or auth issue - check that you are signed in and have a stable connection.`,
      topicsErr,
    );
  }

  const { data: flashcards, error: cardsErr } = await supabase.from('flashcards').select('id, topic_id');
  if (cardsErr) {
    throw new VocabError(
      'fetch_failed',
      `Could not read flashcards: ${cardsErr.message || cardsErr.code || 'unknown'}.`,
      cardsErr,
    );
  }

  const { data: learnerCardsRaw, error: learnerErr } = await supabase
    .from('learner_cards')
    .select('card_id, due')
    .eq('learner_id', userId);
  // The Supabase client's return type for `.select()` is generic
  // `any[]`. The runtime shape matches LearnerCardRecord (we only
  // select the two fields we use), so we cast at the boundary
  // here. The `LearnerCardRecord` type is the canonical record
  // type; learner_cards rows are a strict subset of it.
  const learnerCards: LearnerCardRecord[] = (learnerCardsRaw ?? []) as LearnerCardRecord[];
  if (learnerErr) {
    throw new VocabError(
      'fetch_failed',
      `Could not read learner_cards: ${learnerErr.message || learnerErr.code || 'unknown'}.`,
      learnerErr,
    );
  }

  if (!topics || topics.length === 0) {
    throw new VocabError(
      'empty',
      'The topics table is empty in Supabase. The seed step should have populated it - check the RLS policy that blocks authenticated users from inserting, or run a service_role seed migration.',
    );
  }

  const now = new Date().toISOString();

  return (topics || []).map(topic => {
    const topicCardIds = (flashcards || []).filter(c => c.topic_id === topic.id).map(c => c.id);
    const totalCards = topicCardIds.length;

    const topicLearned = (learnerCards || []).filter(lc => topicCardIds.includes(lc.card_id));
    const learnedCards = topicLearned.length;
    const dueCards = topicLearned.filter(lc => lc.due <= now).length;

    return {
      id: topic.id,
      name_en: topic.name_en,
      name_vi: topic.name_vi,
      description_en: topic.description_en,
      description_vi: topic.description_vi,
      totalCards,
      learnedCards,
      dueCards,
    };
  });
};

/**
 * Get due count for all cards (to show on dashboard)
 */
export const getDueCardsCount = async (userId: string, isMock: boolean): Promise<number> => {
  if (isMock) {
    const learnerCards: LearnerCardRecord[] = JSON.parse(localStorage.getItem(learnerCardsKey(userId)) || '[]');
    const now = new Date();
    return learnerCards.filter(lc => new Date(lc.due) <= now).length;
  } else {
    const now = new Date().toISOString();
    const { count, error } = await supabase
      .from('learner_cards')
      .select('*', { count: 'exact', head: true })
      .eq('learner_id', userId)
      .lte('due', now);
    
    if (error) return 0;
    return count || 0;
  }
};

/**
 * Fetch cards for review or learning session
 */
export const fetchCardsForSession = async (
  userId: string,
  topicId: string,
  isMock: boolean,
  type: 'review' | 'learn'
): Promise<ReviewSessionCard[]> => {
  if (isMock) {
    const flashcards: SeedFlashcard[] = JSON.parse(localStorage.getItem(flashcardsKey(userId)) || '[]');
    const learnerCards: LearnerCardRecord[] = JSON.parse(localStorage.getItem(learnerCardsKey(userId)) || '[]');

    const topicCards = flashcards.filter(c => c.topic_id === topicId);
    const now = new Date();

    if (type === 'review') {
      const sessionCards: ReviewSessionCard[] = [];
      for (const card of topicCards) {
        const lc = learnerCards.find(l => l.card_id === card.id);
        if (lc && new Date(lc.due) <= now) {
          const fsrsCard: FSRSCard = recordToFsrsCard(lc);
          sessionCards.push({
            id: card.id,
            topic_id: card.topic_id,
            word: card.word,
            part_of_speech: card.part_of_speech,
            phonetic: card.phonetic,
            definition_en: card.definition_en,
            definition_vi: card.definition_vi,
            example_en: card.example_en,
            example_vi: card.example_vi,
            fsrsCard,
          });
        }
      }
      return sessionCards;
    } else {
      // Learn mode: Return cards in this topic that have NOT been studied yet
      return topicCards
        .filter(card => !learnerCards.some(lc => lc.card_id === card.id))
        .map(card => ({
          id: card.id,
          topic_id: card.topic_id,
          word: card.word,
          part_of_speech: card.part_of_speech,
          phonetic: card.phonetic,
          definition_en: card.definition_en,
          definition_vi: card.definition_vi,
          example_en: card.example_en,
          example_vi: card.example_vi,
        }));
    }
  } else {
    // Supabase implementation
    // Get flashcards in topic
    const { data: flashcards, error: cardsErr } = await supabase
      .from('flashcards')
      .select('*')
      .eq('topic_id', topicId);
    if (cardsErr) throw cardsErr;

    const flashcardIds = (flashcards || []).map(c => c.id);

    // Get learner status
    const { data: learnerCardsRaw, error: learnerErr } = await supabase
      .from('learner_cards')
      .select('*')
      .eq('learner_id', userId)
      .in('card_id', flashcardIds);
    const learnerCards: LearnerCardRecord[] = (learnerCardsRaw ?? []) as LearnerCardRecord[];
    if (learnerErr) throw learnerErr;

    const now = new Date().toISOString();

    if (type === 'review') {
      const sessionCards: ReviewSessionCard[] = [];
      for (const card of (flashcards || [])) {
        const lc = (learnerCards || []).find(l => l.card_id === card.id);
        if (lc && lc.due <= now) {
          const fsrsCard: FSRSCard = recordToFsrsCard(lc);
          sessionCards.push({
            id: card.id,
            topic_id: card.topic_id,
            word: card.word,
            part_of_speech: card.part_of_speech,
            phonetic: card.phonetic,
            definition_en: card.definition_en,
            definition_vi: card.definition_vi,
            example_en: card.example_en,
            example_vi: card.example_vi,
            fsrsCard,
          });
        }
      }
      return sessionCards;
    } else {
      // Return cards not studied yet
      const learnedIds = (learnerCards || []).map(lc => lc.card_id);
      return (flashcards || [])
        .filter(card => !learnedIds.includes(card.id))
        .map(card => ({
          id: card.id,
          topic_id: card.topic_id,
          word: card.word,
          part_of_speech: card.part_of_speech,
          phonetic: card.phonetic,
          definition_en: card.definition_en,
          definition_vi: card.definition_vi,
          example_en: card.example_en,
          example_vi: card.example_vi,
        }));
    }
  }
};

/**
 * Submits a card review rating, recalculates parameters using FSRS, and updates card record & streak
 */
export const submitCardReview = async (
  userId: string,
  cardId: string,
  _topicId: string,
  rating: Rating, // 1: Again, 2: Hard, 3: Good, 4: Easy
  isMock: boolean
): Promise<FSRSCard> => {
  const now = new Date();

  // 1. Fetch current card state
  let currentFsrsCard: FSRSCard;

  if (isMock) {
    const learnerCards: LearnerCardRecord[] = JSON.parse(localStorage.getItem(learnerCardsKey(userId)) || '[]');
    const lc = learnerCards.find(l => l.card_id === cardId);

    if (lc) {
      currentFsrsCard = recordToFsrsCard(lc);
    } else {
      currentFsrsCard = newFsrsCard(now);
    }
  } else {
    const { data, error } = await supabase
      .from('learner_cards')
      .select('*')
      .eq('learner_id', userId)
      .eq('card_id', cardId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (data) {
      currentFsrsCard = recordToFsrsCard(data);
    } else {
      currentFsrsCard = newFsrsCard(now);
    }
  }

  // 2. Schedule next state using ts-fsrs algorithm
  const nextCardState = scheduleReview(currentFsrsCard, rating, now);

  // 3. Save updated card
  if (isMock) {
    const learnerCards: LearnerCardRecord[] = JSON.parse(localStorage.getItem(learnerCardsKey(userId)) || '[]');
    const index = learnerCards.findIndex(l => l.card_id === cardId);

    const existing = index >= 0 ? learnerCards[index] : undefined;
    const savedRecord = {
      ...cardToRecord(nextCardState, { learnerId: userId, cardId }),
      created_at: existing?.created_at ?? now.toISOString(),
    };

    if (index >= 0) {
      learnerCards[index] = savedRecord;
    } else {
      learnerCards.push(savedRecord);
    }
    localStorage.setItem(learnerCardsKey(userId), JSON.stringify(learnerCards));

    // Update progress tracker
    const today = now.toISOString().split('T')[0];
    const todayProgressKey = progressKey(userId, today);
    const progress = JSON.parse(localStorage.getItem(todayProgressKey) || '{"cards_reviewed": 0}');
    progress.cards_reviewed += 1;
    localStorage.setItem(todayProgressKey, JSON.stringify(progress));

    // Streak handled centrally (any-activity, reset-on-gap)
    await recordActivity(userId, true, now);
  } else {
    // Supabase saving
    const savedRecord = cardToRecord(nextCardState, { learnerId: userId, cardId });

    // Upsert card status
    const { data: lcRow, error: upsertErr } = await supabase
      .from('learner_cards')
      .upsert(savedRecord, { onConflict: 'learner_id,card_id' })
      .select('id')
      .single();
    if (upsertErr) throw upsertErr;

    // Log the review action in review_logs table
    if (lcRow) {
      const { error: logErr } = await supabase
        .from('review_logs')
        .insert({
          learner_id: userId,
          learner_card_id: lcRow.id,
          rating: rating,
          state: nextCardState.state,
          due: nextCardState.due.toISOString(),
          stability: nextCardState.stability,
          difficulty: nextCardState.difficulty,
          elapsed_days: nextCardState.elapsed_days,
          scheduled_days: nextCardState.scheduled_days,
        });
      if (logErr) {
        console.warn('Could not write to review_logs table:', logErr);
      }
    }

    // Call Supabase daily_progress tracker
    // CH7 (2026-06-07, P3-#24): same timeout treatment as writing
    // and exercise services. The pre-fix code was unwrapped, so
    // a slow / hung backend could keep the function running for
    // 30+ seconds with no feedback to the user.
    const today = now.toISOString().split('T')[0];
    const progress = await withTimeout(
      async (signal) => {
        const res = await supabase
          .from('daily_progress')
          .select('*')
          .eq('learner_id', userId)
          .eq('activity_date', today)
          .abortSignal(signal)
          .single();
        // PGRST116 = row not found, fine here (will create below).
        if (res.error && res.error.code !== 'PGRST116') throw res.error;
        return res.data;
      },
      5_000,
      'vocabularyService: readDailyProgress',
    );

    if (!progress) {
      // First review today, insert record
      await withTimeout(
        async (signal) => {
          // Same typing workaround as writing/exercise/streak
          // services: cast to a permissive type for the
          // .from().insert() chain. See streak.ts for the full
          // rationale.
          const builder = supabase.from('daily_progress').insert({
            learner_id: userId,
            activity_date: today,
            cards_reviewed: 1,
          }) as unknown as { abortSignal: (s: AbortSignal) => Promise<{ error: { message: string } | null }> };
          const r = await builder.abortSignal(signal);
          if (r.error) throw r.error;
        },
        5_000,
        'vocabularyService: insertDailyProgress',
      );

      // streak handled centrally below (decoupled from daily_progress)
    } else {
      await withTimeout(
        async (signal) => {
          const builder = supabase
            .from('daily_progress')
            .update({ cards_reviewed: progress.cards_reviewed + 1 })
            .eq('id', progress.id) as unknown as { abortSignal: (s: AbortSignal) => Promise<{ error: { message: string } | null }> };
          const r = await builder.abortSignal(signal);
          if (r.error) throw r.error;
        },
        5_000,
        'vocabularyService: updateDailyProgress',
      );
    }

    // Streak handled centrally (any-activity, reset-on-gap), decoupled from daily_progress
    await recordActivity(userId, false, now);
  }

  return nextCardState;
};
