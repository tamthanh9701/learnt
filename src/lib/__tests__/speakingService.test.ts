import { describe, it, expect, beforeEach } from 'vitest';
import {
  scorePronunciationSimilarity,
  fetchAIConversationResponse,
} from '../speakingService';

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
