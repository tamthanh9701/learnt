import { describe, it, expect, beforeEach, vi } from 'vitest';

// CHARACTERIZATION (G2 ladder + G3 fence-strip) — exerciseService.
// Pins the CURRENT provider -> Edge -> mock transitions of fetchExercisesForTopic
// (exerciseService:112) AND the hand-rolled fence-strip + JSON.parse at
// exerciseService:156, BEFORE the client-only refactor.
//
// G2: control which tier wins by mocking callAIProvider (aiClient) +
//     supabase.functions.invoke. Assert ladder ORDER and which tier is returned.
// G3: the strip is exactly `raw.replace(/```json\n?/g,'').replace(/```\n?/g,'')
//     .trim()` then JSON.parse. It is DUMB (non-tolerant): prose around the JSON
//     makes JSON.parse throw -> caught -> falls to next tier. If the refactor
//     swaps in the tolerant balanced-brace extractor (parseStructuredReply),
//     the prose-wrapped case below would newly SUCCEED at the provider tier and
//     these tests go red. That is the trip-wire.
//
// Re-run: npx vitest run src/lib/__tests__/exerciseService.ladder.test.ts

// fetchExercisesForTopic only ever touches supabase.functions.invoke (Edge tier);
// it never calls supabase.from. We still stub `from` with a thenable chain proxy
// so the mock is structurally complete and future-proof.
const { mockInvoke, mockFrom } = vi.hoisted(() => {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onFulfilled);
      }
      return () => new Proxy({}, handler);
    },
  };
  return {
    mockInvoke: vi.fn(),
    mockFrom: vi.fn(() => new Proxy({}, handler)),
  };
});

vi.mock('../supabase', () => ({
  supabase: { functions: { invoke: mockInvoke }, from: mockFrom },
}));

vi.mock('../aiClient', () => ({ callAIProvider: vi.fn() }));

import { fetchExercisesForTopic, seedExercises } from '../exerciseService';
import { callAIProvider } from '../aiClient';

const mockProvider = vi.mocked(callAIProvider);
const aiConfig = { provider: 'gemini' as const, apiKey: 'k', model: 'gemini-2.5-flash' };

// A VALID 3-exercise list (mcq+cloze+reorder) that passes isValidExerciseList.
const VALID_EXERCISES = [
  {
    id: 'ex-ai-1', type: 'mcq', prompt_en: 'Pick one', prompt_vi: 'Chọn',
    options: ['a', 'b'], correct_option: 'a', explanation_en: 'x', explanation_vi: 'y',
  },
  {
    id: 'ex-ai-2', type: 'cloze', prompt_en: 'Fill', prompt_vi: 'Điền',
    sentence_with_blank: 'a [blank] b', correct_answer: 'c', explanation_en: 'x', explanation_vi: 'y',
  },
  {
    id: 'ex-ai-3', type: 'reorder', prompt_en: 'Reorder', prompt_vi: 'Sắp xếp',
    scrambled_words: ['a', 'b'], correct_sentence: 'a b', explanation_en: 'x', explanation_vi: 'y',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// G2 — ladder transitions
// ---------------------------------------------------------------------------

describe('exercise ladder: tier 1 provider [TC-EXLADDER]', () => {
  it('TC-EXLADDER-01 returns the provider exercises (clean JSON) and does NOT invoke Edge', async () => {
    mockProvider.mockResolvedValue(JSON.stringify(VALID_EXERCISES));

    const qs = await fetchExercisesForTopic('topic-technology', false, aiConfig);

    expect(qs).toEqual(VALID_EXERCISES);
    expect(mockProvider).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('TC-EXLADDER-02 strips a ```json fence around the provider array, then returns it', async () => {
    mockProvider.mockResolvedValue('```json\n' + JSON.stringify(VALID_EXERCISES) + '\n```');

    const qs = await fetchExercisesForTopic('topic-technology', false, aiConfig);

    expect(qs).toEqual(VALID_EXERCISES);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('exercise ladder: provider invalid/throws -> Edge [TC-EXLADDER]', () => {
  it('TC-EXLADDER-03 provider returns valid JSON of WRONG shape -> falls through to Edge', async () => {
    // Parses fine, but isValidExerciseList rejects (empty array) -> next tier.
    mockProvider.mockResolvedValue('[]');
    mockInvoke.mockResolvedValue({ data: { questions: VALID_EXERCISES }, error: null });

    const qs = await fetchExercisesForTopic('topic-technology', false, aiConfig);

    expect(qs).toEqual(VALID_EXERCISES);
    expect(mockProvider.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvoke.mock.invocationCallOrder[0],
    );
    expect(mockInvoke).toHaveBeenCalledWith('ai-generate-exercises', expect.anything());
  });

  it('TC-EXLADDER-04 provider reply is PROSE-WRAPPED JSON -> JSON.parse throws (dumb strip) -> Edge', async () => {
    // TRIP-WIRE for G3: the dumb strip does NOT extract the embedded array, so
    // JSON.parse throws on the surrounding prose and we fall to Edge. A tolerant
    // balanced-brace extractor would parse it at the provider tier and break this.
    mockProvider.mockResolvedValue('Here are your exercises: ' + JSON.stringify(VALID_EXERCISES) + ' Enjoy!');
    mockInvoke.mockResolvedValue({ data: { questions: VALID_EXERCISES }, error: null });

    const qs = await fetchExercisesForTopic('topic-technology', false, aiConfig);

    expect(qs).toEqual(VALID_EXERCISES);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('TC-EXLADDER-05 provider throws -> Edge invoked', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));
    mockInvoke.mockResolvedValue({ data: { questions: VALID_EXERCISES }, error: null });

    const qs = await fetchExercisesForTopic('topic-technology', false, aiConfig);

    expect(qs).toEqual(VALID_EXERCISES);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe('exercise ladder: Edge invalid/throws -> mock [TC-EXLADDER]', () => {
  it('TC-EXLADDER-06 provider throws + Edge returns invalid shape -> seed/mock for known topic', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));
    mockInvoke.mockResolvedValue({ data: { questions: 'not-an-array' }, error: null });

    const qs = await fetchExercisesForTopic('topic-technology', false, aiConfig);

    expect(qs).toEqual(seedExercises['topic-technology']);
  });

  it('TC-EXLADDER-07 provider throws + Edge throws -> generateMockExercises (unknown topic generic set)', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));
    mockInvoke.mockRejectedValue(new Error('edge down'));

    const qs = await fetchExercisesForTopic('topic-unknown-zzz', false, aiConfig);

    expect(qs.length).toBe(3);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe('exercise ladder: isMock gates ONLY the Edge step [TC-EXLADDER]', () => {
  it('TC-EXLADDER-08 isMock=true + provider throws -> mock directly, Edge never invoked', async () => {
    mockProvider.mockRejectedValue(new Error('provider down'));

    const qs = await fetchExercisesForTopic('topic-technology', true, aiConfig);

    expect(qs).toEqual(seedExercises['topic-technology']);
    expect(mockProvider).toHaveBeenCalledTimes(1); // provider step ALWAYS runs
    expect(mockInvoke).not.toHaveBeenCalled(); // Edge gated out
  });

  it('TC-EXLADDER-09 no aiConfig -> provider guard short-circuits; isMock=true returns mock without Edge', async () => {
    const qs = await fetchExercisesForTopic('topic-business', true);

    expect(qs).toEqual(seedExercises['topic-business']);
    expect(mockProvider).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// G3 — hand-rolled fence-strip semantics (exerciseService:156), pinned via the
// provider tier (parseProviderReply). Malformed JSON must FALL THROUGH, never throw out.
// ---------------------------------------------------------------------------

describe('exercise fence-strip semantics [TC-EXSTRIP]', () => {
  it('TC-EXSTRIP-01 malformed JSON in provider reply does NOT throw out; falls to Edge', async () => {
    mockProvider.mockResolvedValue('{ this is : not valid json ]');
    mockInvoke.mockResolvedValue({ data: { questions: VALID_EXERCISES }, error: null });

    const qs = await fetchExercisesForTopic('topic-technology', false, aiConfig);
    expect(qs).toEqual(VALID_EXERCISES);
  });

  it('TC-EXSTRIP-02 bare ``` fence (no json tag) is also stripped before parse', async () => {
    mockProvider.mockResolvedValue('```\n' + JSON.stringify(VALID_EXERCISES) + '\n```');

    const qs = await fetchExercisesForTopic('topic-technology', false, aiConfig);
    expect(qs).toEqual(VALID_EXERCISES);
  });
});
