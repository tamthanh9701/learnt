/**
 * useFormDirty — tiny state machine used by SettingsPage to guard against
 * `useEffect([savedConfig])` clobbering in-flight user edits.
 *
 * The React-level hook (`useFormDirtyReact`) is a thin wrapper that exposes
 * the same state machine via a ref so React doesn't re-render on every
 * `markDirty()` call. Re-rendering is unnecessary: the consumer (useEffect)
 * reads the ref inside the effect callback, not during render.
 *
 * Why a custom ref-based state instead of `useState`?
 *   - We don't want every keystroke to trigger a re-render of the
 *     SettingsPage. The dirty flag is only checked inside useEffect, so a
 *     ref is enough.
 *   - We want the ability to subscribe (for tests + future debug overlay)
 *     without coupling to React's render cycle.
 *
 * Usage in SettingsPage (F2 fix):
 *   const dirty = useFormDirtyReact();
 *   useEffect(() => {
 *     if (dirty.isDirty()) return; // <-- skip sync if user is editing
 *     setAiProvider(savedConfig.provider);
 *     ...
 *   }, [savedConfig]);
 *   onChange={(e) => { setAiApiKey(e.target.value); dirty.markDirty(); }}
 *   onClick={async () => {
 *     await save();
 *     dirty.markClean();
 *   }}
 */

export interface FormDirty {
  isDirty: () => boolean;
  markDirty: () => void;
  markClean: () => void;
  /** Subscribe to transitions. Returns an unsubscribe function. */
  subscribe: (listener: (value: boolean) => void) => () => void;
}

/**
 * Pure state machine — no React, fully testable.
 */
export function createFormDirty(): FormDirty {
  let value = false;
  const listeners = new Set<(v: boolean) => void>();

  const setValue = (next: boolean) => {
    if (value === next) return;
    value = next;
    for (const l of listeners) l(next);
  };

  return {
    isDirty: () => value,
    markDirty: () => setValue(true),
    markClean: () => setValue(false),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * React wrapper: returns a stable FormDirty instance bound to the component
 * lifetime. Re-renders do NOT recreate the state machine (useRef), so the
 * markDirty() calls from onChange handlers are idempotent across renders.
 */
import { useRef } from 'react';
export function useFormDirtyReact(): FormDirty {
  const ref = useRef<FormDirty | null>(null);
  if (ref.current === null) {
    ref.current = createFormDirty();
  }
  return ref.current;
}
