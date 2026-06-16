import { describe, it, expect, beforeEach, vi } from 'vitest';

// CHARACTERIZATION (G2 — 3-tier fallback ladder) — conversationService.
// Pins the CURRENT provider -> Edge -> mock transitions of generateReply
// (conversationService:130) BEFORE the client-only refactor collapses the three
// hand-rolled ladders into one generateStructuredContent helper. These tests
// control which tier succeeds/fails by mocking callAIProvider (aiClient) and
// supabase.functions.invoke, then assert the ladder ORDER and which tier's
// output is returned.
//
// Conversation note: parseProviderReply == parseStructuredReply, which NEVER
// returns undefined (it always yields a {reply}). So a provider call that does
// not THROW always wins — the only way to fall through to Edge is a provider
// throw. That asymmetry vs writing/exercise is itself pinned here.
//
// Re-run: npx vitest run src/lib/__tests__/conversationService.ladder.test.ts

const { mockInvoke, mockFrom, setChainResult } = vi.hoisted(() => {
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve(result).then(onFulfilled);
      }
      return () => new Proxy({}, handler);
    },
  };
  const chain = new Proxy({}, handler);
  return {
    mockInvoke: vi.fn(),
    mockFrom: vi.fn(() => chain),
    setChainResult: (r: { data: unknown; error: unknown }) => {
      result = r;
    },
  };
});

vi.mock('../supabase', () => ({
  supabase: { functions: { invoke: mockInvoke }, from: mockFrom },
}));

vi.mock('../aiClient', () => ({ callAIProvider: vi.fn() }));

import { sendConversationTurn } from '../conversationService';
import { callAIProvider } from '../aiClient';

const mockProvider = vi.mocked(callAIProvider);

const aiConfig = { provider: 'gemini' as const, apiKey: 'k', model: 'gemini-2.5-flash' };
const userId = 'learner-ladder';
const ts = () => new Date().toISOString();

// A provider reply carrying a complete structured payload — parseStructuredReply
// yields { reply: 'PROVIDER_REPLY', feedback: {...} }.
const PROVIDER_JSON = JSON.stringify({
  reply: 'PROVIDER_REPLY',
  feedback: { corrected_text: 'ok', errors: [] },
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setChainResult({ data: null, error: null });
});

describe('conversation ladder: tier 1 provider [TC-CONVLADDER]', () => {
  it('TC-CONVLADDER-01 uses the provider when config is complete; Edge is NOT invoked', async () => {
    mockProvider.mockResolvedValue(PROVIDER_JSON);

    const reply = await sendConversationTurn({
      userId,
      topic: 'Technology',
      history: [{ role: 'user', content: 'hi there', timestamp: ts() }],
      isMock: false,
      aiConfig,
    });

    expect(reply).toBe('PROVIDER_REPLY');
    expect(mockProvider).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('conversation ladder: tier 1 -> tier 2 (provider throws -> Edge) [TC-CONVLADDER]', () => {
  it('TC-CONVLADDER-02 falls through to the Edge function when the provider throws, and returns the Edge reply', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));
    mockInvoke.mockResolvedValue({ data: { reply: 'EDGE_REPLY' }, error: null });

    const reply = await sendConversationTurn({
      userId,
      topic: 'Technology',
      history: [{ role: 'user', content: 'something', timestamp: ts() }],
      isMock: false,
      aiConfig,
    });

    expect(reply).toBe('EDGE_REPLY');
    // ORDER: provider attempted strictly before Edge.
    expect(mockProvider.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvoke.mock.invocationCallOrder[0],
    );
    expect(mockInvoke).toHaveBeenCalledWith('ai-conversation', expect.anything());
  });
});

describe('conversation ladder: tier 2 -> tier 3 (Edge fails -> mock) [TC-CONVLADDER]', () => {
  it('TC-CONVLADDER-03 falls through to the local mock when the provider throws and the Edge invoke throws', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));
    mockInvoke.mockRejectedValue(new Error('edge down'));

    const reply = await sendConversationTurn({
      userId,
      topic: 'Technology',
      history: [{ role: 'user', content: 'hello', timestamp: ts() }],
      isMock: false,
      aiConfig,
    });

    // 'hello' steers getMockAIResponse to the deterministic greeting.
    expect(reply.startsWith('Hello! I am your AI Speaking Partner')).toBe(true);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('TC-CONVLADDER-04 falls through to the mock when the Edge returns data WITHOUT a reply field', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));
    mockInvoke.mockResolvedValue({ data: { somethingElse: true }, error: null });

    const reply = await sendConversationTurn({
      userId,
      topic: 'Technology',
      history: [{ role: 'user', content: 'hello', timestamp: ts() }],
      isMock: false,
      aiConfig,
    });

    expect(reply.startsWith('Hello! I am your AI Speaking Partner')).toBe(true);
  });
});

describe('conversation ladder: isMock gates ONLY the Edge step [TC-CONVLADDER]', () => {
  it('TC-CONVLADDER-05 with isMock=true, a provider throw skips Edge entirely and goes straight to mock', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));

    const reply = await sendConversationTurn({
      userId,
      topic: 'Technology',
      history: [{ role: 'user', content: 'hello', timestamp: ts() }],
      isMock: true,
      aiConfig,
    });

    expect(reply.startsWith('Hello! I am your AI Speaking Partner')).toBe(true);
    expect(mockProvider).toHaveBeenCalledTimes(1); // provider step ALWAYS runs
    expect(mockInvoke).not.toHaveBeenCalled(); // Edge step gated out by isMock
  });
});

describe('conversation ladder: provider guard short-circuit [TC-CONVLADDER]', () => {
  it('TC-CONVLADDER-06 skips the provider when no aiConfig is supplied and goes to the Edge step', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'EDGE_REPLY' }, error: null });

    const reply = await sendConversationTurn({
      userId,
      topic: 'Technology',
      history: [{ role: 'user', content: 'something', timestamp: ts() }],
      isMock: false,
      // no aiConfig
    });

    expect(reply).toBe('EDGE_REPLY');
    expect(mockProvider).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
