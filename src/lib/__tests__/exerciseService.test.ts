import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchExercisesForTopic,
  recordExerciseCompletion,
  seedExercises,
} from '../exerciseService';
import { QuotaExhaustedError } from '../aiClient';
import type { AIConfig, AIDiagnostic } from '../aiClient';

// CHARACTERIZATION (protected baseline) - exerciseService.
// Pins the CURRENT exercise-generation fallback (no provider -> seed/mock) and
// the daily-progress counter. Also pins that the seed set currently uses 'mcq'
// (AC-4.7: mcq accepted as-is, scope deferred). Must degrade to safe mock after
// CH4 validation lands. Re-run: npx vitest run src/lib/__tests__/exerciseService.test.ts

// G3 (diagnosis 2026-06-05): partial-mock aiClient so callAIProvider can be
// forced to throw while keeping the real error classes + classifyAIError.
const { mockCallAIProvider } = vi.hoisted(() => ({ mockCallAIProvider: vi.fn() }));
vi.mock('../aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../aiClient')>();
  return { ...actual, callAIProvider: mockCallAIProvider };
});

const userId = 'learner-exercise';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('fetchExercisesForTopic mock/seed fallback [TC-EX]', () => {
  it('TC-EX-01 returns the seeded exercise set for a known topic', async () => {
    const qs = await fetchExercisesForTopic('topic-technology', true);
    expect(qs).toEqual(seedExercises['topic-technology']);
    expect(qs.length).toBe(3);
  });

  it('TC-EX-02 generates a non-empty fallback set for an unknown topic', async () => {
    const qs = await fetchExercisesForTopic('topic-unknown-xyz', true);
    expect(qs.length).toBe(3);
    expect(qs.every(q => q.prompt_en.length > 0)).toBe(true);
  });

  it('TC-EX-03 seed set currently includes an mcq type (AC-4.7 accept-as-is)', async () => {
    const qs = await fetchExercisesForTopic('topic-technology', true);
    const types = qs.map(q => q.type);
    expect(types).toContain('mcq');
    // also pins the current cloze/reorder companions
    expect(types).toContain('cloze');
    expect(types).toContain('reorder');
  });

  it('TC-EX-04 every fallback question carries both EN and VI prompts and an explanation', async () => {
    const qs = await fetchExercisesForTopic('topic-business', true);
    for (const q of qs) {
      expect(q.prompt_en.length).toBeGreaterThan(0);
      expect(q.prompt_vi.length).toBeGreaterThan(0);
      expect(q.explanation_en.length).toBeGreaterThan(0);
    }
  });
});

describe('recordExerciseCompletion counter (mock) [TC-EXPROG]', () => {
  it('TC-EXPROG-01 first completion of the day creates record at exercises_completed=1', async () => {
    const today = new Date().toISOString().split('T')[0];
    await recordExerciseCompletion(userId, true);
    const progress = JSON.parse(localStorage.getItem(`learnt_progress_${userId}_${today}`) || '{}');
    expect(progress.exercises_completed).toBe(1);
  });

  it('TC-EXPROG-02 a second completion same day increments to 2', async () => {
    const today = new Date().toISOString().split('T')[0];
    await recordExerciseCompletion(userId, true);
    await recordExerciseCompletion(userId, true);
    const progress = JSON.parse(localStorage.getItem(`learnt_progress_${userId}_${today}`) || '{}');
    expect(progress.exercises_completed).toBe(2);
  });
});

// =============================================================================
// G3 (diagnosis 2026-06-05): Structured Exercise generation must surface AI
// errors instead of silently returning seed/mock exercises. A quota-exhausted
// model previously produced generic seed exercises with no explanation.
// =============================================================================
describe('fetchExercisesForTopic surfaces AI errors (G3, diagnosis 2026-06-05) [TC-G3-EX]', () => {
  const cfg: AIConfig = { provider: 'gemini', apiKey: 'AQ.test', model: 'gemini-2.0-flash' };

  it('TC-G3-EX-01 calls onDiagnostic with reason:"quota" but still returns a non-empty exercise set', async () => {
    mockCallAIProvider.mockRejectedValueOnce(new QuotaExhaustedError('gemini-2.0-flash', 30));
    const diags: AIDiagnostic[] = [];

    const qs = await fetchExercisesForTopic('topic-technology', true, cfg, (d) => diags.push(d));

    // Graceful degradation: seed/mock exercises still returned.
    expect(qs.length).toBe(3);

    // G3: failure is no longer silent.
    expect(diags).toHaveLength(1);
    expect(diags[0].reason).toBe('quota');
    expect(diags[0].model).toBe('gemini-2.0-flash');
  });

  it('TC-G3-EX-02 calls onDiagnostic with reason:"invalid_shape" when the AI returns 200 with bad JSON', async () => {
    // Valid JSON, but NOT an ExerciseQuestion[] (parses fine, fails validation).
    mockCallAIProvider.mockResolvedValueOnce('{"not":"an array"}');
    const diags: AIDiagnostic[] = [];

    await fetchExercisesForTopic('topic-technology', true, cfg, (d) => diags.push(d));

    expect(diags).toHaveLength(1);
    expect(diags[0].reason).toBe('invalid_shape');
  });

  it('TC-G3-EX-03 backward-compatible: no onDiagnostic → no throw', async () => {
    mockCallAIProvider.mockRejectedValueOnce(new QuotaExhaustedError('gemini-2.0-flash', 30));
    const qs = await fetchExercisesForTopic('topic-technology', true, cfg);
    expect(qs.length).toBe(3);
  });
});
