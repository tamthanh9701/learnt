/**
 * aiContentRegistry.ts — single client source for the static AI-content contract
 * pieces: per-content-type system prompts, the Gemini structured-output schema,
 * and the Edge Function slugs.
 *
 * PURE DATA. This module imports NOTHING app-specific (no services, no aiClient,
 * no supabase) so it can never introduce a circular dependency. Validators and
 * mock responders are deliberately NOT here — they stay with their owning
 * services and are wired into a `ContentGenerationSpec` at the call site.
 *
 * Drift note (be-design.md §9): the 3 Edge Functions keep their own twin
 * prompts/schemas this round (out of scope). This registry is the client
 * single-source; the Edge copies remain a documented drift risk.
 */

/**
 * Gemini-only structured-output schema (BR-12). Mirrors the
 * `{reply, feedback:{corrected_text, errors[], better_phrasing?}}` contract so a
 * Gemini call can emit schema-valid JSON directly. Reliability boost only — the
 * result is ALWAYS run through `parseStructuredReply` (defense in depth).
 *
 * Moved verbatim from conversationService.ts:42 (was a private const, never
 * exported — moving it here is internal-only, no consumer impact).
 */
export const FEEDBACK_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    feedback: {
      type: 'object',
      properties: {
        corrected_text: { type: 'string' },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string' },
              correction: { type: 'string' },
              explanation: { type: 'string' },
            },
            required: ['original', 'correction', 'explanation'],
          },
        },
        better_phrasing: { type: 'string' },
      },
      required: ['corrected_text', 'errors'],
    },
  },
  required: ['reply', 'feedback'],
};

/**
 * Per-content-type static contract: the Edge Function slug, the optional
 * Gemini-only response schema, and the system-prompt builder. Prompts are moved
 * VERBATIM from their original service call sites so the provider request shape
 * is byte-for-byte unchanged.
 */
export const CONTENT_CONTRACTS = {
  conversation: {
    edgeFunctionName: 'ai-conversation',
    responseSchema: FEEDBACK_RESPONSE_SCHEMA as Record<string, unknown> | undefined,
    // Moved verbatim from conversationService.ts:102 buildSystemPrompt.
    buildSystemPrompt: (topic: string): string =>
      `You are a friendly English conversation tutor helping a Vietnamese intermediate learner. The topic is "${topic}".

Respond with a SINGLE JSON object ONLY — no markdown, no code fences, no prose before or after it — with this exact shape:
{
  "reply": "your conversational response to the learner",
  "feedback": {
    "corrected_text": "the learner's last message rewritten in correct, natural English",
    "errors": [
      { "original": "the learner's exact phrase", "correction": "the corrected phrase", "explanation": "a short, encouraging explanation in simple English" }
    ],
    "better_phrasing": "an optional, more natural way to express the same idea"
  }
}

Rules:
- "reply" is REQUIRED, non-empty: keep it conversational, encouraging, intermediate level, 2-4 sentences, and ask a follow-up question to keep the conversation flowing.
- "feedback" corrects the LEARNER'S LAST message only (not your own reply).
- "corrected_text" is REQUIRED and non-empty: if the learner's message is already correct, repeat it unchanged.
- "errors" is REQUIRED and MUST be an array. If the learner made no mistakes, return an empty array []. Each item has "original", "correction", and "explanation".
- "better_phrasing" is OPTIONAL: include it only when a more natural alternative exists; otherwise omit it.`,
  },
  writing: {
    edgeFunctionName: 'ai-writing-feedback',
    // Writing never used a client-side Gemini schema.
    responseSchema: undefined as Record<string, unknown> | undefined,
    // Moved verbatim from writingService.ts:206 systemPrompt.
    buildSystemPrompt: (): string =>
      `You are an English writing tutor. Analyze the student's essay and return a JSON object (no markdown fences) with this exact structure:
{
  "overall_score": <number 0-100>,
  "strengths": [<string>, ...],
  "errors": [{"original": "<wrong text>", "corrected": "<correct text>", "explanation": "<why>"}],
  "suggestions": [<string>, ...],
  "revised_text": "<improved version of the essay>"
}
Be thorough but encouraging. Focus on grammar, spelling, vocabulary, and coherence.`,
  },
  exercise: {
    edgeFunctionName: 'ai-generate-exercises',
    responseSchema: undefined as Record<string, unknown> | undefined,
    // Moved verbatim from exerciseService.ts:115 systemPrompt.
    buildSystemPrompt: (topicId: string): string =>
      `You are an English language exercise generator. Generate exactly 3 exercises for the topic "${topicId}". Return a JSON array (no markdown fences) with this structure:
[
  {
    "id": "ex-ai-1",
    "type": "mcq",
    "prompt_en": "<question in English>",
    "prompt_vi": "<question in Vietnamese>",
    "options": ["<option1>", "<option2>", "<option3>", "<option4>"],
    "correct_option": "<correct option text>",
    "explanation_en": "<explanation in English>",
    "explanation_vi": "<explanation in Vietnamese>"
  },
  {
    "id": "ex-ai-2",
    "type": "cloze",
    "prompt_en": "Fill in the blank:",
    "prompt_vi": "Điền vào chỗ trống:",
    "sentence_with_blank": "<sentence with [blank]>",
    "correct_answer": "<answer>",
    "explanation_en": "<explanation>",
    "explanation_vi": "<explanation>"
  },
  {
    "id": "ex-ai-3",
    "type": "reorder",
    "prompt_en": "Reorder the words:",
    "prompt_vi": "Sắp xếp lại các từ:",
    "scrambled_words": ["word1", "word2", ...],
    "correct_sentence": "<correct sentence lowercase>",
    "explanation_en": "<explanation>",
    "explanation_vi": "<explanation>"
  }
]
Make exercises relevant, educational, and at intermediate English level.`,
  },
} as const;
