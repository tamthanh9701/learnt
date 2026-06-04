/**
 * Regression tests for src/lib/aiClient — typed error hierarchy for
 * provider responses.
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
 * These tests lock down the parser + error class behavior. The SettingsPage
 * UI tests for F1's catch-handler are deferred to F6 (UI test infra ticket).
 */

import { describe, it, expect } from 'vitest';
import { parseGeminiError, QuotaExhaustedError, AuthError, RateLimitError, ProviderError } from '../aiClient';

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
