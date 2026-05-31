import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyzeGrammarMock,
  submitWritingContent,
  type WritingFeedback,
} from '../writingService';

// CHARACTERIZATION (protected baseline) - writingService.
// Pins the pure mock grammar analyzer shape AND the writing fallback-to-mock
// path (no provider/edge -> safe mock, never crash). Anchors CH4: today the
// happy path renders a valid WritingFeedback and the fallback degrades safely.
// Re-run: npx vitest run src/lib/__tests__/writingService.test.ts

const userId = 'learner-writing';

beforeEach(() => {
  localStorage.clear();
});

describe('analyzeGrammarMock (pure fn) [TC-GRAM]', () => {
  it('TC-GRAM-01 returns a structurally complete WritingFeedback', () => {
    const fb: WritingFeedback = analyzeGrammarMock('I think technology is beneficial for modern education systems.');
    expect(typeof fb.overall_score).toBe('number');
    expect(Array.isArray(fb.strengths)).toBe(true);
    expect(Array.isArray(fb.errors)).toBe(true);
    expect(Array.isArray(fb.suggestions)).toBe(true);
    expect(typeof fb.revised_text).toBe('string');
  });

  it('TC-GRAM-02 clamps the score into the 45..98 band', () => {
    const fb = analyzeGrammarMock('a');
    expect(fb.overall_score).toBeGreaterThanOrEqual(45);
    expect(fb.overall_score).toBeLessThanOrEqual(98);
  });

  it('TC-GRAM-03 capitalizes a standalone lowercase "i" in revised_text', () => {
    const fb = analyzeGrammarMock('i went to the shop and i bought milk');
    expect(fb.revised_text).toContain('I went');
    expect(fb.revised_text).not.toMatch(/\bi\b/);
  });

  it('TC-GRAM-04 never returns empty strengths/suggestions arrays (defaults applied)', () => {
    const fb = analyzeGrammarMock('Good clear short text.');
    expect(fb.strengths.length).toBeGreaterThan(0);
    expect(fb.suggestions.length).toBeGreaterThan(0);
  });
});

describe('submitWritingContent mock fallback [TC-WRITE]', () => {
  it('TC-WRITE-01 falls back to the safe mock feedback and persists the submission', async () => {
    const today = new Date().toISOString().split('T')[0];
    const sub = await submitWritingContent(
      userId,
      'Technology in Education',
      'I believe smartphones can help students learn faster when used responsibly.',
      true,
    );

    expect(sub.id).toBeTruthy();
    expect(sub.word_count).toBeGreaterThan(0);
    // fallback feedback is a valid WritingFeedback shape
    expect(typeof sub.ai_feedback.overall_score).toBe('number');
    expect(Array.isArray(sub.ai_feedback.errors)).toBe(true);

    const stored = JSON.parse(localStorage.getItem(`learnt_writing_submissions_${userId}`) || '[]');
    expect(stored.length).toBe(1);
    const progress = JSON.parse(localStorage.getItem(`learnt_progress_${userId}_${today}`) || '{}');
    expect(progress.writing_count).toBe(1);
  });

  it('TC-WRITE-02 newest submission is unshifted to the front of the history', async () => {
    await submitWritingContent(userId, 'P1', 'First essay content here.', true);
    await submitWritingContent(userId, 'P2', 'Second essay content here.', true);
    const stored = JSON.parse(localStorage.getItem(`learnt_writing_submissions_${userId}`) || '[]');
    expect(stored[0].prompt).toBe('P2');
    expect(stored.length).toBe(2);
  });
});
