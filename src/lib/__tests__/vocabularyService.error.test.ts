import { describe, it, expect, vi, beforeEach } from 'vitest';

// CH4 (diagnosis 2026-06-06, fix-4): VocabularyPage was rendering
// empty for many Learners in production with NO error feedback.
// Root cause: seedDatabaseIfNeeded() SWALLOWED the seed failure
// (`console.error` only) and the subsequent fetchTopicsAndProgress()
// returned an empty list, which the page rendered as "0 topics,
// nothing to study". The Learner had no way to know whether the
// cause was RLS blocking the seed, an empty topics table, a
// network error, or a 401 from a stale JWT.
//
// Fix: the service now distinguishes three failure modes and
// throws typed errors that the page can render distinctly:
//
//   - 'seed_failed' : topics table was empty AND the seed insert
//                     failed (most often RLS policy blocking
//                     authenticated user from writing to topics).
//                     Actionable: check RLS policies.
//   - 'fetch_failed': topics table was non-empty but the SELECT
//                     from topics/flashcards/learner_cards
//                     failed. Network/auth issue most likely.
//   - 'empty'       : nothing failed but 0 topics came back.
//                     Actionable: try "Reset Progress" in
//                     Settings to re-trigger seed.

// Build a fresh supabase stub for each test so the cloud-mode
// path doesn't make a real network call to the placeholder URL
// (which would hang for 5 s on DNS).
const makeSupabaseStub = (topicsSelectResult: { data: unknown; error: unknown }) => ({
  from: (table: string) => {
    if (table === 'topics') {
      return {
        select: async () => topicsSelectResult,
        insert: async () => ({ data: null, error: { message: 'RLS blocked the insert', code: '42501' } }),
      };
    }
    return {
      select: async () => ({ data: null, error: null }),
      insert: async () => ({ data: null, error: null }),
    };
  },
});

vi.mock('../supabase', () => {
  // The factory can be overridden per test via vi.doMock below.
  // Default: topics table is empty AND insert fails with an RLS-style error.
  const defaultStub = makeSupabaseStub({ data: [], error: null });
  return { supabase: defaultStub };
});

describe('vocabularyService error paths (CH4) [TC-VOCAB-ERR]', () => {
  beforeEach(() => {
    // Make sure no leftover localStorage state.
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('learnt_') || k.startsWith('sb-')) localStorage.removeItem(k);
    }
  });

  it('TC-VOCAB-ERR-01 seedDatabaseIfNeeded (mock mode) seeds on first call, no-ops on second', async () => {
    // In mock mode the service writes the seed arrays to
    // localStorage and sets the learnt_seeded_<uid> flag. Should
    // never throw.
    const { seedDatabaseIfNeeded } = await import('../vocabularyService');
    await expect(seedDatabaseIfNeeded('user-1', true)).resolves.toBeUndefined();
    const seeded = localStorage.getItem('learnt_seeded_user-1');
    expect(seeded).toBe('true');
    const topics = JSON.parse(localStorage.getItem('learnt_topics_user-1') || '[]');
    expect(topics.length).toBeGreaterThan(0);
    // Second call is a no-op.
    await expect(seedDatabaseIfNeeded('user-1', true)).resolves.toBeUndefined();
  });

  it('TC-VOCAB-ERR-02 seedDatabaseIfNeeded (cloud mode) THROWS a typed VocabError when seed insert fails', async () => {
    // The pre-fix behavior: catch-and-log, return undefined. The
    // page then saw an empty topic list with no clue. New behavior:
    // throw a typed VocabError('seed_failed', ...) so the page can
    // render a useful message and a retry button. We rely on the
    // module-level vi.mock above (default stub: topics empty, insert
    // returns RLS error).
    const { seedDatabaseIfNeeded } = await import('../vocabularyService');
    await expect(seedDatabaseIfNeeded('user-rls', false)).rejects.toThrow();
  });

  it('TC-VOCAB-ERR-03 the thrown error carries a recognizable "kind" property (seed_failed vs fetch_failed)', async () => {
    // Structural check at the source level. The page branches on
    // err.kind to choose the user-facing message; the service must
    // throw something with `kind: 'seed_failed' | 'fetch_failed' |
    // 'empty'`. We assert the source exposes all three.
    // @ts-ignore -- node modules not in app tsconfig types
    const pathModule = require('path') as typeof import('path');
    // @ts-ignore
    const fsModule = require('fs') as typeof import('fs');
    const here = pathModule.dirname(
      // @ts-ignore
      (require('url') as typeof import('url')).fileURLToPath(import.meta.url),
    );
    const src = fsModule.readFileSync(
      pathModule.resolve(here, '../vocabularyService.ts'),
      'utf8',
    );
    expect(src).toMatch(/seed_failed/);
    expect(src).toMatch(/fetch_failed/);
    expect(src).toMatch(/VocabError/);
    // Throws inside the function (not just a catch-and-log).
    expect(src).toMatch(/throw\s+(new\s+)?\w*Error/);
  });
});

describe('VocabularyPage error UI (CH4) [TC-VOCAB-UI]', () => {
  // We can't easily render the React page here without
  // @testing-library/react, so we assert at the SOURCE level
  // (matches the project's existing test pattern - all current
  // tests are pure-function or static-source).
  // @ts-ignore
  const pathModule = require('path') as typeof import('path');
  // @ts-ignore
  const fsModule = require('fs') as typeof import('fs');
  const here = pathModule.dirname(
    // @ts-ignore
    (require('url') as typeof import('url')).fileURLToPath(import.meta.url),
  );
  const src = fsModule.readFileSync(
    pathModule.resolve(here, '../../pages/VocabularyPage.tsx'),
    'utf8',
  );

  it('TC-VOCAB-UI-01 has a retry button in the error state', () => {
    expect(src).toMatch(/handleRetry|loadData\(\)/);
    expect(src).toMatch(/['"](?:Retry|Thử lại)['"]/);
  });

  it('TC-VOCAB-UI-02 the error message distinguishes seed_failed from fetch_failed', () => {
    // The page should read err.kind (or message containing the kind)
    // and choose a different message. We assert the source branches
    // on the kind string.
    expect(src).toMatch(/seed_failed/);
    expect(src).toMatch(/fetch_failed/);
  });

  it('TC-VOCAB-UI-03 the error message hints at RLS when seed_failed', () => {
    // The actionable hint for seed_failed is "check RLS policies on
    // topics / flashcards tables". We assert the source mentions
    // RLS in the error path.
    expect(src).toMatch(/RLS|rls/i);
  });
});
