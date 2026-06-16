import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeoutError } from '../timeout';
import { callAIProvider, streamGemini, type AIConfig, type ChatMessage } from '../aiClient';

/**
 * Characterization + behavior-lock tests for aiClient's timeout throw sites.
 *
 * Context (M2 brownfield, task 20260616-1545-timeouterror-dedup):
 *   aiClient.ts used to declare its OWN private `class TimeoutError` (aiClient.ts:48-53)
 *   and throw it from the two AbortController catch branches:
 *     - guardedFetch        (aiClient.ts:74)  -> non-stream provider calls
 *     - streamGemini        (aiClient.ts:303) -> Gemini SSE stream
 *   The 4 consumers do `err instanceof TimeoutError` against the CANONICAL class in
 *   `../timeout`, so aiClient-originated timeouts NEVER matched (latent bug).
 *
 * The dedup change (BE) removes the private class and re-points both throws at the
 * canonical `TimeoutError` from `../timeout`. These tests encode the POST-FIX
 * expected behavior:
 *   - the thrown error is `instanceof` the canonical `TimeoutError` (TC-03 — red on main)
 *   - it carries `.label` and `.ms` (only the canonical class has these)
 *   - a non-abort fetch error is re-thrown unchanged (not reclassified)
 *
 * The impact area had ZERO existing coverage (see regression-baseline.md), so this
 * file is the safety net that makes the legacy edit safe AND proves the fix landed.
 *
 * Mocking strategy: we stub global `fetch`. To exercise the real abort branch we
 * (a) assert aiClient actually wired an AbortSignal into the request, then
 * (b) reject with the same `AbortError` DOMException that `controller.abort()`
 * surfaces from a real fetch. This drives the genuine throw site rather than
 * mocking aiClient itself away.
 */

const PROVIDER_TIMEOUT_MS = 30_000; // FETCH_TIMEOUT_MS default in aiClient.ts

const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

/** A fetch mock that proves the abort wiring exists, then simulates the aborted rejection. */
function abortingFetch() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    // The whole point of the timeout path: aiClient must hand fetch an AbortSignal.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // What a real fetch rejects with once controller.abort() fires.
    throw new DOMException('The operation was aborted.', 'AbortError');
  });
}

/** Run a promise and capture its rejection value (or null if it unexpectedly resolves). */
async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e) => e,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guardedFetch timeout (non-stream providers) [TC-01]', () => {
  const config: AIConfig = { provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini' };

  it('TC-01 rejects with the canonical TimeoutError carrying label + ms when the request aborts', async () => {
    vi.stubGlobal('fetch', abortingFetch());

    const err = await rejectionOf(callAIProvider(config, messages));

    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).name).toBe('TimeoutError');
    expect((err as TimeoutError).label).toBe('OpenAI');
    expect((err as TimeoutError).ms).toBe(PROVIDER_TIMEOUT_MS);
    // Message format is asserted loosely on purpose: the warn-text delta changes
    // "OpenAI request timed out after 30 s" -> "OpenAI timed out after 30 s" (AC-07).
    // We pin only the stable substring so neither wording breaks this test.
    expect((err as TimeoutError).message).toMatch(/timed out after 30 s/);
  });

  it('TC-01-neg re-throws a non-abort fetch error unchanged (not reclassified as TimeoutError)', async () => {
    const networkError = new Error('network boom');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw networkError;
      }),
    );

    const err = await rejectionOf(callAIProvider(config, messages));

    expect(err).toBe(networkError);
    expect(err).not.toBeInstanceOf(TimeoutError);
  });
});

describe('streamGemini timeout (SSE stream) [TC-02]', () => {
  const config: AIConfig = { provider: 'gemini', apiKey: 'test-key', model: 'gemini-2.5-flash' };

  it('TC-02 rejects with the canonical TimeoutError, label "Gemini (stream)", ms = passed timeout', async () => {
    vi.stubGlobal('fetch', abortingFetch());
    const customTimeout = 5_000;
    const onDelta = vi.fn();

    const err = await rejectionOf(streamGemini(config, messages, onDelta, customTimeout));

    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).name).toBe('TimeoutError');
    expect((err as TimeoutError).label).toBe('Gemini (stream)');
    expect((err as TimeoutError).ms).toBe(customTimeout);
    expect(onDelta).not.toHaveBeenCalled();
  });
});

describe('canonical TimeoutError identity (latent-bug lock) [TC-03]', () => {
  // This is the assertion that FAILS on main (aiClient threw its own private class,
  // so `instanceof` the canonical class was false) and PASSES after the dedup.
  // It is the behavioral proof the change delivers AC-03 / BA-AC-02.

  it('TC-03a guardedFetch timeout satisfies `instanceof` the canonical TimeoutError from ../timeout', async () => {
    const config: AIConfig = { provider: 'gemini', apiKey: 'test-key', model: 'gemini-2.5-flash' };
    vi.stubGlobal('fetch', abortingFetch());

    const err = await rejectionOf(callAIProvider(config, messages));

    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).label).toBe('Gemini');
    expect((err as TimeoutError).ms).toBe(PROVIDER_TIMEOUT_MS);
  });

  it('TC-03b streamGemini timeout satisfies `instanceof` the canonical TimeoutError from ../timeout', async () => {
    const config: AIConfig = { provider: 'gemini', apiKey: 'test-key', model: 'gemini-2.5-flash' };
    vi.stubGlobal('fetch', abortingFetch());

    const err = await rejectionOf(streamGemini(config, messages, vi.fn(), 12_000));

    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).label).toBe('Gemini (stream)');
    expect((err as TimeoutError).ms).toBe(12_000);
  });
});
