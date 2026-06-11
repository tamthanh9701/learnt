import { describe, it, expect, vi } from 'vitest';
import { createSilenceTimer } from '../silenceTimer';

describe('createSilenceTimer [TC-VAD]', () => {
  it('TC-VAD-01 fires onElapse after the pause when not re-bumped', () => {
    vi.useFakeTimers();
    const onElapse = vi.fn();
    const timer = createSilenceTimer({ timeoutMs: 1800, onElapse });

    timer.bump();
    vi.advanceTimersByTime(1000);
    expect(onElapse).not.toHaveBeenCalled();

    vi.advanceTimersByTime(900);
    expect(onElapse).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('TC-VAD-02 each bump re-arms the timer (debounce, no premature fire)', () => {
    vi.useFakeTimers();
    const onElapse = vi.fn();
    const timer = createSilenceTimer({ timeoutMs: 1800, onElapse });

    timer.bump();
    vi.advanceTimersByTime(1500);
    timer.bump(); // new speech before the pause completes
    vi.advanceTimersByTime(1500);
    expect(onElapse).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onElapse).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('TC-VAD-03 timeoutMs <= 0 disables the timer (never fires)', () => {
    vi.useFakeTimers();
    const onElapse = vi.fn();
    const timer = createSilenceTimer({ timeoutMs: 0, onElapse });

    timer.bump();
    vi.advanceTimersByTime(10_000);
    expect(onElapse).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('TC-VAD-04 cancel() prevents a pending fire', () => {
    vi.useFakeTimers();
    const onElapse = vi.fn();
    const timer = createSilenceTimer({ timeoutMs: 1800, onElapse });

    timer.bump();
    vi.advanceTimersByTime(1000);
    timer.cancel();
    vi.advanceTimersByTime(2000);
    expect(onElapse).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('TC-VAD-05 fires only once per armed cycle', () => {
    vi.useFakeTimers();
    const onElapse = vi.fn();
    const timer = createSilenceTimer({ timeoutMs: 500, onElapse });

    timer.bump();
    vi.advanceTimersByTime(2000);
    expect(onElapse).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('TC-VAD-06 uses injected timer functions when provided', () => {
    let captured: (() => void) | null = null;
    const setTimeoutFn = vi.fn((cb: () => void) => {
      captured = cb;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutFn = vi.fn();
    const onElapse = vi.fn();
    const timer = createSilenceTimer({
      timeoutMs: 1000,
      onElapse,
      setTimeoutFn,
      clearTimeoutFn,
    });

    timer.bump();
    expect(setTimeoutFn).toHaveBeenCalledOnce();
    captured?.();
    expect(onElapse).toHaveBeenCalledOnce();
  });
});
