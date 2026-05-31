import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchExercisesForTopic,
  recordExerciseCompletion,
  seedExercises,
} from '../exerciseService';

// CHARACTERIZATION (protected baseline) - exerciseService.
// Pins the CURRENT exercise-generation fallback (no provider -> seed/mock) and
// the daily-progress counter. Also pins that the seed set currently uses 'mcq'
// (AC-4.7: mcq accepted as-is, scope deferred). Must degrade to safe mock after
// CH4 validation lands. Re-run: npx vitest run src/lib/__tests__/exerciseService.test.ts

const userId = 'learner-exercise';

beforeEach(() => {
  localStorage.clear();
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
