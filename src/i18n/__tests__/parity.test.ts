import { describe, it, expect } from 'vitest';
import en from '../en.json';
import vi from '../vi.json';

// Flatten a nested translation object into dot-notation leaf keys.
const flatten = (obj: Record<string, unknown>, prefix = ''): string[] => {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object'
      ? flatten(v as Record<string, unknown>, key)
      : [key];
  });
};

describe('i18n key-set parity (AC-I1.3)', () => {
  const enKeys = flatten(en as Record<string, unknown>).sort();
  const viKeys = flatten(vi as Record<string, unknown>).sort();

  it('en.json and vi.json have identical key sets (bidirectional)', () => {
    const enOnly = enKeys.filter((k) => !viKeys.includes(k));
    const viOnly = viKeys.filter((k) => !enKeys.includes(k));
    expect(enOnly).toEqual([]);
    expect(viOnly).toEqual([]);
  });

  it('every VI value is a non-empty string', () => {
    const viLeaves = flatten(vi as Record<string, unknown>);
    for (const key of viLeaves) {
      const value = key.split('.').reduce<any>((acc, part) => acc?.[part], vi);
      expect(typeof value, key).toBe('string');
      expect((value as string).trim().length, key).toBeGreaterThan(0);
    }
  });

  it('includes the new Tier B key groups', () => {
    expect(enKeys).toContain('errors.boundaryTitle');
    expect(enKeys).toContain('a11y.skipToMain');
    expect(enKeys).toContain('speech.unsupported');
    expect(enKeys).toContain('dashboard.statsError');
    expect(viKeys).toContain('errors.boundaryTitle');
    expect(viKeys).toContain('a11y.skipToMain');
  });
});
