/**
 * AI Client — Pure REST calls to multiple LLM providers.
 * No SDK dependencies. Uses native fetch().
 *
 * Supported providers: Gemini, OpenAI, Anthropic, Ollama
 *
 * Every fetch() is wrapped with AbortController so a slow / hung backend
 * cannot leave the UI in an infinite-loading state.
 */

import { TimeoutError } from './timeout';

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
// Shared helpers
// ---------------------------------------------------------------------------

/** Default timeout for LLM provider requests (30 s). */
const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): ReturnType<typeof fetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;

  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer));
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
    throw new Error(`${provider} API error (${res.status}): ${err}`);
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

  const res = await guardedFetch('Gemini', url, {
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
// Streaming (Live v2 — pseudo-live conversation)
// ---------------------------------------------------------------------------

/** Called with each newly-arrived text delta during a streaming reply. */
export type StreamHandler = (delta: string) => void;

/**
 * Stream a Gemini reply token-by-token, invoking `onDelta` with each text
 * fragment as it arrives, and resolving with the full concatenated text.
 *
 * Gemini's streamGenerateContent with `alt=sse` returns Server-Sent Events;
 * each `data:` line is a partial GenerateContentResponse whose
 * candidates[0].content.parts[].text is the delta. We parse line-by-line off
 * the fetch body reader. Bounded by AbortController like the non-stream path.
 *
 * Only implemented for Gemini (the project's primary provider). Callers should
 * fall back to the non-streaming `callAIProvider` for other providers.
 */
export async function streamGemini(
  config: AIConfig,
  messages: ChatMessage[],
  onDelta: StreamHandler,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<string> {
  const systemInstruction = messages.find((m) => m.role === 'system')?.content;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?alt=sse`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new TimeoutError('Gemini (stream)', timeoutMs);
    }
    throw err;
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini stream error (${res.status}): ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const json = JSON.parse(payload);
      const parts = json?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          const text = p?.text;
          if (typeof text === 'string' && text.length > 0) {
            full += text;
            onDelta(text);
          }
        }
      }
    } catch {
      // Partial / non-JSON keepalive line — ignore.
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    if (buffer.length > 0) handleLine(buffer);
  } finally {
    clearTimeout(timer);
  }

  if (!full) throw new Error('Empty stream response from Gemini');
  return full;
}

/** True when the provider supports the streaming path (`streamGemini`). */
export function supportsStreaming(config: AIConfig): boolean {
  return config.provider === 'gemini' && !!config.apiKey && !!config.model;
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
