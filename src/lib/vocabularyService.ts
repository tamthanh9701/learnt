import { supabase } from './supabase';
import { seedTopics, seedFlashcards } from '../data/seedVocabulary';
import type { SeedTopic, SeedFlashcard } from '../data/seedVocabulary';
import { fsrs, createEmptyCard, Rating } from 'ts-fsrs';
import type { Card as FSRSCard, Grade } from 'ts-fsrs';
import { recordActivity } from './streak';
import { cardToRecord } from './learnerCard';


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

// Initialise FSRS with default parameters
const fsrsInstance = fsrs();


/**
 * Seeding helper to populate localStorage or Supabase on first run
 */
export const seedDatabaseIfNeeded = async (userId: string, isMock: boolean): Promise<void> => {
  if (isMock) {
    // Check if topics are seeded
    const seeded = localStorage.getItem(`learnt_seeded_${userId}`);
    if (!seeded) {
      localStorage.setItem(`learnt_topics_${userId}`, JSON.stringify(seedTopics));
      localStorage.setItem(`learnt_flashcards_${userId}`, JSON.stringify(seedFlashcards));
      localStorage.setItem(`learnt_learner_cards_${userId}`, JSON.stringify([]));
      localStorage.setItem(`learnt_seeded_${userId}`, 'true');
    }
  } else {
    // Supabase Seeding
    try {
      // 1. Check if topics table is populated
      const { data: topics, error: topicsError } = await supabase.from('topics').select('id');
      if (topicsError) throw topicsError;

      if (!topics || topics.length === 0) {
        // Seed topics
        const { error: insertTopicsError } = await supabase.from('topics').insert(
          seedTopics.map(t => ({
            id: t.id,
            name_en: t.name_en,
            name_vi: t.name_vi,
            description_en: t.description_en,
            description_vi: t.description_vi,
          }))
        );
        if (insertTopicsError) throw insertTopicsError;

        // Seed flashcards
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
          }))
        );
        if (insertCardsError) throw insertCardsError;
      }
    } catch (err) {
      console.error('Error seeding Supabase:', err);
    }
  }
};

/**
 * Fetch topics with FSRS progress details
 */
export const fetchTopicsAndProgress = async (userId: string, isMock: boolean): Promise<TopicProgress[]> => {
  await seedDatabaseIfNeeded(userId, isMock);

  if (isMock) {
    const topics: SeedTopic[] = JSON.parse(localStorage.getItem(`learnt_topics_${userId}`) || '[]');
    const flashcards: SeedFlashcard[] = JSON.parse(localStorage.getItem(`learnt_flashcards_${userId}`) || '[]');
    const learnerCards: any[] = JSON.parse(localStorage.getItem(`learnt_learner_cards_${userId}`) || '[]');

    const now = new Date();

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
  } else {
    // Supabase implementation
    const { data: topics, error: topicsErr } = await supabase.from('topics').select('*');
    if (topicsErr) throw topicsErr;

    const { data: flashcards, error: cardsErr } = await supabase.from('flashcards').select('id, topic_id');
    if (cardsErr) throw cardsErr;

    const { data: learnerCards, error: learnerErr } = await supabase
      .from('learner_cards')
      .select('card_id, due')
      .eq('learner_id', userId);
    if (learnerErr) throw learnerErr;

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
  }
};

/**
 * Get due count for all cards (to show on dashboard)
 */
export const getDueCardsCount = async (userId: string, isMock: boolean): Promise<number> => {
  if (isMock) {
    const learnerCards: any[] = JSON.parse(localStorage.getItem(`learnt_learner_cards_${userId}`) || '[]');
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
    const flashcards: SeedFlashcard[] = JSON.parse(localStorage.getItem(`learnt_flashcards_${userId}`) || '[]');
    const learnerCards: any[] = JSON.parse(localStorage.getItem(`learnt_learner_cards_${userId}`) || '[]');

    const topicCards = flashcards.filter(c => c.topic_id === topicId);
    const now = new Date();

    if (type === 'review') {
      const sessionCards: ReviewSessionCard[] = [];
      for (const card of topicCards) {
        const lc = learnerCards.find(l => l.card_id === card.id);
        if (lc && new Date(lc.due) <= now) {
          const fsrsCard: FSRSCard = {
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
          };
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
    const { data: learnerCards, error: learnerErr } = await supabase
      .from('learner_cards')
      .select('*')
      .eq('learner_id', userId)
      .in('card_id', flashcardIds);
    if (learnerErr) throw learnerErr;

    const now = new Date().toISOString();

    if (type === 'review') {
      const sessionCards: ReviewSessionCard[] = [];
      for (const card of (flashcards || [])) {
        const lc = (learnerCards || []).find(l => l.card_id === card.id);
        if (lc && lc.due <= now) {
          const fsrsCard: FSRSCard = {
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
          };
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
    const learnerCards: any[] = JSON.parse(localStorage.getItem(`learnt_learner_cards_${userId}`) || '[]');
    const lc = learnerCards.find(l => l.card_id === cardId);

    if (lc) {
      currentFsrsCard = {
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
      };
    } else {
      currentFsrsCard = createEmptyCard(now);
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
      currentFsrsCard = {
        due: new Date(data.due),
        stability: data.stability,
        difficulty: data.difficulty,
        elapsed_days: data.elapsed_days,
        scheduled_days: data.scheduled_days,
        reps: data.reps,
        lapses: data.lapses || 0,
        state: data.state,
        learning_steps: data.learning_steps || 0,
        last_review: data.last_review ? new Date(data.last_review) : undefined,
      };
    } else {
      currentFsrsCard = createEmptyCard(now);
    }
  }

  // 2. Schedule next state using ts-fsrs algorithm
  const schedulingInfo = fsrsInstance.repeat(currentFsrsCard, now);
  const nextCardState = schedulingInfo[rating as Grade].card;

  // 3. Save updated card
  if (isMock) {
    const learnerCards: any[] = JSON.parse(localStorage.getItem(`learnt_learner_cards_${userId}`) || '[]');
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
    localStorage.setItem(`learnt_learner_cards_${userId}`, JSON.stringify(learnerCards));

    // Update progress tracker
    const today = now.toISOString().split('T')[0];
    const progressKey = `learnt_progress_${userId}_${today}`;
    const progress = JSON.parse(localStorage.getItem(progressKey) || '{"cards_reviewed": 0}');
    progress.cards_reviewed += 1;
    localStorage.setItem(progressKey, JSON.stringify(progress));

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
    const today = now.toISOString().split('T')[0];
    const { data: progress, error: progErr } = await supabase
      .from('daily_progress')
      .select('*')
      .eq('learner_id', userId)
      .eq('activity_date', today)
      .single();

    if (progErr && progErr.code === 'PGRST116') {
      // First review today, insert record
      await supabase.from('daily_progress').insert({
        learner_id: userId,
        activity_date: today,
        cards_reviewed: 1,
      });

      // streak handled centrally below (decoupled from daily_progress)
    } else if (progress) {
      await supabase
        .from('daily_progress')
        .update({ cards_reviewed: progress.cards_reviewed + 1 })
        .eq('id', progress.id);
    }

    // Streak handled centrally (any-activity, reset-on-gap), decoupled from daily_progress
    await recordActivity(userId, false, now);
  }

  return nextCardState;
};
