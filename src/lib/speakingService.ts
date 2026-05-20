import { supabase } from './supabase';
import { callAIProvider } from './aiClient';
import type { AIConfig } from './aiClient';
import type { ChatMessage as AIChatMessage } from './aiClient';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
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

  // 1. Generate response
  // Try real AI provider first (if configured)
  if (aiConfig && aiConfig.provider !== 'none' && aiConfig.apiKey && aiConfig.model) {
    try {
      const systemPrompt = `You are a friendly English conversation tutor. The topic is "${topic}". 
Keep your responses conversational, encouraging, and at an intermediate English level. 
Ask follow-up questions to keep the conversation flowing.
Gently correct any grammar mistakes the student makes.
Keep responses concise (2-4 sentences).`;

      const messages: AIChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      response = await callAIProvider(aiConfig, messages);
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

  // 2. Save dialogue history
  const fullHistory: ChatMessage[] = [...history, { role: 'assistant' as const, content: response, timestamp: now }];

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
      console.error('Error saving conversation session to Supabase:', dbErr);
    }
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
 * Fetch speaking conversation sessions history
 */
export const fetchSpeakingSessionsHistory = async (
  userId: string,
  isMock: boolean
): Promise<ConversationSession[]> => {
  if (isMock) {
    return JSON.parse(localStorage.getItem(`learnt_conversations_${userId}`) || '[]');
  } else {
    const { data, error } = await supabase
      .from('speaking_sessions')
      .select('*')
      .eq('learner_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map(row => ({
      id: row.id,
      topic: row.topic,
      messages: row.dialogue_history || [],
      created_at: row.created_at,
    }));
  }
};
