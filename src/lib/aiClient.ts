/**
 * AI Client — Pure REST calls to multiple LLM providers.
 * No SDK dependencies. Uses native fetch().
 *
 * Supported providers: Gemini, OpenAI, Anthropic, Ollama
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

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

async function callGemini(config: AIConfig, messages: ChatMessage[]): Promise<string> {
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
  body.generationConfig = { temperature: 0.7, maxOutputTokens: 2048 };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

async function callOpenAI(config: AIConfig, messages: ChatMessage[]): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${err}`);
  }

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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Anthropic');
  return text;
}

async function callOllama(config: AIConfig, messages: ChatMessage[]): Promise<string> {
  const baseUrl = config.ollamaBaseUrl || 'http://localhost:11434';

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama API error (${res.status}): ${err}`);
  }

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
  messages: ChatMessage[]
): Promise<string> {
  switch (config.provider) {
    case 'gemini':
      return callGemini(config, messages);
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
// Model lists per provider (for Settings UI)
// ---------------------------------------------------------------------------

export const PROVIDER_MODELS: Record<AIProvider, { value: string; label: string }[]> = {
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
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
