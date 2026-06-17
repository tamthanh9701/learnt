import { supabase } from '../supabase';
import { withTimeout } from '../timeout';
import { dayKey } from '../streak';
import { learnerCardsKey, progressKey } from './storageKeys';
import type { LearnerCardRecord } from '../learnerCard';

export interface DashboardStats {
  dueCount: number;
  reviewedToday: number;
}

/**
 * Read-model for the Dashboard's two data reads. Behavior-preserving extraction
 * of DashboardPage's inline reads (DashboardPage.tsx:28-95).
 *
 * Rethrows ALL errors (TimeoutError AND non-timeout). Callers own error mapping.
 */
export async function fetchDashboardStats(
  userId: string,
  isMock: boolean,
): Promise<DashboardStats> {
  if (isMock) {
    // Simulate loading mock data from localStorage
    const savedCards = localStorage.getItem(learnerCardsKey(userId));
    let dueCount: number;
    if (savedCards) {
      const cards: LearnerCardRecord[] = JSON.parse(savedCards);
      const now = new Date();
      dueCount = cards.filter(c => new Date(c.due) <= now).length;
    } else {
      // Set 5 default due cards for first-time use
      dueCount = 5;
    }

    // Get daily progress
    const today = new Date().toISOString().split('T')[0];
    const savedProgress = localStorage.getItem(progressKey(userId, today));
    let reviewedToday = 0;
    if (savedProgress) {
      const p = JSON.parse(savedProgress);
      reviewedToday = p.cards_reviewed || 0;
    }

    return { dueCount, reviewedToday };
  }

  // Fetch from Supabase — each query gets its own 8 s AbortController timeout
  // so a slow / hung backend cannot leave the caller hanging forever.
  const now = new Date().toISOString();
  const today = dayKey(new Date());

  let dueCount = 0;
  let reviewedToday = 0;

  // 1. Count due cards. Runs first; if it throws, the function exits BEFORE
  //    the progress fetch (sequential await, NOT Promise.all).
  const cardRes = await withTimeout(
    async (signal) => {
      const { count, error } = await supabase
        .from('learner_cards')
        .select('*', { count: 'exact', head: true })
        .eq('learner_id', userId)
        .lte('due', now)
        .abortSignal(signal);
      if (error) throw error;
      return count;
    },
    8_000,
    'DashboardPage: due cards count',
  );
  // count null → leave dueCount unchanged (do NOT force 0).
  if (typeof cardRes === 'number') dueCount = cardRes;

  // 2. Fetch today's progress. Only reached if the due query did NOT throw.
  const progRes = await withTimeout(
    async (signal) => {
      const { data, error } = await supabase
        .from('daily_progress')
        .select('cards_reviewed')
        .eq('learner_id', userId)
        .eq('activity_date', today)
        .abortSignal(signal)
        .maybeSingle();
      // PGRST116 = row not found, perfectly fine here.
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    8_000,
    'DashboardPage: daily progress',
  );
  if (progRes) {
    reviewedToday = progRes.cards_reviewed;
  }

  return { dueCount, reviewedToday };
}
