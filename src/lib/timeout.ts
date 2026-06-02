/**
 * Shared timeout utility for async operations.
 *
 * Background: in this app, a slow / hung Supabase backend, a slow LLM
 * provider, or a stale localStorage token can leave fetch() promises
 * pending indefinitely. Without a default timeout, a single hung query
 * would block the calling component's `setLoading(false)` forever and
 * the user would see a permanent spinner.
 *
 * `withTimeout` runs the provided async fn with an AbortController +
 * hard timeout. If the timer fires before fn resolves, the returned
 * promise rejects with a TimeoutError carrying the label + ms.
 *
 * Usage:
 *   const data = await withTimeout(
 *     async (signal) => supabase.from('x').select('*').abortSignal(signal),
 *     10_000,
 *     'loadX',
 *   );
 */

/** Reject an AbortController-fired AbortError as a labeled TimeoutError. */
export class TimeoutError extends Error {
  readonly label: string;
  readonly ms: number;
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms / 1000} s`);
    this.name = 'TimeoutError';
    this.label = label;
    this.ms = ms;
  }
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new TimeoutError(label, ms);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
