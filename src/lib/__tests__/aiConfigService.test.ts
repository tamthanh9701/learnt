/**
 * Regression tests for src/lib/aiConfigService — cloud timeout + fallback
 * behavior. These cover the root cause of the "infinite loading on Save
 * AI Config" bug from the diagnose session:
 *
 *   - saveAIConfig previously called supabase.from('ai_configs')... without
 *     a timeout, so a slow / hung Supabase backend (or a missing table)
 *     would leave the Save spinner spinning forever and the test-connection
 *     button stuck behind it.
 *
 * We mock the supabase client with a thenable chainable builder. Each test
 * configures the chain to simulate a hang, an error, or a happy path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.hoisted is required because vi.mock factories are hoisted to the top
// of the file before the const declarations below run.
const { mockSupabase, setChainResult } = vi.hoisted(() => {
  // The "result" that the chain resolves to when awaited. Tests can
  // change this between assertions to control what the chain returns.
  let result: { data: any; error: any } = { data: null, error: null };
  const setResult = (r: { data: any; error: any }) => { result = r; };

  // Each method returns a Proxy that:
  //   - acts as a chainable builder (any method call returns itself)
  //   - when awaited (i.e. `.then(fn)` is called) resolves to `result`
  // This mirrors how @supabase/supabase-js's PostgrestQueryBuilder works.
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
      }
      // For any other method call, return a function that returns a new Proxy
      // over the same target (so chaining always yields the same chain).
      return () => new Proxy({}, handler);
    },
  };
  const chain = new Proxy({}, handler);

  return {
    mockSupabase: { from: vi.fn(() => chain) },
    setChainResult: setResult,
  };
});

vi.mock('../supabase', () => ({
  supabase: mockSupabase,
}));

// Import AFTER the mock so the service captures the mocked supabase.
import { loadAIConfig, saveAIConfig } from '../aiConfigService';
import type { AIConfig } from '../aiClient';

const sampleConfig: AIConfig = {
  provider: 'gemini',
  apiKey: 'AIza-test-key',
  model: 'gemini-2.5-flash',
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setChainResult({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// loadAIConfig
// ---------------------------------------------------------------------------

describe('loadAIConfig — graceful cloud-failure fallback', () => {
  it('returns the local cache when the cloud query throws a non-PGRST116 error', async () => {
    // Seed the local cache with a config the user previously saved.
    localStorage.setItem('learnt_ai_config', JSON.stringify(sampleConfig));

    // Simulate "ai_configs table does not exist" — PostgRest returns
    // a 400-ish error with code 42P01 (undefined_table) or similar.
    setChainResult({
      data: null,
      error: { code: '42P01', message: 'relation "public.ai_configs" does not exist' },
    });

    const loaded = await loadAIConfig('user-1', false);

    expect(loaded).toEqual(sampleConfig);
  });

  it('returns the default config when both cloud and local are empty', async () => {
    setChainResult({
      data: null,
      error: { code: 'PGRST116', message: 'Row not found' },
    });

    const loaded = await loadAIConfig('user-1', false);

    expect(loaded.provider).toBe('none');
    expect(loaded.apiKey).toBe('');
    expect(loaded.model).toBe('');
  });

  it('returns the cloud row when present', async () => {
    setChainResult({
      data: {
        user_id: 'user-1',
        provider: 'openai',
        api_key: 'sk-test',
        model: 'gpt-4o-mini',
        ollama_base_url: null,
      },
      error: null,
    });

    const loaded = await loadAIConfig('user-1', false);

    expect(loaded.provider).toBe('openai');
    expect(loaded.apiKey).toBe('sk-test');
    expect(loaded.model).toBe('gpt-4o-mini');
  });

  it('returns the local config synchronously when in mock mode (no cloud call)', async () => {
    localStorage.setItem('learnt_ai_config', JSON.stringify(sampleConfig));

    const loaded = await loadAIConfig('user-1', true);

    expect(loaded).toEqual(sampleConfig);
    // Mock mode must NOT touch the cloud.
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// saveAIConfig — the bug we actually fixed
// ---------------------------------------------------------------------------

describe('saveAIConfig — never hangs, always returns CloudResult', () => {
  it('writes the local cache BEFORE attempting the cloud save', async () => {
    // Configure chain to return "no existing row" so the insert path runs,
    // and resolve successfully.
    setChainResult({ data: null, error: null });

    // Call saveAIConfig but DON'T await — we want to inspect the
    // synchronous pre-await state of localStorage. The cloud call
    // (which uses a Proxy) will resolve on the next microtask.
    void saveAIConfig('user-1', sampleConfig, false);

    // Yield one microtask so any sync code in saveAIConfig runs.
    // (setLocalConfig is sync and runs before the first `await`.)
    await Promise.resolve();

    // The local cache MUST be written even before the cloud call resolves.
    const cached = JSON.parse(localStorage.getItem('learnt_ai_config') || 'null');
    expect(cached).toEqual(sampleConfig);
  });

  it('returns { cloudOk: false } when the cloud call throws (no hang, no crash)', async () => {
    // Simulate the exact failure mode that triggered the original bug:
    // a missing `ai_configs` table returns a non-PGRST116 error.
    setChainResult({
      data: null,
      error: { code: '42P01', message: 'relation "public.ai_configs" does not exist' },
    });

    const result = await saveAIConfig('user-1', sampleConfig, false);

    // The local cache was still written — caller can show "Saved locally".
    const cached = JSON.parse(localStorage.getItem('learnt_ai_config') || 'null');
    expect(cached).toEqual(sampleConfig);
    // ...but the cloud result is honest about the failure.
    expect(result.cloudOk).toBe(false);
    expect(result.reason).toContain('does not exist');
  });

  it('returns { cloudOk: true } on a normal upsert path (existing row → update)', async () => {
    // First call (maybeSingle) returns an existing row → service takes update path.
    // Second call (update chain) succeeds.
    setChainResult({ data: { id: 'row-1' }, error: null });

    const result = await saveAIConfig('user-1', sampleConfig, false);
    expect(result.cloudOk).toBe(true);
  });

  it('returns { cloudOk: true } on a normal insert path (no existing row → insert)', async () => {
    // maybeSingle returns null → service takes the insert path.
    setChainResult({ data: null, error: null });

    const result = await saveAIConfig('user-1', sampleConfig, false);
    expect(result.cloudOk).toBe(true);
  });

  it('skips the cloud call entirely when isMock=true', async () => {
    const result = await saveAIConfig('user-1', sampleConfig, true);
    expect(result.cloudOk).toBe(true);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
