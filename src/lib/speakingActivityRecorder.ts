/**
 * speakingActivityRecorder.ts — records one Speaking activity.
 *
 * One rule, one place: completing a Speaking activity (an AI Conversation turn
 * or a Pronunciation Drill attempt) bumps today's `speaking_minutes` by 1 and
 * touches the Streak via the shared `recordActivity`. Both Speaking domains call
 * through this single interface — two adapters (AI Conversation + Pronunciation
 * Drill) make the seam real.
 *
 * SCOPE: Speaking only. This deliberately does NOT unify activity recording
 * across Writing / Vocabulary — that is a separate, app-wide concern. If a future
 * app-wide activity recorder lands, it subsumes this one.
 *
 * Side-effect failures are swallowed (logged) — recording progress must never
 * break the Learner's session.
 */

import { supabase } from './supabase';
import { recordActivity } from './streak';

const mockProgressKey = (userId: string, day: string) => `learnt_progress_${userId}_${day}`;

/**
 * Record one Speaking activity for `userId` at `when` (defaults to now).
 * Bumps speaking_minutes +1 for the day and updates the Streak. Mock and cloud
 * parity. Never throws.
 */
export const recordSpeakingActivity = async (
  userId: string,
  isMock: boolean,
  when: Date = new Date(),
): Promise<void> => {
  const day = when.toISOString().split('T')[0];

  if (isMock) {
    const key = mockProgressKey(userId, day);
    const progress = JSON.parse(
      localStorage.getItem(key) || '{"cards_reviewed": 0, "speaking_minutes": 0}',
    );
    progress.speaking_minutes = (progress.speaking_minutes || 0) + 1;
    localStorage.setItem(key, JSON.stringify(progress));
    await recordActivity(userId, true, when);
    return;
  }

  try {
    const { data: progress, error: progErr } = await supabase
      .from('daily_progress')
      .select('*')
      .eq('learner_id', userId)
      .eq('activity_date', day)
      .single();

    if (!progErr && progress) {
      await supabase
        .from('daily_progress')
        .update({ speaking_minutes: (progress.speaking_minutes || 0) + 1 })
        .eq('id', progress.id);
    } else {
      await supabase.from('daily_progress').insert({
        learner_id: userId,
        activity_date: day,
        speaking_minutes: 1,
      });
    }
    await recordActivity(userId, false, when);
  } catch (dbErr) {
    console.error('Error recording speaking activity:', dbErr);
  }
};
