import { describe, it, expect } from 'vitest';
import { formatAIDiagnostic } from '../aiDiagnosticMessage';
import type { AIDiagnostic } from '../aiClient';

// G3 (diagnosis 2026-06-05): the formatter turns a structured AIDiagnostic
// into an actionable, localized sentence the Learner can act on. These tests
// pin the actionable content (model name, suggested swap, retry seconds) and
// the en/vi parity for every reason.

describe('formatAIDiagnostic (G3) [TC-G3-MSG]', () => {
  it('TC-G3-MSG-01 quota: names the failing model and suggests gemini-2.5-flash (EN)', () => {
    const d: AIDiagnostic = { reason: 'quota', model: 'gemini-2.0-flash', retryAfter: 23, message: 'quota' };
    const msg = formatAIDiagnostic(d, true);
    expect(msg).toContain('gemini-2.0-flash');
    expect(msg).toContain('gemini-2.5-flash');
    expect(msg.toLowerCase()).toContain('settings');
  });

  it('TC-G3-MSG-02 quota: Vietnamese variant mentions the model + Cài đặt', () => {
    const d: AIDiagnostic = { reason: 'quota', model: 'gemini-2.0-flash', message: 'quota' };
    const msg = formatAIDiagnostic(d, false);
    expect(msg).toContain('gemini-2.0-flash');
    expect(msg).toContain('Cài đặt');
  });

  it('TC-G3-MSG-03 rate_limit: includes the retry seconds when provided', () => {
    const d: AIDiagnostic = { reason: 'rate_limit', model: 'gemini-2.5-flash', retryAfter: 12, message: 'rl' };
    expect(formatAIDiagnostic(d, true)).toContain('12s');
  });

  it('TC-G3-MSG-04 rate_limit: omits seconds gracefully when retryAfter is 0/absent', () => {
    const d: AIDiagnostic = { reason: 'rate_limit', model: 'gemini-2.5-flash', retryAfter: 0, message: 'rl' };
    const msg = formatAIDiagnostic(d, true);
    expect(msg).not.toContain('0s');
  });

  it('TC-G3-MSG-05 auth: tells the learner to check the key', () => {
    const d: AIDiagnostic = { reason: 'auth', model: 'gemini-2.5-flash', message: 'bad key' };
    expect(formatAIDiagnostic(d, true).toLowerCase()).toContain('key');
    expect(formatAIDiagnostic(d, false)).toContain('khoá');
  });

  it('TC-G3-MSG-06 not_configured: points to Settings to add a key', () => {
    const d: AIDiagnostic = { reason: 'not_configured', message: 'none' };
    expect(formatAIDiagnostic(d, true).toLowerCase()).toContain('settings');
    expect(formatAIDiagnostic(d, false)).toContain('Cài đặt');
  });

  it('TC-G3-MSG-07 invalid_shape, edge_unavailable, error all produce a non-empty sentence in both locales', () => {
    const reasons: AIDiagnostic['reason'][] = ['invalid_shape', 'edge_unavailable', 'error'];
    for (const reason of reasons) {
      const d: AIDiagnostic = { reason, message: 'detail' };
      expect(formatAIDiagnostic(d, true).length).toBeGreaterThan(10);
      expect(formatAIDiagnostic(d, false).length).toBeGreaterThan(10);
    }
  });

  it('TC-G3-MSG-08 error: embeds the underlying message detail', () => {
    const d: AIDiagnostic = { reason: 'error', message: 'Failed to fetch' };
    expect(formatAIDiagnostic(d, true)).toContain('Failed to fetch');
  });

  it('TC-G3-MSG-09 falls back to "AI" label when model is absent', () => {
    const d: AIDiagnostic = { reason: 'quota', message: 'quota' };
    expect(formatAIDiagnostic(d, true)).toContain('"AI"');
  });
});
