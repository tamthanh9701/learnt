export const CONVERSATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    feedback: {
      type: "object",
      properties: {
        corrected_text: { type: "string" },
        errors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              original: { type: "string" },
              correction: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["original", "correction", "explanation"],
          },
        },
        better_phrasing: { type: "string" },
      },
      required: ["corrected_text", "errors"],
    },
  },
  required: ["reply", "feedback"],
} as const;

export function buildConversationSystemPrompt(topic: string): string {
  return `You are a friendly English conversation tutor helping a Vietnamese intermediate learner. The topic is "${topic}".

Respond with a SINGLE JSON object ONLY - no markdown, no code fences, no prose before or after it - with this exact shape:
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
- "better_phrasing" is OPTIONAL: include it only when a more natural alternative exists; otherwise omit it.`;
}

export const WRITING_FEEDBACK_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overall_score: { type: "number" },
    strengths: { type: "array", items: { type: "string" } },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          corrected: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["original", "corrected", "explanation"],
      },
    },
    suggestions: { type: "array", items: { type: "string" } },
    revised_text: { type: "string" },
  },
  required: ["overall_score", "strengths", "errors", "suggestions", "revised_text"],
} as const;

export function buildWritingFeedbackSystemPrompt(): string {
  return `You are an English writing tutor. Analyze the student's essay and return a JSON object (no markdown fences) with this exact structure:
{
  "overall_score": <number 0-100>,
  "strengths": [<string>, ...],
  "errors": [{"original": "<wrong text>", "corrected": "<correct text>", "explanation": "<why>"}],
  "suggestions": [<string>, ...],
  "revised_text": "<improved version of the essay>"
}
Be thorough but encouraging. Focus on grammar, spelling, vocabulary, and coherence.`;
}

export const EXERCISE_GENERATION_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["mcq", "cloze", "reorder"] },
      prompt_en: { type: "string" },
      prompt_vi: { type: "string" },
      options: { type: "array", items: { type: "string" } },
      correct_option: { type: "string" },
      sentence_with_blank: { type: "string" },
      correct_answer: { type: "string" },
      scrambled_words: { type: "array", items: { type: "string" } },
      correct_sentence: { type: "string" },
      explanation_en: { type: "string" },
      explanation_vi: { type: "string" },
    },
    required: ["id", "type", "prompt_en", "prompt_vi", "explanation_en", "explanation_vi"],
  },
  minItems: 3,
  maxItems: 3,
} as const;

export function buildExerciseGenerationSystemPrompt(topicId: string): string {
  return `You are an English language exercise generator. Generate exactly 3 exercises for the topic "${topicId}". Return a JSON array (no markdown fences) with this structure:
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
Make exercises relevant, educational, and at intermediate English level.`;
}
