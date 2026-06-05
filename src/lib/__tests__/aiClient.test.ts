/**
 * Regression tests for src/lib/aiClient — typed error hierarchy for
 * provider responses, plus the model-probe helper used by SettingsPage
 * when a Test connection returns a QuotaExhaustedError.
 *
 * Background (diagnosis 2026-06-04, finding F1):
 *   Prior to this fix, `aiClient.guardedFetch` threw `new Error(...)` with
 *   the raw response body for any non-OK status. For Gemini 429
 *   RESOURCE_EXHAUSTED (a fast <1s error caused by free-tier quota
 *   exhaustion), the Error.message was a wall-of-JSON, and the SettingsPage
 *   test-connection flow had no way to distinguish quota exhaustion from
 *   auth failures from transient errors. Users with cached exhausted
 *   models (e.g. gemini-2.0-flash) clicked Test → saw scary error → clicked
 *   again → same error → "loop" feel.
 *
 * The fix introduces a typed error hierarchy:
 *   - `QuotaExhaustedError` extends Error, carries `model` and `retryAfter`
 *   - `parseGeminiError(body, model)` parses Gemini's error envelope and
 *     returns a discriminated union
 *   - `guardedFetch` (or a new wrapper) uses these to throw typed errors
 *
 * Background (diagnosis 2026-06-05, finding H6):
 *   The SettingsPage F1 catch-handler surfaced "Try one of these: X, Y, Z"
 *   by slicing the first 3 models in PROVIDER_MODELS.gemini (minus the
 *   failing one). This was a guess — it never verified those models
 *   actually had remaining quota. With the user's real API key, 2 of the
 *   3 suggested models were also exhausted, so the hint misled the user
 *   into trying more broken models.
 *
 *   The fix: `probeGeminiModels(apiKey, modelList)` sends a tiny test
 *   request to each candidate in parallel and returns which ones returned
 *   200 OK. The UI then shows only the actually-working models. If the
 *   probe finds none, the UI shows a generic fallback message instead of
 *   a misleading list.
 *
 * These tests lock down:
 *   - `parseGeminiError` (F1)
 *   - Typed error classes (F1)
 *   - `probeGeminiModels` happy path, all-exhausted, and partial (H6)
 *   - `probeGeminiModels` never throws — even network/timeout errors
 *     surface as ProbeResult with reason:'error' (defensive — the UI
 *     depends on this to render something useful).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseGeminiError, probeGeminiModels, QuotaExhaustedError, AuthError, RateLimitError, ProviderError } from '../aiClient';

describe('parseGeminiError', () => {
  it('returns kind:"quota" with model + retryAfter for RESOURCE_EXHAUSTED 429', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: 'Resource has been exhausted (e.g. check quota).',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              { quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerMinutePerProject' },
            ],
          },
        ],
      },
    });

    const parsed = parseGeminiError(body, 'gemini-2.0-flash');

    expect(parsed.kind).toBe('quota');
    expect(parsed.model).toBe('gemini-2.0-flash');
    expect(parsed.status).toBe('RESOURCE_EXHAUSTED');
    // retryAfter is 0 here because this particular response doesn't include
    // a "Please retry in Ns" hint (Gemini sometimes omits it, esp. for
    // limit: 0). The retryAfter-extraction behavior is covered by a
    // dedicated test below.
    expect(parsed.retryAfter).toBe(0);
  });

  it('returns kind:"quota" with model from the request URL (passed in by caller)', () => {
    // Some 429 responses don't include the model name; the caller must supply it
    const body = JSON.stringify({
      error: {
        code: 429,
        message: 'Quota exceeded',
        status: 'RESOURCE_EXHAUSTED',
      },
    });

    const parsed = parseGeminiError(body, 'gemini-2.5-pro');
    expect(parsed.kind).toBe('quota');
    expect(parsed.model).toBe('gemini-2.5-pro');
  });

  it('returns kind:"rate_limit" with retryAfter for 429 RATE_LIMIT_EXCEEDED (not quota)', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: 'Rate limit exceeded. Please retry in 12s.',
        status: 'RATE_LIMIT_EXCEEDED',
      },
    });

    const parsed = parseGeminiError(body, 'gemini-2.5-flash');
    expect(parsed.kind).toBe('rate_limit');
    expect(parsed.retryAfter).toBe(12);
  });

  it('returns kind:"auth" for 401/403', () => {
    const body = JSON.stringify({
      error: { code: 401, message: 'API key not valid', status: 'UNAUTHENTICATED' },
    });

    const parsed = parseGeminiError(body, 'gemini-2.5-flash');
    expect(parsed.kind).toBe('auth');
    expect(parsed.model).toBe('gemini-2.5-flash');
  });

  it('returns kind:"other" for any unrecognised shape (defensive fallback)', () => {
    const body = 'plain text error from upstream';

    const parsed = parseGeminiError(body, 'gemini-2.5-flash');
    expect(parsed.kind).toBe('other');
    expect(parsed.model).toBe('gemini-2.5-flash');
    expect(parsed.message).toContain('plain text error');
  });

  it('returns kind:"other" when body is empty', () => {
    const parsed = parseGeminiError('', 'gemini-2.5-flash');
    expect(parsed.kind).toBe('other');
    expect(parsed.model).toBe('gemini-2.5-flash');
  });

  it('extracts retryAfter from "Please retry in 44.7s" message (decimal seconds → ceil)', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: 'Quota exceeded. Please retry in 44.7s.',
        status: 'RESOURCE_EXHAUSTED',
      },
    });

    const parsed = parseGeminiError(body, 'gemini-2.0-flash');
    // 44.7s → ceil to 45
    expect(parsed.kind).toBe('quota');
    expect(parsed.retryAfter).toBe(45);
  });
});

describe('QuotaExhaustedError', () => {
  it('is an Error subclass and an instance of QuotaExhaustedError', () => {
    const err = new QuotaExhaustedError('gemini-2.0-flash', 45);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(QuotaExhaustedError);
    expect(err.name).toBe('QuotaExhaustedError');
    expect(err.model).toBe('gemini-2.0-flash');
    expect(err.retryAfter).toBe(45);
    expect(err.message).toContain('gemini-2.0-flash');
    expect(err.message).toContain('45');
  });

  it('is distinguishable from generic Error via instanceof', () => {
    const err: unknown = new QuotaExhaustedError('gemini-2.5-pro', 60);
    // The whole point: SettingsPage can do `err instanceof QuotaExhaustedError`
    if (err instanceof QuotaExhaustedError) {
      // narrow type — model + retryAfter available
      expect(err.model).toBe('gemini-2.5-pro');
    } else {
      throw new Error('instanceof check failed — typed error not recognised');
    }
  });
});

describe('AuthError and RateLimitError (sibling typed errors)', () => {
  it('AuthError carries the model name and is instanceof AuthError', () => {
    const err = new AuthError('gemini-2.5-flash', 'API key invalid');
    expect(err).toBeInstanceOf(AuthError);
    expect(err.name).toBe('AuthError');
    expect(err.model).toBe('gemini-2.5-flash');
  });

  it('RateLimitError carries model + retryAfter', () => {
    const err = new RateLimitError('gemini-2.5-flash', 12);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(12);
  });
});

describe('ProviderError fallback', () => {
  it('is a generic Error wrapper for any unrecognised provider error', () => {
    const err = new ProviderError('gemini-2.5-flash', 500, 'Internal server error');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.model).toBe('gemini-2.5-flash');
    expect(err.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// probeGeminiModels (H6 fix)
// ---------------------------------------------------------------------------

/** Build a fake Response object matching what guardedFetchGemini consumes. */
function makeFakeResponse(opts: { ok: boolean; status: number; body?: string }): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    text: async () => opts.body ?? '',
    json: async () => { try { return JSON.parse(opts.body ?? '{}'); } catch { return {}; } },
  } as unknown as Response;
}

describe('probeGeminiModels (H6 model-swap hint)', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-QUOTA-PROBE-PARTIAL: 2/4 working, 2/4 quota-exhausted → returns mixed ProbeResult list', async () => {
    // Simulate: 4 candidate models, 2 working + 2 exhausted
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeFakeResponse({ ok: true, status: 200 }))   // gemini-2.5-flash → working
      .mockResolvedValueOnce(makeFakeResponse({ ok: true, status: 200 }))   // gemini-2.5-flash-lite → working
      .mockResolvedValueOnce(makeFakeResponse({                            // gemini-2.5-pro → quota
        ok: false, status: 429,
        body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }),
      }))
      .mockResolvedValueOnce(makeFakeResponse({                            // gemini-2.0-flash → quota
        ok: false, status: 429,
        body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }),
      }));

    const results = await probeGeminiModels('AQ.test-key', [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
    ]);

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ model: 'gemini-2.5-flash', ok: true, reason: 'working' });
    expect(results[1]).toEqual({ model: 'gemini-2.5-flash-lite', ok: true, reason: 'working' });
    expect(results[2]).toEqual({ model: 'gemini-2.5-pro', ok: false, reason: 'quota' });
    expect(results[3]).toEqual({ model: 'gemini-2.0-flash', ok: false, reason: 'quota' });
    // UI can filter: results.filter(r => r.ok).map(r => r.model) → ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
  });

  it('TC-QUOTA-PROBE-ALL-EXHAUSTED: all 4 candidates return 429 → reason:"quota" for all', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValue(makeFakeResponse({
        ok: false, status: 429,
        body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }),
      }));

    const results = await probeGeminiModels('AQ.test-key', [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
    ]);

    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('quota');
    }
    // UI sees working=[] and renders the generic fallback (H6 plan C)
  });

  it('TC-QUOTA-PROBE-AUTH-FAIL: 401 for one model → reason:"auth" (separate from quota)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeFakeResponse({                            // gemini-2.5-flash → working
        ok: true, status: 200,
      }))
      .mockResolvedValueOnce(makeFakeResponse({                            // gemini-2.5-pro → auth
        ok: false, status: 401,
        body: JSON.stringify({ error: { code: 401, status: 'UNAUTHENTICATED', message: 'API key not valid' } }),
      }));

    const results = await probeGeminiModels('AQ.invalid-key', [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);

    expect(results[0]).toEqual({ model: 'gemini-2.5-flash', ok: true, reason: 'working' });
    expect(results[1]).toEqual({ model: 'gemini-2.5-pro', ok: false, reason: 'auth' });
  });

  it('TC-QUOTA-PROBE-NETWORK-FAIL: fetch throws (network) → reason:"error" + NEVER throws', async () => {
    // This is the critical defensive test: the UI relies on probeGeminiModels
    // to NEVER throw. If it throws, the outer SettingsPage catch would have
    // to deal with the probe error AS WELL AS the original QuotaExhaustedError.
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    const results = await probeGeminiModels('AQ.test-key', [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      model: 'gemini-2.5-flash',
      ok: false,
      reason: 'error',
      detail: 'Failed to fetch',
    });
    expect(results[1].reason).toBe('error');
  });

  it('TC-QUOTA-PROBE-EMPTY-LIST: empty input → empty result (no probe calls)', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const results = await probeGeminiModels('AQ.test-key', []);
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('TC-QUOTA-PROBE-USE-API-KEY: sends the x-goog-api-key header with the user-supplied key', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeFakeResponse({ ok: true, status: 200 }));

    await probeGeminiModels('AQ.user-key-xyz', ['gemini-2.5-flash']);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const [, init] = call as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AQ.user-key-xyz');
    expect(init.method).toBe('POST');
  });
});
