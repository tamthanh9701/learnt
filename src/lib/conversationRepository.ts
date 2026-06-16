/**
 * conversationRepository.ts — AI Conversation session store.
 *
 * Owns load/save of AI Conversation sessions. Two adapters behind one interface:
 * in-memory (localStorage) for the mock Learner, Supabase for the cloud Learner.
 * Callers pick via `isMock` and never branch on storage.
 *
 * This module only ever sees CONVERSATION rows. Pronunciation Drill rows (the
 * `PRONUNCIATION_TOPIC` sentinel) are filtered out on read and never written
 * here — that separation is owned by pronunciationAttemptRepository. The sentinel
 * constant stays an implementation detail used only to exclude those rows.
 */

import { supabase } from './supabase';
import { PRONUNCIATION_TOPIC } from './pronunciationHistory';
import type { StructuredFeedback } from './aiFeedback';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /**
   * Structured feedback (BR-12/BR-14). Present only on Learner ('user') turns
   * that received complete feedback; absent otherwise. Optional/additive — older
   * persisted rows that lack this key read back as `undefined`.
   */
  feedback?: StructuredFeedback;
}

export interface ConversationSession {
  id: string;
  topic: string;
  messages: ChatMessage[];
  created_at: string;
}

const mockKey = (userId: string) => `learnt_conversations_${userId}`;

/**
 * Persist a conversation turn-set for a topic. Upserts by topic: the most recent
 * session for that topic is updated in place, else a new session is inserted.
 * Mock and cloud parity. Cloud failure is logged, never thrown.
 */
export const saveConversationSession = async (
  userId: string,
  topic: string,
  fullHistory: ChatMessage[],
  isMock: boolean,
): Promise<void> => {
  const now = new Date().toISOString();

  if (isMock) {
    const sessions: ConversationSession[] = JSON.parse(
      localStorage.getItem(mockKey(userId)) || '[]',
    );
    let active = sessions.find((s) => s.topic === topic);
    if (!active) {
      active = { id: `conv-${Date.now()}`, topic, messages: [], created_at: now };
      sessions.unshift(active);
    }
    active.messages = fullHistory;
    localStorage.setItem(mockKey(userId), JSON.stringify(sessions));
    return;
  }

  try {
    const { data: existing } = await supabase
      .from('speaking_sessions')
      .select('id')
      .eq('learner_id', userId)
      .eq('topic', topic)
      .order('created_at', { ascending: false });

    if (existing && existing.length > 0) {
      const { error } = await supabase
        .from('speaking_sessions')
        .update({ dialogue_history: fullHistory })
        .eq('id', existing[0].id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('speaking_sessions')
        .insert({ learner_id: userId, topic, dialogue_history: fullHistory });
      if (error) throw error;
    }
  } catch (dbErr) {
    console.error('Error saving conversation session to Supabase:', dbErr);
  }
};

/**
 * Input shape for `saveConversationTurn` — the per-turn write semantics owned by
 * this repository (BR-13/BR-14/BR-15/BR-23). Callers hand in the dialogue
 * history ending with the Learner's just-sent 'user' turn plus the AI's reply;
 * this repo attaches feedback to the right turn and persists the full session.
 */
export interface SaveConversationTurnInput {
  userId: string;
  topic: string;
  /** Full dialogue history, ending with the Learner's just-sent 'user' turn. */
  history: ChatMessage[];
  reply: string;
  feedback?: StructuredFeedback;
  isMock: boolean;
  when: Date;
}

/**
 * Persist one AI Conversation turn (BR-13/BR-14/BR-15/BR-23).
 *
 * Attaches structured feedback (when present) to the Learner's just-sent turn —
 * the LAST 'user' message in `history`. Never mutates the caller's array. Then
 * appends the assistant reply and upserts the session via
 * `saveConversationSession`. When feedback is undefined (mock / edge / non-
 * Gemini / parse-fail / incomplete) the turn persists unchanged with
 * feedback === undefined.
 */
export const saveConversationTurn = async (
  input: SaveConversationTurnInput,
): Promise<void> => {
  const { userId, topic, history, reply, feedback, isMock, when } = input;

  const historyWithFeedback: ChatMessage[] = history.map((m, i) => {
    if (feedback !== undefined && i === history.length - 1 && m.role === 'user') {
      return { ...m, feedback };
    }
    return m;
  });

  const fullHistory: ChatMessage[] = [
    ...historyWithFeedback,
    { role: 'assistant', content: reply, timestamp: when.toISOString() },
  ];

  await saveConversationSession(userId, topic, fullHistory, isMock);
};

/**
 * Read AI Conversation sessions, newest first. Pronunciation Drill sentinel rows
 * are excluded so the two histories never cross-contaminate.
 */
export const fetchConversationSessions = async (
  userId: string,
  isMock: boolean,
): Promise<ConversationSession[]> => {
  if (isMock) {
    const sessions: ConversationSession[] = JSON.parse(
      localStorage.getItem(mockKey(userId)) || '[]',
    );
    return sessions.filter((s) => s.topic !== PRONUNCIATION_TOPIC);
  }

  const { data, error } = await supabase
    .from('speaking_sessions')
    .select('*')
    .eq('learner_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter((row) => row.topic !== PRONUNCIATION_TOPIC)
    .map((row) => ({
      id: row.id,
      topic: row.topic,
      messages: row.dialogue_history || [],
      created_at: row.created_at,
    }));
};

/**
 * Alias of `fetchConversationSessions` — kept so callers can speak in the
 * load/save vocabulary used elsewhere (`saveConversationTurn` /
 * `saveConversationSession` / `loadConversationSessions`). Behavior is
 * identical, both names stay exported for backward compatibility.
 */
export const loadConversationSessions = fetchConversationSessions;
