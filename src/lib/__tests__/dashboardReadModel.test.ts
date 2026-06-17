import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeoutError } from '../timeout';
import { learnerCardsKey, progressKey } from '../vocabulary/storageKeys';
import { dayKey } from '../streak';

// [NEW-U] Unit suite for the Dashboard read-model seam
// (src/lib/vocabulary/dashboardReadModel.ts), task
// 20260616-1815-dashboard-read-model (M2 Brownfield).
//
// Canonical TC IDs are taken from acceptance-criteria.md (QA section),
// NOT be-design's renumbering. This file LOCKS the 5 hard BA-veto
// invariants (TC-06, TC-10, TC-11, TC-13, TC-14) plus the mock/cloud
// read contracts (TC-01/02, TC-07/08, TC-09, TC-12).
//
// Mock mode: happy-dom localStorage is the store (same convention as
// vocabularyReview.test.ts). Cloud mode: supabase client mocked at the
// module boundary (same convention as vocabularyService.error.test.ts),
// here made configurable per-test via a vi.hoisted state object so each
// branch (count-null / timeout / PGRST116 / error) can be driven.
//
// Re-run: npx vitest run src/lib/__tests__/dashboardReadModel.test.ts

// ---- configurable supabase mock (hoisted so vi.mock factory can use it) ----
const h = vi.hoisted(() => {
  type DueCfg = { count: number | null; error: unknown; throwVal: unknown; hang: boolean };
  type ProgCfg = { data: unknown; error: unknown; throwVal: unknown; hang: boolean };
  const state: {
    fromCalls: string[];
    due: DueCfg;
    prog: ProgCfg;
  } = {
    fromCalls: [],
    due: { count: 0, error: null, throwVal: null, hang: false },
    prog: { data: null, error: null, throwVal: null, hang: false },
  };

  const makeAbort = () => new DOMException('Aborted', 'AbortError');
  const hangUntilAbort = (signal: AbortSignal) =>
    new Promise((_resolve, reject) => {
      if (signal.aborted) return reject(makeAbort());
      signal.addEventListener('abort', () => reject(makeAbort()));
    });

  const terminalDue = (signal: AbortSignal) => {
    const c = state.due;
    if (c.throwVal) return Promise.reject(c.throwVal);
    if (c.hang) return hangUntilAbort(signal);
    return Promise.resolve({ count: c.count, error: c.error });
  };
  const terminalProg = (signal: AbortSignal) => {
    const c = state.prog;
    if (c.throwVal) return Promise.reject(c.throwVal);
    if (c.hang) return hangUntilAbort(signal);
    return Promise.resolve({ data: c.data, error: c.error });
  };

  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    let sig: AbortSignal;
    b.select = () => b;
    b.eq = () => b;
    b.lte = () => b;
    b.abortSignal = (signal: AbortSignal) => {
      sig = signal;
      // learner_cards (due count) terminates on abortSignal().
      // daily_progress chains .maybeSingle() after abortSignal().
      if (table === 'daily_progress') return b;
      return terminalDue(signal);
    };
    b.maybeSingle = () => terminalProg(sig);
    return b;
  };

  const supabase = {
    from: (table: string) => {
      state.fromCalls.push(table);
      return makeBuilder(table);
    },
  };
  return { state, supabase };
});

vi.mock('../supabase', () => ({ supabase: h.supabase }));

import { fetchDashboardStats } from '../vocabulary/dashboardReadModel';

const uid = 'test-user-1';

const resetCloud = () => {
  h.state.fromCalls = [];
  h.state.due = { count: 0, error: null, throwVal: null, hang: false };
  h.state.prog = { data: null, error: null, throwVal: null, hang: false };
};

beforeEach(() => {
  for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
  resetCloud();
});

// =====================================================================
// SEAM existence + re-callable (BA-AC-01 / BA-AC-02)
// =====================================================================
describe('fetchDashboardStats seam [TC-01/02]', () => {
  it('TC-01 exports a callable seam that resolves {dueCount, reviewedToday}', async () => {
    expect(typeof fetchDashboardStats).toBe('function');
    const stats = await fetchDashboardStats(uid, true);
    expect(stats).toEqual(
      expect.objectContaining({
        dueCount: expect.any(Number),
        reviewedToday: expect.any(Number),
      }),
    );
    expect(Object.keys(stats).sort()).toEqual(['dueCount', 'reviewedToday']);
  });

  it('TC-02 is re-callable (Retry path) — re-reads the store, no memoized state', async () => {
    // First call: no store -> 5-default.
    const first = await fetchDashboardStats(uid, true);
    expect(first.dueCount).toBe(5);

    // Mutate the store, then call again: must reflect CURRENT store.
    localStorage.setItem(learnerCardsKey(uid), JSON.stringify([]));
    const second = await fetchDashboardStats(uid, true);
    expect(second.dueCount).toBe(0);

    // And once more with due cards present.
    const now = Date.now();
    localStorage.setItem(
      learnerCardsKey(uid),
      JSON.stringify([{ due: new Date(now - 1000).toISOString() }]),
    );
    const third = await fetchDashboardStats(uid, true);
    expect(third.dueCount).toBe(1);
  });
});

// =====================================================================
// MOCK MODE contracts (BA-AC-06 / BA-AC-07 / BA-AC-08)
// =====================================================================
describe('mock mode dueCount [TC-06/07]', () => {
  it('TC-06 NO learner_cards store -> dueCount === 5 (5-default, NOT 0) ⚠invariant', async () => {
    const { dueCount } = await fetchDashboardStats(uid, true);
    expect(dueCount).toBe(5);
  });

  it('TC-06 empty-array store -> dueCount === 0 (distinct from the 5-default) ⚠invariant', async () => {
    localStorage.setItem(learnerCardsKey(uid), JSON.stringify([]));
    const { dueCount } = await fetchDashboardStats(uid, true);
    // The 5-default is ONLY for a missing store. A present-but-empty
    // store means zero due cards, not first-time-use.
    expect(dueCount).toBe(0);
  });

  it('TC-07 store with mixed due dates -> counts only cards with new Date(due) <= now', async () => {
    const now = Date.now();
    const past = (ms: number) => new Date(now - ms).toISOString();
    const future = (ms: number) => new Date(now + ms).toISOString();
    const cards = [
      { due: past(86_400_000) }, // yesterday  -> due
      { due: past(1000) }, // 1s ago     -> due
      { due: past(60_000) }, // 1m ago     -> due
      { due: future(86_400_000) }, // tomorrow   -> not due
      { due: future(60_000) }, // 1m ahead   -> not due
    ];
    localStorage.setItem(learnerCardsKey(uid), JSON.stringify(cards));
    const { dueCount } = await fetchDashboardStats(uid, true);
    expect(dueCount).toBe(3);
  });
});

describe('mock mode reviewedToday [TC-08]', () => {
  const today = () => new Date().toISOString().split('T')[0];

  it('TC-08 progress store present -> reviewedToday = cards_reviewed', async () => {
    localStorage.setItem(progressKey(uid, today()), JSON.stringify({ cards_reviewed: 7 }));
    const { reviewedToday } = await fetchDashboardStats(uid, true);
    expect(reviewedToday).toBe(7);
  });

  it('TC-08 progress store absent -> reviewedToday = 0', async () => {
    const { reviewedToday } = await fetchDashboardStats(uid, true);
    expect(reviewedToday).toBe(0);
  });

  it('TC-08 progress present but cards_reviewed missing -> 0 (|| 0 fallback)', async () => {
    localStorage.setItem(progressKey(uid, today()), JSON.stringify({ something_else: 9 }));
    const { reviewedToday } = await fetchDashboardStats(uid, true);
    expect(reviewedToday).toBe(0);
  });
});

// =====================================================================
// CLOUD MODE contracts (BA-AC-09..14)
// =====================================================================
describe('cloud mode timeout wrapping [TC-09]', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-09 due-count query exceeding 8s is wrapped by withTimeout -> TimeoutError', async () => {
    vi.useFakeTimers();
    h.state.due.hang = true; // never resolves until AbortController fires
    const p = fetchDashboardStats(uid, false);
    // Attach rejection handler before advancing so no unhandled rejection.
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });
});

describe('cloud mode count-null invariant [TC-10]', () => {
  it('TC-10 count === null -> dueCount left UNCHANGED (NOT forced 0); progress still read ⚠invariant', async () => {
    h.state.due.count = null; // {count: null, error: null}
    h.state.prog.data = { cards_reviewed: 4 };
    const stats = await fetchDashboardStats(uid, false);
    // null count is NOT an error: the function does not force 0 nor
    // throw — it leaves dueCount at its init (0) and CONTINUES to the
    // progress read (unlike getDueCardsCount which coerces null->0).
    expect(stats.dueCount).toBe(0);
    expect(stats.reviewedToday).toBe(4);
    expect(h.state.fromCalls).toContain('daily_progress');
  });
});

describe('cloud mode sequential-await skip [TC-11]', () => {
  it('TC-11 due-count TimeoutError SKIPS the progress fetch (sequential await, NOT Promise.all) ⚠invariant', async () => {
    h.state.due.throwVal = new TimeoutError('DashboardPage: due cards count', 8_000);
    await expect(fetchDashboardStats(uid, false)).rejects.toBeInstanceOf(TimeoutError);
    // Proof of sequential ordering: the daily_progress query was never
    // even issued because the due query threw first. Promise.all would
    // have fired both before the throw.
    expect(h.state.fromCalls).toContain('learner_cards');
    expect(h.state.fromCalls).not.toContain('daily_progress');
  });
});

describe('cloud mode PGRST116 tolerance [TC-12]', () => {
  it('TC-12 daily_progress maybeSingle returning PGRST116 (no row) is tolerated, not thrown', async () => {
    h.state.due.count = 0;
    h.state.prog.data = null;
    h.state.prog.error = { code: 'PGRST116', message: 'no rows' };
    const stats = await fetchDashboardStats(uid, false);
    expect(stats).toEqual({ dueCount: 0, reviewedToday: 0 });
    expect(h.state.fromCalls).toContain('daily_progress');
  });
});

describe('cloud mode error propagation [TC-13/14]', () => {
  it('TC-13 a real TimeoutError propagates OUT (not swallowed) ⚠invariant', async () => {
    const err = new TimeoutError('DashboardPage: due cards count', 8_000);
    h.state.due.throwVal = err;
    await expect(fetchDashboardStats(uid, false)).rejects.toBe(err);
    await expect(fetchDashboardStats(uid, false)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('TC-14 a NON-timeout generic Error is RETHROWN (never mapped to 0) ⚠invariant', async () => {
    const err = new Error('network down');
    h.state.due.throwVal = err;
    await expect(fetchDashboardStats(uid, false)).rejects.toBe(err);
  });

  it('TC-14 a supabase error object on the due query is RETHROWN (never mapped to 0) ⚠invariant', async () => {
    // due query resolves with {count, error} where error is set; the
    // read-model does `if (error) throw error`.
    h.state.due.count = null;
    h.state.due.error = { code: '500', message: 'PG exploded' };
    await expect(fetchDashboardStats(uid, false)).rejects.toEqual({
      code: '500',
      message: 'PG exploded',
    });
    // And it must NOT have fallen through to a 0-result resolve.
    expect(h.state.fromCalls).not.toContain('daily_progress');
  });
});
