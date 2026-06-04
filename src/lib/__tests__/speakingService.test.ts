import { describe, it, expect, beforeEach } from 'vitest';
import {
  scorePronunciationSimilarity,
  fetchAIConversationResponse,
  savePronunciationAttempt,
} from '../speakingService';
import type { PronunciationAttempt } from '../pronunciationHistory';

// CHARACTERIZATION (protected baseline) - speakingService.
// Pins CURRENT behavior of the pure pronunciation scorer and the
// AI-conversation fallback-to-mock path. Must stay GREEN through CH1/2/3/6.
// Re-run: npx vitest run src/lib/__tests__/speakingService.test.ts

describe('scorePronunciationSimilarity (pure fn) [TC-PRON]', () => {
  it('TC-PRON-01 scores a perfect match as 100 and marks every word correct', () => {
    const r = scorePronunciationSimilarity('Hello world', 'hello world');
    expect(r.score).toBe(100);
    expect(r.words).toHaveLength(2);
    expect(r.words.every(w => w.isCorrect)).toBe(true);
  });

  it('TC-PRON-02 is case- and punctuation-insensitive', () => {
    const r = scorePronunciationSimilarity('Hello, world!', 'HELLO world');
    expect(r.score).toBe(100);
  });

  it('TC-PRON-03 returns the cleaned lowercase reference words', () => {
    const r = scorePronunciationSimilarity('Hello World', 'hello world');
    expect(r.words.map(w => w.word)).toEqual(['hello', 'world']);
  });

  it('TC-PRON-04 scores a partial match by word presence ratio', () => {
    const r = scorePronunciationSimilarity('Hello world', 'hello');
    expect(r.score).toBe(50);
    expect(r.words[0].isCorrect).toBe(true);
    expect(r.words[1].isCorrect).toBe(false);
  });

  it('TC-PRON-05 scores an empty transcript as 0', () => {
    const r = scorePronunciationSimilarity('Hello world', '');
    expect(r.score).toBe(0);
    expect(r.words.every(w => !w.isCorrect)).toBe(true);
  });

  it('TC-PRON-06 scores an empty reference as 0 (no division by zero)', () => {
    const r = scorePronunciationSimilarity('', 'anything');
    expect(r.score).toBe(0);
    expect(r.words).toEqual([]);
  });
});

describe('fetchAIConversationResponse mock fallback [TC-AICONV]', () => {
  const userId = 'user-pron';

  beforeEach(() => {
    localStorage.clear();
  });

  it('TC-AICONV-01 falls back to a non-empty local mock response when no provider/edge is available', async () => {
    const reply = await fetchAIConversationResponse(
      userId,
      'Technology',
      [{ role: 'user', content: 'Hello there', timestamp: new Date().toISOString() }],
      true,
    );
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });

  it('TC-AICONV-02 persists the conversation and bumps speaking_minutes in localStorage', async () => {
    const today = new Date().toISOString().split('T')[0];
    await fetchAIConversationResponse(
      userId,
      'Education',
      [{ role: 'user', content: 'Tell me about teachers', timestamp: new Date().toISOString() }],
      true,
    );

    const sessions = JSON.parse(localStorage.getItem(`learnt_conversations_${userId}`) || '[]');
    expect(sessions.length).toBe(1);
    expect(sessions[0].topic).toBe('Education');
    // user message + assistant reply
    expect(sessions[0].messages.length).toBe(2);

    const progress = JSON.parse(localStorage.getItem(`learnt_progress_${userId}_${today}`) || '{}');
    expect(progress.speaking_minutes).toBe(1);
  });
});

// =============================================================================
// H1 (diagnosis 2026-06-05): Pronunciation Drill is a learning activity and
// MUST update the streak. savePronunciationAttempt was not wired to
// recordActivity, so a learner whose only daily activity is pronunciation
// would see streak=0 in spite of having practiced. This is the same class of
// bug that CH2 fixed for AI Conversation / Free Writing / Structured Exercise,
// but Pronunciation Drill was missed (it lives in speakingService alongside
// AI Conversation but its own persistence helper was not touched). TC-PRON-04.
// =============================================================================
describe('savePronunciationAttempt updates streak (H1, diagnosis 2026-06-05) [TC-PRON-STREAK]', () => {
  const userId = 'learner-pron-streak';

  const sampleAttempt: PronunciationAttempt = {
    sentence: 'Hello world',
    source_card_id: 'card-test-1',
    overall_band: 'good',
    phonemes: [
      { phoneme: 'h', score: 95, band: 'good' },
      { phoneme: 'ɛ', score: 88, band: 'good' },
      { phoneme: 'l', score: 92, band: 'good' },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('TC-PRON-STREAK-01 (mock) a pronunciation attempt records activity + sets streak=1 (BR-STREAK parity with the other 3 activities)', async () => {
    const today = new Date().toISOString().split('T')[0];
    await savePronunciationAttempt(userId, sampleAttempt, true);

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(1);
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });

  it('TC-PRON-STREAK-02 (mock) first attempt of the day with streak=prev pushes prev+1 (active yesterday path)', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(`learnt_last_activity_${userId}`, yesterday);
    localStorage.setItem(
      `learnt_profile_${userId}`,
      JSON.stringify({ current_streak: 4, longest_streak: 7 }),
    );

    await savePronunciationAttempt(userId, sampleAttempt, true);

    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(5); // 4 (yesterday) + 1 (today)
    expect(profile.longest_streak).toBe(7);
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });
});

// =============================================================================
// H2 (diagnosis 2026-06-05): AI Conversation must update streak even when
// cloud persistence fails. recordActivity used to sit inside the failing
// try block. Mocked here so the cloud writes throw — we still want the
// streak to advance via the localStorage fallback in recordActivity.
// =============================================================================
import { vi } from 'vitest';

const { mockSupabase, setChainResult } = vi.hoisted(() => {
  let result: { data: any; error: any } = { data: null, error: null };
  const setResult = (r: { data: any; error: any }) => { result = r; };
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
      }
      return () => new Proxy({}, handler);
    },
  };
  const chain = new Proxy({}, handler);
  return {
    mockSupabase: {
      from: vi.fn(() => chain),
      functions: { invoke: vi.fn(async () => ({ data: null, error: { message: 'not deployed' } })) },
    },
    setChainResult: setResult,
  };
});

vi.mock('../supabase', () => ({ supabase: mockSupabase }));

describe('fetchAIConversationResponse cloud failure (H2, diagnosis 2026-06-05) [TC-AICONV-CLOUD]', () => {
  const userId = 'learner-conv-cloud';

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setChainResult({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
  });

  it('TC-AICONV-CLOUD-01 streak is advanced even when every Supabase call returns an error (the H2 bug, AI Conversation path)', async () => {
    const today = new Date().toISOString().split('T')[0];
    const reply = await fetchAIConversationResponse(
      userId,
      'Education',
      [{ role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
      false, // isMock = false → cloud path runs → cloud throws
    );
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);

    // CRITICAL: streak must still advance via the recordActivity local-fallback.
    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(1);
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });
});
