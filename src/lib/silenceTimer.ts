/**
 * silenceTimer.ts — pure VAD (voice-activity-detection) silence scheduler.
 *
 * Pseudo-live conversation (Live v1) auto-sends a turn when the Learner pauses.
 * The "pause" detection is just a debounce: every speech result re-arms a
 * timer; if it elapses, the turn is final. That scheduling logic is extracted
 * here as a tiny, dependency-free state machine so it can be unit-tested with
 * fake timers WITHOUT rendering the React hook (the repo has no
 * @testing-library/react, and timer logic shouldn't need a DOM to be verified).
 *
 * The hook (useSpeechRecognition) owns a SilenceTimer and feeds it `bump()` on
 * each result + `cancel()` on stop/error/unmount.
 */

export interface SilenceTimerOptions {
  /** Pause length in ms before `onElapse` fires. <= 0 disables the timer. */
  timeoutMs: number;
  /** Called once when the pause elapses without a new bump. */
  onElapse: () => void;
  /** Injected setTimeout/clearTimeout for tests; defaults to the globals. */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface SilenceTimer {
  /** (Re)start the countdown. Each call cancels the previous pending fire. */
  bump: () => void;
  /** Cancel any pending fire. Idempotent. */
  cancel: () => void;
}

/**
 * Create a silence timer. Disabled (no-op) when timeoutMs <= 0, so callers can
 * always construct one and let configuration decide whether VAD is active.
 */
export function createSilenceTimer(opts: SilenceTimerOptions): SilenceTimer {
  const setT = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h));
  let handle: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (handle !== null) {
      clearT(handle);
      handle = null;
    }
  };

  const bump = () => {
    if (opts.timeoutMs <= 0) return;
    cancel();
    handle = setT(() => {
      handle = null;
      opts.onElapse();
    }, opts.timeoutMs);
  };

  return { bump, cancel };
}
