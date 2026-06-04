import { supabase } from './supabase';
import { callAIProvider } from './aiClient';
import type { AIConfig } from './aiClient';
import type { ChatMessage as AIChatMessage } from './aiClient';
import { parseStructuredReply } from './aiFeedback';
import type { StructuredFeedback } from './aiFeedback';
import {
  serializePronunciationAttempt,
  deserializePronunciationHistory,
  PRONUNCIATION_TOPIC,
} from './pronunciationHistory';
import type { PronunciationAttempt, PronunciationSessionEntry } from './pronunciationHistory';
import { withTimeout } from './timeout';
import { recordActivity } from './streak';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /**
   * Structured feedback (Change 3, BR-12/BR-14). Present only on Learner ('user')
   * turns that received complete feedback; absent on assistant turns and on
   * plain-reply user turns. Optional/additive — older persisted rows that lack
   * this key read back as `undefined`, so this does not break existing sessions.
   */
  feedback?: StructuredFeedback;
}

export interface ConversationSession {
  id: string;
  topic: string;
  messages: ChatMessage[];
  created_at: string;
}

export interface PronunciationChallenge {
  id: string;
  text: string;
  phonetic: string;
  translation_vi: string;
}

export const seedPronunciationChallenges: PronunciationChallenge[] = [
  {
    id: 'pron-1',
    text: 'Algorithms process data with incredible speed.',
    phonetic: '/ˈæl.ɡə.rɪ.ðəmz ˈprəʊ.ses ˈdeɪ.tə wɪð ɪnˈkred.ə.bəl spiːd/',
    translation_vi: 'Các thuật toán xử lý dữ liệu với tốc độ đáng kinh ngạc.'
  },
  {
    id: 'pron-2',
    text: 'Education opens doors to unexpected opportunities.',
    phonetic: '/ˌed.jʊˈkeɪ.ʃən ˈəʊ.pənz dɔːz tuː ˌʌn.ɪkˈspek.tɪd ˌɒp.əˈtʃuː.nə.tiz/',
    translation_vi: 'Giáo dục mở ra cánh cửa dẫn đến những cơ hội bất ngờ.'
  },
  {
    id: 'pron-3',
    text: 'Artificial intelligence can simulate human conversation.',
    phonetic: '/ˌɑː.tɪˈfɪʃ.əl ɪnˈtel.ɪ.dʒəns kæn ˈsɪm.jə.leɪt ˈhjuː.mən ˌkɒn.vəˈseɪ.ʃən/',
    translation_vi: 'Trí tuệ nhân tạo có thể mô phỏng cuộc trò chuyện của con người.'
  },
  {
    id: 'pron-4',
    text: 'Consistency is crucial when learning a foreign language.',
    phonetic: '/kənˈsɪs.tən.si ɪz ˈkruː.ʃəl wen ˈlɜː.nɪŋ ə ˈfɒr.ən ˈlæŋ.ɡwɪdʒ/',
    translation_vi: 'Sự nhất quán là rất quan trọng khi học một ngoại ngữ.'
  }
];

/**
 * Basic local AI dialog responder simulating a friendly English conversation partner
 */
const getMockAIResponse = (topic: string, history: ChatMessage[]): string => {
  const userText = history[history.length - 1]?.content.toLowerCase() || '';

  // Greetings
  if (userText.includes('hello') || userText.includes('hi ') || userText.includes('hey')) {
    return `Hello! I am your AI Speaking Partner. I am happy to practice English conversation with you today. What would you like to discuss regarding "${topic}"?`;
  }

  // Common prompts response
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

  // General fallback questions
  if (userText.includes('because') || userText.includes('reason')) {
    return "I see! That explanation makes perfect sense. Can you give me a specific example from your own experience that illustrates this?";
  }

  return "That is interesting! Could you expand a bit more on that thought? How does that affect your daily life or career goals?";
};

/**
 * Gemini-only structured-output schema (Change 3, BR-12). Mirrors the
 * `{reply, feedback:{corrected_text, errors[], better_phrasing?}}` contract so a
 * Gemini call can emit schema-valid JSON directly. This is a reliability boost
 * only — the result is ALWAYS run through `parseStructuredReply` (defense in
 * depth), and non-Gemini providers rely on the strict system prompt + parser.
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

/**
 * Triggers speaking conversation assistant response
 */
export const fetchAIConversationResponse = async (
  userId: string,
  topic: string,
  history: ChatMessage[],
  isMock: boolean,
  aiConfig?: AIConfig
): Promise<string> => {
  const now = new Date().toISOString();
  let response = '';
  let responseGenerated = false;
  // Structured feedback for the Learner's just-sent turn (BR-12/BR-14). Stays
  // undefined for mock / edge / non-structured / parse-failure paths (BR-15/BR-23).
  let feedback: StructuredFeedback | undefined;

  // 1. Generate response
  // Try real AI provider first (if configured)
  if (aiConfig && aiConfig.provider !== 'none' && aiConfig.apiKey && aiConfig.model) {
    try {
      const systemPrompt = `You are a friendly English conversation tutor helping a Vietnamese intermediate learner. The topic is "${topic}".

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

      const messages: AIChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      // Gemini-only structured output; other providers rely on prompt + parser.
      const callOptions =
        aiConfig.provider === 'gemini'
          ? { responseSchema: FEEDBACK_RESPONSE_SCHEMA }
          : undefined;

      const raw = await callAIProvider(aiConfig, messages, callOptions);
      // Defense in depth (BR-15/BR-23): parse for all providers, never throws.
      const parsed = parseStructuredReply(raw);
      response = parsed.reply;
      feedback = parsed.feedback;
      responseGenerated = true;
    } catch (err) {
      console.warn('AI provider call failed, falling back:', err);
    }
  }

  // Try Edge function if not mock and AI provider was not called/failed
  if (!responseGenerated && !isMock) {
    try {
      const { data, error } = await supabase.functions.invoke('ai-conversation', {
        body: { topic, history },
      });
      if (error) throw error;
      response = data.reply;
      responseGenerated = true;
    } catch (err) {
      console.warn('ai-conversation Edge function failed/not deployed, falling back:', err);
    }
  }

  // Fallback to local mock response
  if (!responseGenerated) {
    response = await new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(getMockAIResponse(topic, history));
      }, 600);
    });
  }

  // 2. Save dialogue history.
  // Attach structured feedback (when complete) to the Learner's just-sent turn
  // — the LAST 'user' message in history (BR-13/BR-14). Copy, don't mutate the
  // caller's array. When feedback is undefined (mock/edge/non-Gemini/parse-fail/
  // incomplete) the turn persists unchanged with feedback === undefined (BR-15/23).
  const historyWithFeedback: ChatMessage[] = history.map((m, i) => {
    if (feedback !== undefined && i === history.length - 1 && m.role === 'user') {
      return { ...m, feedback };
    }
    return m;
  });
  const fullHistory: ChatMessage[] = [
    ...historyWithFeedback,
    { role: 'assistant' as const, content: response, timestamp: now },
  ];

  if (isMock) {
    // Save to localStorage
    const sessions: ConversationSession[] = JSON.parse(
      localStorage.getItem(`learnt_conversations_${userId}`) || '[]'
    );
    let activeSession = sessions.find(s => s.topic === topic);
    if (!activeSession) {
      activeSession = { id: `conv-${Date.now()}`, topic, messages: [], created_at: now };
      sessions.unshift(activeSession);
    }
    activeSession.messages = fullHistory;
    localStorage.setItem(`learnt_conversations_${userId}`, JSON.stringify(sessions));

    // Update localStorage progress
    const today = now.split('T')[0];
    const progressKey = `learnt_progress_${userId}_${today}`;
    const progress = JSON.parse(localStorage.getItem(progressKey) || '{"cards_reviewed": 0, "speaking_minutes": 0}');
    progress.speaking_minutes = (progress.speaking_minutes || 0) + 1;
    localStorage.setItem(progressKey, JSON.stringify(progress));

    // Streak: any learning activity counts (centralized)
    await recordActivity(userId, true, new Date(now));
  } else {
    // Save to Supabase speaking_sessions table
    try {
      // Check if session already exists for this topic to update, otherwise insert
      const { data: existingSessions } = await supabase
        .from('speaking_sessions')
        .select('id')
        .eq('learner_id', userId)
        .eq('topic', topic)
        .order('created_at', { ascending: false });

      if (existingSessions && existingSessions.length > 0) {
        // Update the most recent session
        const { error: dbError } = await supabase
          .from('speaking_sessions')
          .update({ dialogue_history: fullHistory })
          .eq('id', existingSessions[0].id);
        if (dbError) throw dbError;
      } else {
        // Insert new session
        const { error: dbError } = await supabase
          .from('speaking_sessions')
          .insert({
            learner_id: userId,
            topic,
            dialogue_history: fullHistory
          });
        if (dbError) throw dbError;
      }

      // Update daily_progress in Supabase
      const today = now.split('T')[0];
      const { data: progress, error: progErr } = await supabase
        .from('daily_progress')
        .select('*')
        .eq('learner_id', userId)
        .eq('activity_date', today)
        .single();

      if (!progErr && progress) {
        await supabase
          .from('daily_progress')
          .update({ speaking_minutes: (progress.speaking_minutes || 0) + 1 })
          .eq('id', progress.id);
      } else {
        await supabase.from('daily_progress').insert({
          learner_id: userId,
          activity_date: today,
          speaking_minutes: 1,
        });
      }
    } catch (dbErr) {
      // H2 (diagnosis 2026-06-05): cloud persistence failure is best-effort.
      // We still call recordActivity below so the streak advances.
      console.error('Error saving conversation session to Supabase:', dbErr);
    }

    // H2: recordActivity runs unconditionally. recordActivity's cloud mode
    // has a localStorage fallback (H2 sub-fix in streak.ts), so the streak
    // is preserved even if the cloud write throws here.
    await recordActivity(userId, false, new Date(now));
  }

  return response;
};

/**
 * Score pronunciation accuracy by comparing spoken transcript with reference text
 */
export const scorePronunciationSimilarity = (reference: string, transcript: string): {
  score: number;
  words: { word: string; isCorrect: boolean }[];
} => {
  const cleanStr = (s: string) => s.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, "").trim();
  
  const refWords = cleanStr(reference).split(/\s+/).filter(Boolean);
  const transWords = cleanStr(transcript).split(/\s+/).filter(Boolean);

  let correctCount = 0;
  const wordsResult = refWords.map(word => {
    // Basic word presence check (allowing minor out-of-order spoken matches for simplicity)
    const isMatched = transWords.some(tw => tw === word);
    if (isMatched) correctCount++;
    return {
      word,
      isCorrect: isMatched
    };
  });

  const rawScore = refWords.length > 0 
    ? Math.round((correctCount / refWords.length) * 100) 
    : 0;

  // Add slight scaling to make it feel natural
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    words: wordsResult
  };
};

/**
 * Fetch speaking conversation sessions history.
 *
 * Pronunciation attempts ride the SAME `speaking_sessions` store under the
 * `PRONUNCIATION_TOPIC` sentinel (BR-20). The conversation read IGNORES those
 * sentinel rows so the two histories never cross-contaminate (separation
 * contract, TC-PRON-03-4).
 */
export const fetchSpeakingSessionsHistory = async (
  userId: string,
  isMock: boolean
): Promise<ConversationSession[]> => {
  if (isMock) {
    const sessions: ConversationSession[] = JSON.parse(
      localStorage.getItem(`learnt_conversations_${userId}`) || '[]'
    );
    return sessions.filter(s => s.topic !== PRONUNCIATION_TOPIC);
  } else {
    const { data, error } = await supabase
      .from('speaking_sessions')
      .select('*')
      .eq('learner_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || [])
      .filter(row => row.topic !== PRONUNCIATION_TOPIC)
      .map(row => ({
        id: row.id,
        topic: row.topic,
        messages: row.dialogue_history || [],
        created_at: row.created_at,
      }));
  }
};

/**
 * Persist a single pronunciation attempt (Change 4, D13 / BR-20).
 *
 * Each attempt is stored as a distinct `speaking_sessions` entry under the
 * `PRONUNCIATION_TOPIC` sentinel (insert-per-attempt — there is no topic to
 * upsert against). Mock and cloud round-trip through the SAME serializer
 * (`serializePronunciationAttempt`) so the two modes are byte-equivalent.
 * Privacy (NFR-27): only derived phoneme scores persist — never raw audio.
 */
export const savePronunciationAttempt = async (
  userId: string,
  attempt: PronunciationAttempt,
  isMock: boolean
): Promise<void> => {
  const now = new Date().toISOString();
  const entry: PronunciationSessionEntry = {
    id: `pron-${Date.now()}`,
    topic: PRONUNCIATION_TOPIC,
    created_at: now,
    attempt,
  };
  const serialized = serializePronunciationAttempt(entry);

  if (isMock) {
    // Mock parity: store as a speaking_sessions-shaped row in localStorage so
    // the SAME deserializer reads it back (BR-20). Newest-first (unshift).
    const rows: unknown[] = JSON.parse(
      localStorage.getItem(`learnt_pron_${userId}`) || '[]'
    );
    rows.unshift(serialized);
    localStorage.setItem(`learnt_pron_${userId}`, JSON.stringify(rows));
  } else {
    // Cloud: INSERT one row per attempt; dialogue_history carries the entry
    // (BR-20). Wrapped in withTimeout (NFR-15, label 'pron-history').
    try {
      await withTimeout(
        async () => {
          const { error: dbError } = await supabase
            .from('speaking_sessions')
            .insert({
              learner_id: userId,
              topic: PRONUNCIATION_TOPIC,
              dialogue_history: [serialized],
            });
          if (dbError) throw dbError;
        },
        8000,
        'pron-history'
      );
    } catch (dbErr) {
      // H2 (diagnosis 2026-06-05): persistence failure is non-fatal; do NOT
      // skip recordActivity because of it. The learner did the work and the
      // streak should advance. Local in-memory state was already updated
      // (the attempt is preserved client-side until the next page load).
      console.error('Error saving pronunciation attempt to Supabase:', dbErr);
    }
  }

  // H1 (diagnosis 2026-06-05): Pronunciation Drill is a learning activity and
  // must update the streak, same as the other 3 activity types. Was wired up
  // for AI Conversation / Free Writing / Structured Exercise in S4 (CH2), but
  // this helper was missed. Run unconditionally so cloud-save failures still
  // count the activity (TC-PRON-STREAK-01/02).
  await recordActivity(userId, isMock, new Date(now));
};

/**
 * Read pronunciation attempt history, newest first (Change 4, D13 / BR-20).
 *
 * Reads ONLY sentinel rows via `deserializePronunciationHistory`; conversation
 * rows are ignored (separation contract, TC-PRON-03-4). Mock and cloud parity.
 * Defensive: on cloud read failure / timeout, degrades to [] rather than hang.
 */
export const fetchPronunciationHistory = async (
  userId: string,
  isMock: boolean
): Promise<PronunciationSessionEntry[]> => {
  if (isMock) {
    const rows: unknown[] = JSON.parse(
      localStorage.getItem(`learnt_pron_${userId}`) || '[]'
    );
    return deserializePronunciationHistory(rows);
  } else {
    try {
      const rows = await withTimeout(
        async () => {
          const { data, error } = await supabase
            .from('speaking_sessions')
            .select('*')
            .eq('learner_id', userId)
            .eq('topic', PRONUNCIATION_TOPIC)
            .order('created_at', { ascending: false });
          if (error) throw error;
          // Each attempt row stores its serialized entry as dialogue_history[0].
          return (data || []).map(row => {
            const dh = row.dialogue_history;
            return Array.isArray(dh) ? dh[0] : dh;
          });
        },
        8000,
        'pron-history'
      );
      return deserializePronunciationHistory(rows);
    } catch (dbErr) {
      console.error('Error loading pronunciation history from Supabase:', dbErr);
      return [];
    }
  }
};
