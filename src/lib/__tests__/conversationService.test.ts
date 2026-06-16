import { describe, it, expect, beforeEach } from 'vitest';
import { sendConversationTurn } from '../conversationService';

// CHARACTERIZATION (protected baseline) - conversationService.
// Pins CURRENT behavior of the AI Conversation reply use-case in mock mode:
// generates a reply, persists the session, and bumps speaking_minutes.
// Re-run: npx vitest run src/lib/__tests__/conversationService.test.ts
//
// Migrated from the old speakingService.test.ts during the Speaking module
// split. The TC-PRON suite for `scorePronunciationSimilarity` was DROPPED
// (Decision A): the function was already dead code in production
// (PronunciationPage uses phonemeScorer.buildAttempt / scorePhonemeWords),
// and phoneme-level scoring is covered by phonemeAlign.test.ts /
// phonemeScorer.api.test.ts.

describe('sendConversationTurn mock fallback [TC-AICONV]', () => {
  const userId = 'user-pron';

  beforeEach(() => {
    localStorage.clear();
  });

  it('TC-AICONV-01 falls back to a non-empty local mock response when no provider/edge is available', async () => {
    const reply = await sendConversationTurn({
      userId,
      topic: 'Technology',
      history: [{ role: 'user', content: 'Hello there', timestamp: new Date().toISOString() }],
      isMock: true,
    });
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });

  it('TC-AICONV-02 persists the conversation and bumps speaking_minutes in localStorage', async () => {
    const today = new Date().toISOString().split('T')[0];
    await sendConversationTurn({
      userId,
      topic: 'Education',
      history: [{ role: 'user', content: 'Tell me about teachers', timestamp: new Date().toISOString() }],
      isMock: true,
    });

    const sessions = JSON.parse(localStorage.getItem(`learnt_conversations_${userId}`) || '[]');
    expect(sessions.length).toBe(1);
    expect(sessions[0].topic).toBe('Education');
    // user message + assistant reply
    expect(sessions[0].messages.length).toBe(2);

    const progress = JSON.parse(localStorage.getItem(`learnt_progress_${userId}_${today}`) || '{}');
    expect(progress.speaking_minutes).toBe(1);
  });
});
