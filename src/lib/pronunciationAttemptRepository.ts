/**
 * pronunciationAttemptRepository.ts — Pronunciation Drill attempt store.
 *
 * Owns persistence + read-back of Pronunciation Drill attempts and the derived
 * per-card practice stats. The `PRONUNCIATION_TOPIC` sentinel — the trick that
 * lets attempts ride the shared `speaking_sessions` store without colliding with
 * AI Conversation rows — is an IMPLEMENTATION DETAIL of this module. No caller
 * (page or service) sees the sentinel; they see attempts + stats only.
 *
 * Two adapters sit behind one interface: an in-memory (localStorage) adapter for
 * the mock Learner and a Supabase adapter for the cloud Learner. Domain/UI code
 * picks the adapter via `isMock` and never branches on storage itself.
 *
 * Privacy (NFR-27): only derived phoneme scores persist — never raw audio.
 */

import { supabase } from './supabase';
import { withTimeout } from './timeout';
import {
  serializePronunciationAttempt,
  deserializePronunciationHistory,
  PRONUNCIATION_TOPIC,
} from './pronunciationHistory';
import type { PronunciationAttempt, PronunciationSessionEntry } from './pronunciationHistory';
import type { CardHistoryStat } from './sentenceSelector';

/** localStorage key for the mock Learner's attempt rows. */
const mockKey = (userId: string) => `learnt_pron_${userId}`;

/**
 * Persist a single Pronunciation Drill attempt, newest-first.
 *
 * Mock and cloud round-trip through the SAME serializer so the two adapters are
 * byte-equivalent. Cloud writes are bounded by `withTimeout`; a cloud failure is
 * swallowed (logged) so a save never hangs or crashes the drill.
 */
export const savePronunciationAttempt = async (
  userId: string,
  attempt: PronunciationAttempt,
  isMock: boolean,
): Promise<void> => {
  const now = new Date().toISOString();
  const entry: PronunciationSessionEntry = {
    id: `pron-${Date.now()}`,
    topic: PRONUNCIATION_TOPIC,
    created_at: now,
    attempt,
  };
  const serialized = serializePronunciationAttempt(entry);

  if (isMock) {
    const rows: unknown[] = JSON.parse(localStorage.getItem(mockKey(userId)) || '[]');
    rows.unshift(serialized);
    localStorage.setItem(mockKey(userId), JSON.stringify(rows));
    return;
  }

  try {
    await withTimeout(
      async () => {
        const { error: dbError } = await supabase
          .from('speaking_sessions')
          .insert({
            learner_id: userId,
            topic: PRONUNCIATION_TOPIC,
            dialogue_history: [serialized],
          });
        if (dbError) throw dbError;
      },
      8000,
      'pron-history',
    );
  } catch (dbErr) {
    console.error('Error saving pronunciation attempt to Supabase:', dbErr);
  }
};

/**
 * Read Pronunciation Drill attempts, newest first. Reads ONLY sentinel rows;
 * conversation rows are ignored. Mock and cloud parity. Defensive: on cloud
 * failure / timeout, degrades to [] rather than hang.
 */
export const fetchPronunciationHistory = async (
  userId: string,
  isMock: boolean,
): Promise<PronunciationSessionEntry[]> => {
  if (isMock) {
    const rows: unknown[] = JSON.parse(localStorage.getItem(mockKey(userId)) || '[]');
    return deserializePronunciationHistory(rows);
  }

  try {
    const rows = await withTimeout(
      async () => {
        const { data, error } = await supabase
          .from('speaking_sessions')
          .select('*')
          .eq('learner_id', userId)
          .eq('topic', PRONUNCIATION_TOPIC)
          .order('created_at', { ascending: false });
        if (error) throw error;
        // Each attempt row stores its serialized entry as dialogue_history[0].
        return (data || []).map((row) => {
          const dh = row.dialogue_history;
          return Array.isArray(dh) ? dh[0] : dh;
        });
      },
      8000,
      'pron-history',
    );
    return deserializePronunciationHistory(rows);
  } catch (dbErr) {
    console.error('Error loading pronunciation history from Supabase:', dbErr);
    return [];
  }
};

/**
 * Build a per-card practice-stats map (sourceCardId -> { attempts, meanScore })
 * from a list of attempts. Drives sentence selection (coverage + mastery) and
 * the "X attempts · Y sentences" counters. Pure transform — no I/O.
 *
 * meanScore is the average of each attempt's overall phoneme score in [0,1], or
 * null for a card with no scored attempts.
 */
export const buildCardHistoryStats = (
  entries: PronunciationSessionEntry[],
): Record<string, CardHistoryStat> => {
  const acc: Record<string, { attempts: number; scoreSum: number; scoreCount: number }> = {};
  for (const entry of entries) {
    const cardId = entry.attempt.source_card_id;
    if (!cardId) continue;
    if (!acc[cardId]) acc[cardId] = { attempts: 0, scoreSum: 0, scoreCount: 0 };
    acc[cardId].attempts += 1;
    const phonemes = entry.attempt.phonemes;
    if (phonemes.length > 0) {
      const overall = phonemes.reduce((s, p) => s + p.score, 0) / phonemes.length;
      acc[cardId].scoreSum += overall;
      acc[cardId].scoreCount += 1;
    }
  }
  const result: Record<string, CardHistoryStat> = {};
  for (const cardId of Object.keys(acc)) {
    const { attempts, scoreSum, scoreCount } = acc[cardId];
    result[cardId] = {
      attempts,
      meanScore: scoreCount > 0 ? scoreSum / scoreCount : null,
    };
  }
  return result;
};
