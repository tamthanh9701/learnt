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

import type { AIConfig, ChatMessage as AIChatMessage } from './aiClient';
import { parseStructuredReply } from './aiFeedback';
import type { StructuredFeedback } from './aiFeedback';
import { createSentenceStreamer } from './sentenceStreamer';
import {
  saveConversationTurn,
} from './conversationRepository';
import type { ChatMessage } from './conversationRepository';
import { recordSpeakingActivity } from './speakingActivityRecorder';
import { generateStructuredContent } from './aiContentGenerator';
import type { ContentGenerationSpec } from './aiContentGenerator';
import { CONTENT_CONTRACTS } from './aiContentRegistry';

export type { ChatMessage, ConversationSession } from './conversationRepository';
export { loadConversationSessions as fetchSpeakingSessionsHistory } from './conversationRepository';

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

interface GenerateResult {
  reply: string;
  feedback?: StructuredFeedback;
}

interface ConversationInput {
  topic: string;
  history: ChatMessage[];
}

/**
 * Conversation recipe for the shared 3-tier ladder. The provider parser reuses
 * `parseStructuredReply` UNCHANGED — it never returns undefined (always yields a
 * `{reply}`), so a non-throwing provider call always wins (only a provider throw
 * falls to Edge), exactly as before. The Edge step carries a reply only (no
 * feedback). The mock keeps its 150ms cosmetic delay so the typing loader flashes.
 */
const conversationSpec: ContentGenerationSpec<ConversationInput, GenerateResult> = {
  label: 'conversation',
  buildMessages: ({ topic, history }): AIChatMessage[] => [
    { role: 'system', content: CONTENT_CONTRACTS.conversation.buildSystemPrompt(topic) },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ],
  responseSchema: CONTENT_CONTRACTS.conversation.responseSchema,
  parseProviderReply: (raw): GenerateResult => {
    const parsed = parseStructuredReply(raw);
    return { reply: parsed.reply, feedback: parsed.feedback };
  },
  edgeFunctionName: CONTENT_CONTRACTS.conversation.edgeFunctionName,
  buildEdgeBody: ({ topic, history }) => ({ topic, history }),
  parseEdgeData: (data): GenerateResult | undefined => {
    const reply = (data as { reply?: unknown } | null | undefined)?.reply;
    return reply ? { reply: reply as string } : undefined;
  },
  mock: ({ topic, history }): Promise<GenerateResult> =>
    // Small cosmetic delay so the typing loader flashes (preserved from inline ladder).
    new Promise<GenerateResult>((resolve) => {
      setTimeout(() => resolve({ reply: getMockAIResponse(topic, history) }), 150);
    }),
};

/** Generate a reply: provider -> Edge Function -> mock. Internal. */
const generateReply = async (
  topic: string,
  history: ChatMessage[],
  isMock: boolean,
  aiConfig?: AIConfig,
): Promise<GenerateResult> =>
  generateStructuredContent(conversationSpec, { topic, history }, { isMock, aiConfig });

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
