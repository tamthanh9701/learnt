/**
 * conversationService.ts — the AI Conversation reply use-case (one interface).
 *
 * A single entry, `sendConversationTurn`, owns the whole turn:
 *   1. generate a reply (provider -> ai-conversation Edge Function -> mock)
 *   2. attach structured feedback to the Learner's just-sent turn (when complete)
 *   3. persist the updated session (via conversationRepository)
 *   4. record the Speaking activity (speaking_minutes + Streak)
 *   5. stream the reply sentence-by-sentence to `onSentence` (for TTS)
 *
 * EVERY turn behaves the same way: persisted, fed back when possible, and (if the
 * caller passes `onSentence`) spoken sentence-by-sentence. There is no longer a
 * second "streaming path" with weaker guarantees — streaming is just an option
 * on this one interface (the reply is segmented through `sentenceStreamer` once
 * the full reply is known; see PRD note on JSON-vs-plain-text).
 *
 * The provider/Edge/mock generation, the structured-output schema, and the mock
 * responder are implementation details of this module — callers never see them.
 */

import { supabase } from './supabase';
import { callAIProvider } from './aiClient';
import type { AIConfig, ChatMessage as AIChatMessage } from './aiClient';
import { parseStructuredReply } from './aiFeedback';
import type { StructuredFeedback } from './aiFeedback';
import { createSentenceStreamer } from './sentenceStreamer';
import {
  saveConversationTurn,
} from './conversationRepository';
import type { ChatMessage } from './conversationRepository';
import { recordSpeakingActivity } from './speakingActivityRecorder';

export type { ChatMessage, ConversationSession } from './conversationRepository';
export { loadConversationSessions as fetchSpeakingSessionsHistory } from './conversationRepository';

/**
 * Gemini-only structured-output schema (BR-12). Mirrors the
 * `{reply, feedback:{corrected_text, errors[], better_phrasing?}}` contract so a
 * Gemini call can emit schema-valid JSON directly. Reliability boost only — the
 * result is ALWAYS run through `parseStructuredReply` (defense in depth).
 */
const FEEDBACK_RESPONSE_SCHEMA: Record<string, unknown> = {
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

/** Local AI dialog responder — last-resort fallback when no provider/Edge works. */
const getMockAIResponse = (topic: string, history: ChatMessage[]): string => {
  const userText = history[history.length - 1]?.content.toLowerCase() || '';

  if (userText.includes('hello') || userText.includes('hi') || userText.includes('hey')) {
    return `Hello! I am your AI Speaking Partner. I am happy to practice English conversation with you today. What would you like to discuss regarding "${topic}"?`;
  }

  if (topic.toLowerCase().includes('technology') || topic.toLowerCase().includes('ai')) {
    if (userText.includes('future') || userText.includes('will')) {
      return "That's a fascinating point. Technology will certainly automate many routine jobs, but it could also create new creative roles. Do you think we need special regulations for AI development?";
    }
    if (userText.includes('like') || userText.includes('good') || userText.includes('use')) {
      return "Absolutely! Technology makes our daily life very efficient. For example, using spaced repetition apps helps us learn faster. What is your favorite tech tool that you use every day?";
    }
    return "Technology is evolving so rapidly. AI systems can now write essays, write code, and hold spoken conversations. How do you think this will change schools and colleges in the future?";
  }

  if (topic.toLowerCase().includes('education') || topic.toLowerCase().includes('school')) {
    if (userText.includes('teacher') || userText.includes('class')) {
      return "Teachers play an invaluable role in mentoring students beyond just academic knowledge. Do you remember a teacher who inspired you a lot during your childhood?";
    }
    return "Education systems are shifting towards online platforms and personalized learning pathways. Do you prefer traditional classroom study, or do you find studying independently online more effective?";
  }

  if (userText.includes('because') || userText.includes('reason')) {
    return "I see! That explanation makes perfect sense. Can you give me a specific example from your own experience that illustrates this?";
  }

  return "That is interesting! Could you expand a bit more on that thought? How does that affect your daily life or career goals?";
};

const buildSystemPrompt = (topic: string): string =>
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
- "better_phrasing" is OPTIONAL: include it only when a more natural alternative exists; otherwise omit it.`;

interface GenerateResult {
  reply: string;
  feedback?: StructuredFeedback;
}

/** Generate a reply: provider -> Edge Function -> mock. Internal. */
const generateReply = async (
  topic: string,
  history: ChatMessage[],
  isMock: boolean,
  aiConfig?: AIConfig,
): Promise<GenerateResult> => {
  // 1. Real provider (if configured).
  if (aiConfig && aiConfig.provider !== 'none' && aiConfig.apiKey && aiConfig.model) {
    try {
      const messages: AIChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(topic) },
        ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];
      const callOptions =
        aiConfig.provider === 'gemini' ? { responseSchema: FEEDBACK_RESPONSE_SCHEMA } : undefined;
      const raw = await callAIProvider(aiConfig, messages, callOptions);
      const parsed = parseStructuredReply(raw);
      return { reply: parsed.reply, feedback: parsed.feedback };
    } catch (err) {
      console.warn('AI provider call failed, falling back:', err);
    }
  }

  // 2. Edge Function (cloud only).
  if (!isMock) {
    try {
      const { data, error } = await supabase.functions.invoke('ai-conversation', {
        body: { topic, history },
      });
      if (error) throw error;
      if (data?.reply) return { reply: data.reply };
    } catch (err) {
      console.warn('ai-conversation Edge function failed/not deployed, falling back:', err);
    }
  }

  // 3. Mock (last resort). Small cosmetic delay so the typing loader flashes.
  const reply = await new Promise<string>((resolve) => {
    setTimeout(() => resolve(getMockAIResponse(topic, history)), 150);
  });
  return { reply };
};

export interface SendConversationTurnInput {
  userId: string;
  topic: string;
  /** Full dialogue history, ending with the Learner's just-sent 'user' turn. */
  history: ChatMessage[];
  isMock: boolean;
  aiConfig?: AIConfig;
  /**
   * Optional: invoked for each complete sentence of the reply, in order, so the
   * caller can speak the reply sentence-by-sentence (Live feel). Segmentation
   * happens once the full reply is known.
   */
  onSentence?: (sentence: string) => void;
}

/**
 * Send one AI Conversation turn. Generates the reply, attaches feedback to the
 * Learner's last turn (when available), persists the session, records the
 * Speaking activity, and (if `onSentence` is given) emits the reply
 * sentence-by-sentence. Returns the reply text. Never persists raw audio.
 */
export const sendConversationTurn = async (
  input: SendConversationTurnInput,
): Promise<string> => {
  const { userId, topic, history, isMock, aiConfig, onSentence } = input;
  const now = new Date();

  const { reply, feedback } = await generateReply(topic, history, isMock, aiConfig);

  // Persist the turn (feedback rides the Learner's last 'user' message).
  await saveConversationTurn({ userId, topic, history, reply, feedback, isMock, when: now });

  // Record the Speaking activity (speaking_minutes + Streak).
  await recordSpeakingActivity(userId, isMock, now);

  // Emit reply sentence-by-sentence for TTS (if the caller wants it).
  if (onSentence) {
    const streamer = createSentenceStreamer();
    for (const sentence of streamer.push(reply)) onSentence(sentence);
    for (const sentence of streamer.flush()) onSentence(sentence);
  }

  return reply;
};
