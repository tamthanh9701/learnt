/**
 * Regression tests for src/hooks/useFormDirty — the dirty-flag hook that
 * prevents useEffect([savedConfig]) from clobbering user input mid-save
 * (diagnosis 2026-06-04, finding F2).
 *
 * Background: SettingsPage's form state (apiKey, model, provider, ollamaUrl)
 * is local to the component, but the "saved" config lives in AIContext. When
 * the user saves, AIContext.config changes, which triggers
 * useEffect([savedConfig]) that re-syncs the local state — wiping any
 * in-flight user edits. The fix: a useFormDirty ref that, when set,
 * short-circuits the sync.
 *
 * The hook is pure (no React rendering needed for the state machine), so
 * we can test the state transitions directly without @testing-library/react.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFormDirty } from '../useFormDirty';

describe('useFormDirty — pure state machine (no React needed)', () => {
  let dirty: ReturnType<typeof createFormDirty>;

  beforeEach(() => {
    dirty = createFormDirty();
  });

  it('starts clean (isDirty=false)', () => {
    expect(dirty.isDirty()).toBe(false);
  });

  it('markDirty() flips to dirty (isDirty=true)', () => {
    dirty.markDirty();
    expect(dirty.isDirty()).toBe(true);
  });

  it('markClean() flips back to clean (idempotent: already clean stays clean)', () => {
    expect(dirty.isDirty()).toBe(false);
    dirty.markClean();
    expect(dirty.isDirty()).toBe(false);
  });

  it('markDirty() then markClean() returns to clean', () => {
    dirty.markDirty();
    expect(dirty.isDirty()).toBe(true);
    dirty.markClean();
    expect(dirty.isDirty()).toBe(false);
  });

  it('markDirty() is idempotent: calling twice stays dirty', () => {
    dirty.markDirty();
    dirty.markDirty();
    expect(dirty.isDirty()).toBe(true);
  });

  it('subscribe() fires on every transition, with the new value', () => {
    const log: boolean[] = [];
    const unsub = dirty.subscribe((v) => log.push(v));

    // Constructor (if any) does not fire — only transitions do.
    dirty.markDirty();
    dirty.markClean();
    dirty.markDirty();
    unsub();
    dirty.markClean(); // unsubscribed, should not appear in log

    expect(log).toEqual([true, false, true]);
  });

  it('multiple subscribers all receive every transition', () => {
    const logA: boolean[] = [];
    const logB: boolean[] = [];
    const unsubA = dirty.subscribe((v) => logA.push(v));
    const unsubB = dirty.subscribe((v) => logB.push(v));

    dirty.markDirty();
    dirty.markClean();
    unsubA();
    dirty.markDirty();
    unsubB();

    expect(logA).toEqual([true, false]);
    expect(logB).toEqual([true, false, true]);
  });

  it('unsubscribe stops the listener from receiving future transitions', () => {
    const log: boolean[] = [];
    const unsub = dirty.subscribe((v) => log.push(v));
    dirty.markDirty();
    unsub();
    dirty.markClean();
    dirty.markDirty();
    expect(log).toEqual([true]);
  });
});
