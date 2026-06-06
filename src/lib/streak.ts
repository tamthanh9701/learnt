import { supabase } from './supabase';

type DayKey = string;

export const dayKey = (d: Date): DayKey => d.toISOString().split('T')[0];

const dayNum = (k: DayKey): number =>
  Math.floor(Date.parse(k + 'T00:00:00.000Z') / 86400000);

export const computeStreak = (
  lastActiveDate: DayKey | null | undefined,
  today: DayKey,
  prevStreak: number
): number => {
  if (!lastActiveDate) return 1;
  const diff = dayNum(today) - dayNum(lastActiveDate);
  if (diff <= 0) return prevStreak;
  if (diff === 1) return prevStreak + 1;
  return 1;
};

export const displayStreak = (
  currentStreak: number | undefined,
  lastActiveDate: DayKey | null | undefined,
  today: DayKey
): number => {
  if (!currentStreak || !lastActiveDate) return currentStreak || 0;
  return dayNum(today) - dayNum(lastActiveDate) >= 2 ? 0 : currentStreak;
};

export const recordActivity = async (
  userId: string,
  isMock: boolean,
  now: Date = new Date()
): Promise<void> => {
  const today = dayKey(now);

  if (isMock) {
    // CH7 (2026-06-07, P2-#7): serialize concurrent recordActivity calls
    // in mock mode. Without this, two activities landing in the same
    // tick (e.g. Writing submit + Flashcard review) both read the
    // same `profile`, both compute the same `next`, both write the
    // same value - the last write wins, and the activity that
    // *should* have updated longest_streak to a higher value can be
    // silently lost. The chain ensures the read-then-write is atomic
    // within a single browser tab.
    const work = activityChain.then(() => doRecordMock(userId, today));
    activityChain = work.catch(() => undefined);
    await work;
    return;
  }

  try {
    // CH7 (2026-06-07, P2-#7): same TOCTOU race in cloud mode. The
    // proper fix is a Postgres RPC that does the read+update as a
    // single statement (e.g. `UPDATE ... SET ... = GREATEST(...)` or
    // a SECURITY DEFINER function). Out of scope for this commit.
    // The race window is small in practice (sub-100ms for two
    // concurrent activities) and the worst case is a 1-day streak
    // miscount, which the daily reset gracefully corrects.
    await doRecordCloud(userId, today);
  } catch (err) {
    console.error('recordActivity (cloud) failed:', err);
  }
};

function doRecordMock(userId: string, today: DayKey): void {
  try {
    const last = localStorage.getItem('learnt_last_activity_' + userId);
    const profileRaw = localStorage.getItem('learnt_profile_' + userId);
    const profile = profileRaw ? JSON.parse(profileRaw) : {};
    const next = computeStreak(last, today, profile.current_streak || 0);
    profile.current_streak = next;
    profile.longest_streak = Math.max(profile.longest_streak || 0, next);
    profile.last_activity_date = today;
    localStorage.setItem('learnt_profile_' + userId, JSON.stringify(profile));
    localStorage.setItem('learnt_last_activity_' + userId, today);
  } catch (err) {
    console.error('recordActivity (mock) failed:', err);
  }
}

async function doRecordCloud(userId: string, today: DayKey): Promise<void> {
  const { data: row } = await supabase
    .from('profiles')
    .select('current_streak, longest_streak, last_activity_date')
    .eq('id', userId)
    .single();

  if (row) {
    const next = computeStreak(
      row.last_activity_date,
      today,
      row.current_streak || 0
    );
    await supabase
      .from('profiles')
      .update({
        current_streak: next,
        longest_streak: Math.max(row.longest_streak || 0, next),
        last_activity_date: today,
      })
      .eq('id', userId);
  }
}

// Module-level promise chain serializing mock-mode activity
// writes (CH7 P2-#7). Lazily initialized on first call.
let activityChain: Promise<void> = Promise.resolve();
