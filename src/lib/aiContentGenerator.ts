/**
 * aiContentGenerator.ts — the ONE 3-tier AI-content fallback ladder
 * (provider -> Edge Function -> mock), owned in a single generic deep module.
 *
 * Before this module, conversationService / writingService / exerciseService each
 * hand-rolled the same ladder: the `provider !== 'none' && apiKey && model` guard,
 * the try/catch + `console.warn` fallback, the Edge `functions.invoke`, and the
 * last-resort mock. Three copies of one mechanism. This module owns that mechanism
 * exactly once; each service supplies a typed `ContentGenerationSpec` recipe.
 *
 * Invariants preserved byte-for-byte from the three originals:
 *   - The PROVIDER step ALWAYS runs (subject only to the config guard),
 *     regardless of `isMock`.
 *   - `isMock` gates ONLY the Edge step.
 *   - The mock is ALWAYS the last resort.
 *   - A provider/Edge parse that returns `undefined` falls through to the next
 *     tier; a thrown error is caught and also falls through.
 *
 * Imports only `aiClient` + `supabase` + types — no service imports — so it sits
 * below the services in the dependency graph (no circular dependency).
 */

import { supabase } from './supabase';
import { callAIProvider } from './aiClient';
import type { AIConfig, ChatMessage } from './aiClient';

/** Per-content-type recipe for the 3-tier ladder. Generic over runtime input + output. */
export interface ContentGenerationSpec<TInput, TOutput> {
  /** Short label used in the fallback warn logs (e.g. 'conversation'). */
  label: string;
  /** Provider chat messages (system + user/history). */
  buildMessages: (input: TInput) => ChatMessage[];
  /** Gemini-only structured-output schema (optional). */
  responseSchema?: Record<string, unknown>;
  /** Parse the provider's raw reply. `undefined` => fall through to the Edge step. */
  parseProviderReply: (raw: string) => TOutput | undefined;
  /** Edge Function slug, e.g. 'ai-conversation'. */
  edgeFunctionName: string;
  /** Build the Edge request body from the runtime input. */
  buildEdgeBody: (input: TInput) => Record<string, unknown>;
  /** Parse the Edge response `data`. `undefined` => fall through to the mock. */
  parseEdgeData: (data: unknown) => TOutput | undefined;
  /** Last-resort local responder (may be async — see conversation's 150ms delay). */
  mock: (input: TInput) => TOutput | Promise<TOutput>;
}

export interface GenerationContext {
  isMock: boolean;
  aiConfig?: AIConfig;
}

/**
 * Run the 3-tier ladder for one content-generation request.
 *
 * 1. PROVIDER (always attempted when the config guard passes)
 * 2. EDGE     (only when `!isMock`)
 * 3. MOCK     (last resort)
 */
export async function generateStructuredContent<TInput, TOutput>(
  spec: ContentGenerationSpec<TInput, TOutput>,
  input: TInput,
  ctx: GenerationContext,
): Promise<TOutput> {
  const { isMock, aiConfig } = ctx;

  // 1. Real provider (if configured). ALWAYS attempted regardless of isMock.
  if (aiConfig && aiConfig.provider !== 'none' && aiConfig.apiKey && aiConfig.model) {
    try {
      const callOptions =
        aiConfig.provider === 'gemini' && spec.responseSchema
          ? { responseSchema: spec.responseSchema }
          : undefined;
      const raw = await callAIProvider(aiConfig, spec.buildMessages(input), callOptions);
      const out = spec.parseProviderReply(raw);
      if (out !== undefined) return out;
      console.warn(`${spec.label}: AI provider returned invalid shape, falling back.`);
    } catch (err) {
      console.warn(`${spec.label}: AI provider call failed, falling back:`, err);
    }
  }

  // 2. Edge Function (cloud only — gated by isMock).
  if (!isMock) {
    try {
      const { data, error } = await supabase.functions.invoke(spec.edgeFunctionName, {
        body: spec.buildEdgeBody(input),
      });
      if (error) throw error;
      const out = spec.parseEdgeData(data);
      if (out !== undefined) return out;
      console.warn(`${spec.label}: Edge function returned invalid shape, falling back.`);
    } catch (err) {
      console.warn(`${spec.label}: Edge function failed/not deployed, falling back:`, err);
    }
  }

  // 3. Mock (last resort).
  return await spec.mock(input);
}

/**
 * Shared loose-JSON parse for the writing/exercise provider tier — a BYTE-FOR-BYTE
 * lift of the ad-hoc fence-strip those services used inline
 * (writingService:224 / exerciseService:156):
 *
 *   raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()  then  JSON.parse
 *
 * It is DELIBERATELY DUMB / non-tolerant: it removes ONLY the fence markers, never
 * surrounding prose, and `JSON.parse` THROWS on anything that is not clean JSON.
 * It must NOT adopt aiFeedback's tolerant balanced-brace extractor — doing so would
 * make prose-wrapped JSON newly succeed where it currently throws→falls to the next
 * tier (a behavior change; QA fence-strip trip-wires go red). Throws on bad JSON,
 * exactly like today; the caller (`parseProviderReply`) lets it bubble so the
 * ladder's try/catch falls through.
 */
export function stripFencesAndParse(raw: string): unknown {
  const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(jsonStr);
}
