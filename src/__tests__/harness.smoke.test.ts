import { describe, it, expect } from 'vitest';

// Harness sanity check only. Confirms vitest + happy-dom load and that the
// DOM-ish environment exposes localStorage (needed by mock-path tests).
describe('harness smoke', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('provides a happy-dom localStorage', () => {
    expect(typeof localStorage).toBe('object');
    localStorage.setItem('smoke', 'ok');
    expect(localStorage.getItem('smoke')).toBe('ok');
    localStorage.clear();
  });
});
