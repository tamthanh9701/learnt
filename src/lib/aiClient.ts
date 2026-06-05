/**
 * AI Client — Pure REST calls to multiple LLM providers.
 * No SDK dependencies. Uses native fetch().
 *
 * Supported providers: Gemini, OpenAI, Anthropic, Ollama
 *
 * Every fetch() is wrapped with AbortController so a slow / hung backend
 * cannot leave the UI in an infinite-loading state.
 *
 * Error model (diagnosis 2026-06-04, finding F1):
 *   For Gemini, non-OK responses are parsed into a discriminated union by
 *   `parseGeminiError` and re-thrown as typed errors (QuotaExhaustedError,
 *   AuthError, RateLimitError, ProviderError). Callers can `instanceof`-check
 *   these to render actionable UI (e.g. "model exhausted, try one of these
 *   working models") instead of a wall-of-JSON in a red banner.
 *
 *   Other providers (OpenAI / Anthropic / Ollama) throw ProviderError, the
 *   generic fallback. Specific typing for them is deferred (F6 follow-up).
 */

export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'none';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  /** Ollama requires a base URL (e.g. http://localhost:11434) */
  ollamaBaseUrl?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Optional per-call tuning. Currently carries the Gemini-only structured-output
 * request (Change 3, BR-12). Non-Gemini providers ignore it — the strict system
 * prompt + defensive parser (`parseStructuredReply`) remain the universal path.
 */
export interface AICallOptions {
  /**
   * Gemini-only: when set, the request asks Gemini to emit schema-valid JSON via
   * `generationConfig.responseMimeType = "application/json"` +
   * `generationConfig.responseSchema`. This is a reliability boost only; callers
   * MUST still run the result through `parseStructuredReply` (defense in depth).
   */
  responseSchema?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Typed error hierarchy (F1)
// ---------------------------------------------------------------------------

/** Discriminated union returned by `parseGeminiError`. */
export type GeminiErrorKind = 'quota' | 'rate_limit' | 'auth' | 'other';

export interface ParsedGeminiError {
  kind: GeminiErrorKind;
  model: string;
  /** Seconds the caller should wait before retrying. 0 if unknown. */
  retryAfter: number;
  message: string;
  /** Raw status from Gemini (e.g. "RESOURCE_EXHAUSTED"). undefined if not a Gemini envelope. */
  status?: string;
  /** Raw HTTP status from the response. */
  httpStatus?: number;
}

/** Provider quota exhausted — usually free-tier limit reached. The user must switch model or upgrade. */
export class QuotaExhaustedError extends Error {
  readonly model: string;
  readonly retryAfter: number;
  constructor(model: string, retryAfter: number, message?: string) {
    super(message ?? `Model "${model}" quota exhausted. Retry in ${retryAfter}s or switch to a working model.`);
    this.name = 'QuotaExhaustedError';
    this.model = model;
    this.retryAfter = retryAfter;
  }
}

/** Provider rate limit hit, but the quota itself is OK. Caller should retry after `retryAfter` seconds. */
export class RateLimitError extends Error {
  readonly model: string;
  readonly retryAfter: number;
  constructor(model: string, retryAfter: number, message?: string) {
    super(message ?? `Model "${model}" rate-limited. Retry in ${retryAfter}s.`);
    this.name = 'RateLimitError';
    this.model = model;
    this.retryAfter = retryAfter;
  }
}

/** Auth failure — bad API key, expired token, etc. */
export class AuthError extends Error {
  readonly model: string;
  constructor(model: string, message?: string) {
    super(message ?? `Authentication failed for model "${model}". Check your API key.`);
    this.name = 'AuthError';
    this.model = model;
  }
}

/** Generic fallback for any unrecognised provider error. */
export class ProviderError extends Error {
  readonly model: string;
  readonly status: number;
  constructor(model: string, status: number, message: string) {
    super(`${model} provider error (${status}): ${message}`);
    this.name = 'ProviderError';
    this.model = model;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// AI diagnostics (G3, diagnosis 2026-06-05)
// ---------------------------------------------------------------------------

/**
 * Why a learning flow (Conversation / Writing / Exercise) did NOT use the
 * configured AI provider's answer and fell back to the local mock.
 *
 *   - `quota`           — provider quota exhausted (free-tier limit). The
 *                         single biggest cause of "AI won't load" reports.
 *   - `rate_limit`      — provider rate-limited; retry after N seconds.
 *   - `auth`            — bad / revoked API key.
 *   - `invalid_shape`   — provider replied 200 but the body didn't match the
 *                         expected JSON contract (parse / validation failed).
 *   - `not_configured`  — no provider set (provider==='none' or missing key/model).
 *   - `edge_unavailable`— the Supabase Edge fallback failed / isn't deployed.
 *   - `error`           — anything else (network, timeout, unknown).
 */
export type AIFallbackReason =
  | 'quota'
  | 'rate_limit'
  | 'auth'
  | 'invalid_shape'
  | 'not_configured'
  | 'edge_unavailable'
  | 'error';

export interface AIDiagnostic {
  reason: AIFallbackReason;
  /** Model that failed, when known. */
  model?: string;
  /** Seconds to wait before retrying (quota / rate_limit). 0/undefined if N/A. */
  retryAfter?: number;
  /** Human-readable detail for logs / UI. */
  message: string;
}

/**
 * Callback a learning flow invokes when it falls back instead of returning
 * the configured provider's answer. The whole point of G3: the flow keeps
 * degrading gracefully to the mock (so the Learner is never blocked), but it
 * NO LONGER does so silently — the UI can surface WHY (e.g. "gemini-2.0-flash
 * is quota-exhausted, switch to gemini-2.5-flash in Settings").
 */
export type AIDiagnosticHandler = (diagnostic: AIDiagnostic) => void;

/**
 * Map any error thrown by `callAIProvider` into a structured `AIDiagnostic`.
 * Reuses the F1 typed-error hierarchy so quota / rate-limit / auth are
 * distinguished from generic failures.
 */
export function classifyAIError(err: unknown): AIDiagnostic {
  if (err instanceof QuotaExhaustedError) {
    return { reason: 'quota', model: err.model, retryAfter: err.retryAfter, message: err.message };
  }
  if (err instanceof RateLimitError) {
    return { reason: 'rate_limit', model: err.model, retryAfter: err.retryAfter, message: err.message };
  }
  if (err instanceof AuthError) {
    return { reason: 'auth', model: err.model, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { reason: 'error', message };
}

/**
 * Parse a Gemini error response body into a discriminated union. The Gemini
 * envelope shape (per Google's AIP-193 / rpc error spec):
 *
 *   {
 *     "error": {
 *       "code": 429,                    // HTTP-style code
 *       "message": "...",               // human-readable
 *       "status": "RESOURCE_EXHAUSTED", // canonical status string
 *       "details": [...]                // optional, e.g. QuotaFailure
 *     }
 *   }
 *
 * Retry-after is extracted from the message text when present
 * ("Please retry in 44.7s" → ceil(44.7) = 45 seconds). If absent, defaults
 * to 0 (caller decides what to do).
 */
export function parseGeminiError(body: string, model: string, httpStatus?: number): ParsedGeminiError {
  const fallback: ParsedGeminiError = {
    kind: 'other',
    model,
    retryAfter: 0,
    message: body || '(empty error body)',
    httpStatus,
  };

  if (!body) return fallback;

  let parsed: { error?: { code?: number; message?: string; status?: string } };
  try {
    parsed = JSON.parse(body);
  } catch {
    // Body is not JSON — keep the raw text
    return { ...fallback, message: body.slice(0, 500) };
  }

  const err = parsed.error;
  if (!err || typeof err !== 'object') return fallback;

  const message = err.message || '';
  const status = err.status;
  const retryAfter = extractRetryAfter(message);

  // Quota exhaustion (free-tier limit, distinct from rate limit)
  if (status === 'RESOURCE_EXHAUSTED' || /quota/i.test(message)) {
    return { kind: 'quota', model, retryAfter, message, status, httpStatus: err.code ?? httpStatus };
  }

  // Rate limit (transient, not quota-related)
  if (status === 'RATE_LIMIT_EXCEEDED' || /rate.?limit/i.test(message)) {
    return { kind: 'rate_limit', model, retryAfter, message, status, httpStatus: err.code ?? httpStatus };
  }

  // Auth failures
  if (
    status === 'UNAUTHENTICATED' ||
    status === 'PERMISSION_DENIED' ||
    (err.code === 401 || err.code === 403)
  ) {
    return { kind: 'auth', model, retryAfter, message, status, httpStatus: err.code ?? httpStatus };
  }

  // Recognised envelope, unclassified status
  return { kind: 'other', model, retryAfter, message, status, httpStatus: err.code ?? httpStatus };
}

/** Extract "Please retry in Ns" from a Gemini error message. Returns 0 if absent. */
function extractRetryAfter(message: string): number {
  const m = /retry in\s+([\d.]+)\s*s/i.exec(message);
  if (!m || !m[1]) return 0;
  const seconds = parseFloat(m[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Default timeout for LLM provider requests (30 s). */
const FETCH_TIMEOUT_MS = 30_000;

class TimeoutError extends Error {
  constructor(provider: string, ms: number) {
    super(`${provider} request timed out after ${ms / 1000} s`);
    this.name = 'TimeoutError';
  }
}

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): ReturnType<typeof fetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;

  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer));
}

/**
 * Gemini-specific guarded fetch: parses the error envelope and throws a
 * typed error (QuotaExhaustedError / AuthError / RateLimitError / ProviderError)
 * so callers can `instanceof`-check and render actionable UI.
 *
 * Other providers use the generic `guardedFetch` below, which throws
 * `ProviderError` as a fallback.
 */
async function guardedFetchGemini(
  model: string,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchWithTimeout(input, init, timeoutMs);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new TimeoutError('Gemini', timeoutMs);
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.text();
    const parsed = parseGeminiError(body, model, res.status);
    switch (parsed.kind) {
      case 'quota':
        throw new QuotaExhaustedError(parsed.model, parsed.retryAfter, parsed.message);
      case 'rate_limit':
        throw new RateLimitError(parsed.model, parsed.retryAfter, parsed.message);
      case 'auth':
        throw new AuthError(parsed.model, parsed.message);
      case 'other':
      default:
        throw new ProviderError(parsed.model, res.status, parsed.message);
    }
  }

  return res;
}

async function guardedFetch(
  provider: string,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchWithTimeout(input, init, timeoutMs);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new TimeoutError(provider, timeoutMs);
    }
    throw err;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new ProviderError(provider, res.status, err);
  }

  return res;
}

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

async function callGemini(config: AIConfig, messages: ChatMessage[], options?: AICallOptions): Promise<string> {
  // Gemini uses a different message format — convert
  const systemInstruction = messages.find(m => m.role === 'system')?.content;
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = { contents };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  const generationConfig: Record<string, unknown> = { temperature: 0.7, maxOutputTokens: 2048 };
  // Gemini-only structured output (Change 3, BR-12). Additive: only set when a
  // schema is requested; the result is STILL run through parseStructuredReply.
  if (options?.responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = options.responseSchema;
  }
  body.generationConfig = generationConfig;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`;

  const res = await guardedFetchGemini(config.model, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

async function callOpenAI(config: AIConfig, messages: ChatMessage[]): Promise<string> {
  const res = await guardedFetch('OpenAI', 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenAI');
  return text;
}

async function callAnthropic(config: AIConfig, messages: ChatMessage[]): Promise<string> {
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const chatMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: 2048,
    messages: chatMessages,
  };
  if (systemMsg) {
    body.system = systemMsg;
  }

  const res = await guardedFetch('Anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Anthropic');
  return text;
}

async function callOllama(config: AIConfig, messages: ChatMessage[]): Promise<string> {
  const baseUrl = config.ollamaBaseUrl || 'http://localhost:11434';

  const res = await guardedFetch('Ollama', `${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
    }),
  });

  const data = await res.json();
  const text = data?.message?.content;
  if (!text) throw new Error('Empty response from Ollama');
  return text;
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Call the configured AI provider with a list of messages.
 * Throws if provider is 'none' or not configured.
 */
export async function callAIProvider(
  config: AIConfig,
  messages: ChatMessage[],
  options?: AICallOptions
): Promise<string> {
  switch (config.provider) {
    case 'gemini':
      return callGemini(config, messages, options);
    case 'openai':
      return callOpenAI(config, messages);
    case 'anthropic':
      return callAnthropic(config, messages);
    case 'ollama':
      return callOllama(config, messages);
    case 'none':
      throw new Error('No AI provider configured');
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

/**
 * Test the connection to the configured AI provider.
 * Returns a success message or throws on failure.
 */
export async function testAIConnection(config: AIConfig): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Reply with exactly: "Connection successful!"' },
  ];
  const reply = await callAIProvider(config, messages);
  return reply;
}

// ---------------------------------------------------------------------------
// Model probe (H6 fix)
// ---------------------------------------------------------------------------

/**
 * Per-model probe result. Returned by `probeGeminiModels` so the UI can
 * render an actionable model-swap hint with only the models that actually
 * have remaining quota.
 *
 *   - `ok: true,  reason: 'working'` — the model returned 200 OK
 *   - `ok: false, reason: 'quota'`   — 429 RESOURCE_EXHAUSTED
 *   - `ok: false, reason: 'auth'`    — 401/403 (likely the key is bad for
 *                                       ALL models — see runbook §8)
 *   - `ok: false, reason: 'rate_limit'` — 429 with non-quota limit hit
 *   - `ok: false, reason: 'error'`   — anything else (network, timeout,
 *                                       unknown shape); `detail` carries
 *                                       the truncated message for logs
 */
export interface ProbeResult {
  model: string;
  ok: boolean;
  reason: 'working' | 'quota' | 'auth' | 'rate_limit' | 'error';
  detail?: string;
}

/**
 * Probe multiple Gemini models in parallel to discover which ones are
 * quota-exhausted / auth-failed / working. Used by SettingsPage's Test
 * connection flow when the initial model returns QuotaExhaustedError
 * (H6, diagnosis 2026-06-05).
 *
 * Why this exists:
 *   The earlier F1 model-swap hint (SettingsPage.tsx) sliced the first 3
 *   models in PROVIDER_MODELS.gemini and showed them as suggestions, but
 *   it never checked if those models actually had remaining quota. With
 *   the user's real API key, 2 of the 3 suggested models were ALSO
 *   exhausted, so the hint misled the user into trying more broken
 *   models ("Vẫn không kết nối được" — diagnosis 2026-06-05).
 *
 * Behavior contract:
 *   - Sends ALL probes in parallel (no serial round-trips). Each probe
 *     uses a 10 s timeout — faster than the full 30 s we use for real
 *     calls, because we only need a yes/no.
 *   - NEVER throws. Every error path returns a ProbeResult with
 *     `ok: false` and an appropriate reason. The UI depends on this:
 *     if probeGeminiModels threw, the outer SettingsPage catch would have
 *     to deal with the probe error AS WELL AS the original QuotaExhaustedError.
 *   - Returns results in the SAME ORDER as the input model list. The UI
 *     uses this to map results back to PROVIDER_MODELS.gemini entries.
 */
export async function probeGeminiModels(
  apiKey: string,
  models: string[],
  perModelTimeoutMs: number = 10_000,
): Promise<ProbeResult[]> {
  if (models.length === 0) return [];

  const probes = models.map(async (model): Promise<ProbeResult> => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await guardedFetchGemini(
        model,
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          // Minimal payload — we just need a yes/no. maxOutputTokens=4 keeps
          // the response tiny and the round-trip fast. The model can reply
          // with anything; we don't even read the body.
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 4 },
          }),
        },
        perModelTimeoutMs,
      );
      void res; // success — we don't need the body
      return { model, ok: true, reason: 'working' };
    } catch (err: unknown) {
      if (err instanceof QuotaExhaustedError) {
        return { model, ok: false, reason: 'quota' };
      }
      if (err instanceof AuthError) {
        return { model, ok: false, reason: 'auth' };
      }
      if (err instanceof RateLimitError) {
        return { model, ok: false, reason: 'rate_limit' };
      }
      // Defensive: any other error (network, timeout, TypeError from
      // fetch, etc.) surfaces as reason:'error' with a short detail.
      // This is what keeps the UI renderable even when the probe
      // network itself is broken.
      const msg = err instanceof Error ? err.message : String(err);
      return { model, ok: false, reason: 'error', detail: msg.slice(0, 200) };
    }
  });

  return Promise.all(probes);
}

// ---------------------------------------------------------------------------
// Model lists per provider (for Settings UI)
// ---------------------------------------------------------------------------

export const PROVIDER_MODELS: Record<AIProvider, { value: string; label: string }[]> = {
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { value: 'o4-mini', label: 'o4-mini' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  ],
  ollama: [
    { value: 'llama3.1', label: 'Llama 3.1' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'gemma2', label: 'Gemma 2' },
    { value: 'qwen2.5', label: 'Qwen 2.5' },
    { value: 'phi3', label: 'Phi-3' },
  ],
  none: [],
};

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  ollama: 'Ollama (Self-hosted)',
  none: 'None (Mock Mode)',
};
