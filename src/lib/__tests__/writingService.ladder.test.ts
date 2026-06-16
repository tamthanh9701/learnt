import { describe, it, expect, beforeEach, vi } from 'vitest';

// CHARACTERIZATION (G2 ladder + G3 fence-strip) — writingService.
// Pins, BEFORE the client-only refactor:
//   G2 — submitWritingContent's 3-tier ladder (provider -> Edge -> mock) at
//        writingService:204-258, including the `feedbackGenerated` gate, the
//        provider!=='none' && apiKey && model guard, and "isMock gates ONLY the
//        Edge step".
//   G3 — the hand-rolled fence-strip at writingService:224
//        (`reply.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()` then
//        JSON.parse). This is DUMB / non-tolerant: it removes ONLY the fence
//        markers, never surrounding prose, and JSON.parse throws on anything
//        that isn't clean JSON. If the refactor swaps in aiFeedback's tolerant
//        balanced-brace extractor (parseStructuredReply), the prose-wrapped
//        cases below flip from "fall to mock" to "accepted" and go RED.
//
// Seams mocked: callAIProvider (aiClient) controls tier-1; supabase.functions
// .invoke controls tier-2; supabase.from is a thenable proxy so the isMock=false
// persistence path runs without a real backend (the returned ai_feedback is
// preserved through the persistence fallback either way).
//
// Re-run: npx vitest run src/lib/__tests__/writingService.ladder.test.ts

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

import { submitWritingContent, analyzeGrammarMock } from '../writingService';
import { callAIProvider } from '../aiClient';

const mockProvider = vi.mocked(callAIProvider);

const aiConfig = { provider: 'gemini' as const, apiKey: 'k', model: 'gemini-2.5-flash' };
const userId = 'learner-write-ladder';
const PROMPT = 'Technology in Education';
const CONTENT = 'I believe smartphones can help students learn responsibly.';

const providerFeedback = {
  overall_score: 77,
  strengths: ['s'],
  errors: [],
  suggestions: ['x'],
  revised_text: 'PROVIDER',
};
const edgeFeedback = {
  overall_score: 55,
  strengths: ['e'],
  errors: [],
  suggestions: ['y'],
  revised_text: 'EDGE',
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setChainResult({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// G2 — fallback ladder transitions
// ---------------------------------------------------------------------------

describe('writing ladder: tier transitions [TC-WRITELADDER]', () => {
  it('TC-WRITELADDER-01 provider-valid wins; Edge is NOT invoked', async () => {
    mockProvider.mockResolvedValue(JSON.stringify(providerFeedback));

    const sub = await submitWritingContent(userId, PROMPT, CONTENT, false, aiConfig);

    expect(sub.ai_feedback.revised_text).toBe('PROVIDER');
    expect(sub.ai_feedback.overall_score).toBe(77);
    expect(mockProvider).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('TC-WRITELADDER-02 provider returns valid JSON but WRONG shape -> falls to Edge (order preserved)', async () => {
    mockProvider.mockResolvedValue(JSON.stringify({ not: 'a feedback' }));
    mockInvoke.mockResolvedValue({ data: { feedback: edgeFeedback }, error: null });

    const sub = await submitWritingContent(userId, PROMPT, CONTENT, false, aiConfig);

    expect(sub.ai_feedback.revised_text).toBe('EDGE');
    expect(mockProvider.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvoke.mock.invocationCallOrder[0],
    );
    expect(mockInvoke).toHaveBeenCalledWith('ai-writing-feedback', expect.anything());
  });

  it('TC-WRITELADDER-03 provider throws -> Edge invoked and its feedback returned', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));
    mockInvoke.mockResolvedValue({ data: { feedback: edgeFeedback }, error: null });

    const sub = await submitWritingContent(userId, PROMPT, CONTENT, false, aiConfig);

    expect(sub.ai_feedback.revised_text).toBe('EDGE');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('TC-WRITELADDER-04 provider invalid + Edge invalid shape -> local mock', async () => {
    mockProvider.mockResolvedValue(JSON.stringify({ bad: true }));
    mockInvoke.mockResolvedValue({ data: { feedback: { wrong: 'shape' } }, error: null });

    const sub = await submitWritingContent(userId, PROMPT, CONTENT, false, aiConfig);

    const expected = analyzeGrammarMock(CONTENT);
    expect(sub.ai_feedback.revised_text).toBe(expected.revised_text);
    expect(sub.ai_feedback.revised_text).not.toBe('PROVIDER');
    expect(sub.ai_feedback.revised_text).not.toBe('EDGE');
  });

  it('TC-WRITELADDER-05 isMock=true gates ONLY the Edge step: provider throw -> straight to mock', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));

    const sub = await submitWritingContent(userId, PROMPT, CONTENT, true, aiConfig);

    const expected = analyzeGrammarMock(CONTENT);
    expect(sub.ai_feedback.revised_text).toBe(expected.revised_text);
    expect(mockProvider).toHaveBeenCalledTimes(1); // provider step ALWAYS runs
    expect(mockInvoke).not.toHaveBeenCalled(); // Edge gated out by isMock
  });

  it('TC-WRITELADDER-06 guard short-circuit: no aiConfig -> provider skipped, Edge invoked', async () => {
    mockInvoke.mockResolvedValue({ data: { feedback: edgeFeedback }, error: null });

    const sub = await submitWritingContent(userId, PROMPT, CONTENT, false);

    expect(sub.ai_feedback.revised_text).toBe('EDGE');
    expect(mockProvider).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('TC-WRITELADDER-07 incomplete config (provider set, model empty) -> provider skipped', async () => {
    mockInvoke.mockResolvedValue({ data: { feedback: edgeFeedback }, error: null });

    const sub = await submitWritingContent(userId, PROMPT, CONTENT, false, {
      provider: 'gemini',
      apiKey: 'k',
      model: '',
    });

    expect(sub.ai_feedback.revised_text).toBe('EDGE');
    expect(mockProvider).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// G3 — hand-rolled fence-strip semantics (isMock=true isolates the provider
// tier: provider-reject falls straight to mock, no Edge in the way).
// ---------------------------------------------------------------------------

describe('writing fence-strip: CURRENT (dumb, non-tolerant) semantics [TC-WRITEFENCE]', () => {
  const usesProvider = (revised: string) => revised === 'PROVIDER';

  it('TC-WRITEFENCE-01 ```json fenced valid feedback -> fence stripped -> accepted', async () => {
    mockProvider.mockResolvedValue('```json\n' + JSON.stringify(providerFeedback) + '\n```');
    const sub = await submitWritingContent(userId, PROMPT, CONTENT, true, aiConfig);
    expect(usesProvider(sub.ai_feedback.revised_text)).toBe(true);
  });

  it('TC-WRITEFENCE-02 bare ``` fenced valid feedback -> fence stripped -> accepted', async () => {
    mockProvider.mockResolvedValue('```\n' + JSON.stringify(providerFeedback) + '\n```');
    const sub = await submitWritingContent(userId, PROMPT, CONTENT, true, aiConfig);
    expect(usesProvider(sub.ai_feedback.revised_text)).toBe(true);
  });

  it('TC-WRITEFENCE-03 already-clean JSON (no fences) -> accepted', async () => {
    mockProvider.mockResolvedValue(JSON.stringify(providerFeedback));
    const sub = await submitWritingContent(userId, PROMPT, CONTENT, true, aiConfig);
    expect(usesProvider(sub.ai_feedback.revised_text)).toBe(true);
  });

  it('TC-WRITEFENCE-04 prose-wrapped JSON, NO fences -> JSON.parse throws -> falls to mock (NOT tolerant-extracted)', async () => {
    mockProvider.mockResolvedValue('Here is your feedback: ' + JSON.stringify(providerFeedback));
    const sub = await submitWritingContent(userId, PROMPT, CONTENT, true, aiConfig);
    // The dumb strip does NOT extract the embedded object -> mock is used.
    expect(usesProvider(sub.ai_feedback.revised_text)).toBe(false);
    expect(sub.ai_feedback.revised_text).toBe(analyzeGrammarMock(CONTENT).revised_text);
  });

  it('TC-WRITEFENCE-05 fenced JSON WITH surrounding prose -> strip leaves prose -> parse throws -> mock', async () => {
    mockProvider.mockResolvedValue(
      'Sure!\n```json\n' + JSON.stringify(providerFeedback) + '\n```\nHope this helps.',
    );
    const sub = await submitWritingContent(userId, PROMPT, CONTENT, true, aiConfig);
    expect(usesProvider(sub.ai_feedback.revised_text)).toBe(false);
  });

  it('TC-WRITEFENCE-06 malformed JSON -> parse throws -> mock', async () => {
    mockProvider.mockResolvedValue('{ "overall_score": 77, ');
    const sub = await submitWritingContent(userId, PROMPT, CONTENT, true, aiConfig);
    expect(usesProvider(sub.ai_feedback.revised_text)).toBe(false);
  });
});
