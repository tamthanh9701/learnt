import { describe, it, expect, beforeEach, vi } from 'vitest';
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

// =============================================================================
// H2 (diagnosis 2026-06-05): streak must advance on Free Writing completion
// even when the cloud save fails. Previously `recordActivity` sat INSIDE the
// cloud-save try block; if supabase.from('writing_submissions').insert() threw
// (network / RLS / missing table), the catch short-circuited and the streak
// was silently lost. Same pattern in exerciseService and speakingService
// (fixed in the same diagnosis). The H2 mock is set up so the cloud writes
// always fail.
// =============================================================================
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
      functions: { invoke: vi.fn(async () => ({ data: null, error: { message: 'function not deployed' } })) },
    },
    setChainResult: setResult,
  };
});

vi.mock('../supabase', () => ({ supabase: mockSupabase }));

// G3 (diagnosis 2026-06-05): partial-mock aiClient so callAIProvider can be
// forced to throw typed errors while the REAL error classes + classifyAIError
// stay intact.
const { mockCallAIProvider } = vi.hoisted(() => ({ mockCallAIProvider: vi.fn() }));
vi.mock('../aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../aiClient')>();
  return { ...actual, callAIProvider: mockCallAIProvider };
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Default: every supabase call fails. Tests that need happy path override.
  setChainResult({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
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

// =============================================================================
// H2 cloud-failure regression — streak MUST still advance when save throws.
// =============================================================================
describe('submitWritingContent cloud failure (H2, diagnosis 2026-06-05) [TC-WRITE-CLOUD]', () => {
  it('TC-WRITE-CLOUD-01 streak is advanced even when every Supabase call returns an error (the H2 bug)', async () => {
    const today = new Date().toISOString().split('T')[0];

    // The mock is set to throw on every supabase call (see beforeEach above).
    const sub = await submitWritingContent(
      userId,
      'Streak under failure',
      'I am submitting a writing piece while the cloud is down.',
      false,
    );

    // The local write still happens so the user has feedback in hand.
    expect(sub.id).toBeTruthy();
    expect(sub.ai_feedback.overall_score).toBeGreaterThan(0);

    // CRITICAL: the streak must STILL advance. Pre-H2 fix this assertion
    // failed because recordActivity was inside the failing try block.
    const profile = JSON.parse(localStorage.getItem(`learnt_profile_${userId}`) || '{}');
    expect(profile.current_streak).toBe(1);
    expect(localStorage.getItem(`learnt_last_activity_${userId}`)).toBe(today);
  });
});

// =============================================================================
// G3 (diagnosis 2026-06-05): Free Writing must surface AI errors instead of
// silently falling back to analyzeGrammarMock. Same root cause as the
// conversation flow — a quota-exhausted model produced a generic mock score
// with no explanation, so the learner thought "AI doesn't work".
// =============================================================================
import { QuotaExhaustedError } from '../aiClient';
import type { AIConfig, AIDiagnostic } from '../aiClient';

describe('submitWritingContent surfaces AI errors (G3, diagnosis 2026-06-05) [TC-G3-WRITE]', () => {
  const cfg: AIConfig = { provider: 'gemini', apiKey: 'AQ.test', model: 'gemini-2.0-flash' };

  it('TC-G3-WRITE-01 calls onDiagnostic with reason:"quota" but still returns safe mock feedback', async () => {
    mockCallAIProvider.mockRejectedValueOnce(new QuotaExhaustedError('gemini-2.0-flash', 30));
    const diags: AIDiagnostic[] = [];

    const sub = await submitWritingContent(
      'learner-g3w-quota',
      'Tech',
      'I think technology helps students learn faster.',
      true,
      cfg,
      (d) => diags.push(d),
    );

    // Graceful degradation: a valid mock feedback is still produced.
    expect(sub.id).toBeTruthy();
    expect(typeof sub.ai_feedback.overall_score).toBe('number');

    // G3: failure is no longer silent.
    expect(diags).toHaveLength(1);
    expect(diags[0].reason).toBe('quota');
    expect(diags[0].model).toBe('gemini-2.0-flash');
  });

  it('TC-G3-WRITE-02 calls onDiagnostic with reason:"invalid_shape" when the AI returns 200 with bad JSON', async () => {
    // Valid JSON, but NOT a WritingFeedback (parses fine, fails validation).
    mockCallAIProvider.mockResolvedValueOnce('{"unexpected":"shape","foo":123}');
    const diags: AIDiagnostic[] = [];

    await submitWritingContent(
      'learner-g3w-shape',
      'Tech',
      'Some essay text here.',
      true,
      cfg,
      (d) => diags.push(d),
    );

    expect(diags).toHaveLength(1);
    expect(diags[0].reason).toBe('invalid_shape');
  });

  it('TC-G3-WRITE-03 backward-compatible: no onDiagnostic → no throw', async () => {
    mockCallAIProvider.mockRejectedValueOnce(new QuotaExhaustedError('gemini-2.0-flash', 30));
    const sub = await submitWritingContent('learner-g3w-compat', 'Tech', 'Essay.', true, cfg);
    expect(sub.id).toBeTruthy();
  });
});
