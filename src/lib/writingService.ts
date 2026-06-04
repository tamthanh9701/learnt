import { supabase } from './supabase';
import { callAIProvider } from './aiClient';
import type { AIConfig, ChatMessage as AIChatMessage } from './aiClient';
import { recordActivity } from './streak';
import { isValidWritingFeedback } from './llmValidation';

export interface WritingFeedbackError {
  original: string;
  corrected: string;
  explanation: string;
}

export interface WritingFeedback {
  overall_score: number;
  strengths: string[];
  errors: WritingFeedbackError[];
  suggestions: string[];
  revised_text: string;
}

export interface WritingSubmission {
  id: string;
  prompt: string;
  content: string;
  word_count: number;
  ai_feedback: WritingFeedback;
  created_at: string;
}

export interface WritingPrompt {
  id: string;
  title_en: string;
  title_vi: string;
  description_en: string;
  description_vi: string;
  suggested_words: number;
}

export const seedWritingPrompts: WritingPrompt[] = [
  {
    id: 'prompt-1',
    title_en: 'Benefits of Spaced Repetition',
    title_vi: 'Lợi ích của việc Lặp lại ngắt quãng',
    description_en: 'Write about how spacing out your study reviews helps you remember vocabulary better over time.',
    description_vi: 'Viết về cách việc giãn cách thời gian học tập giúp bạn nhớ từ vựng tốt hơn theo thời gian.',
    suggested_words: 80,
  },
  {
    id: 'prompt-2',
    title_en: 'Technology in Education',
    title_vi: 'Công nghệ trong Giáo dục',
    description_en: 'Do you think smartphones and AI are helpful or distracting for students? Explain your opinion.',
    description_vi: 'Bạn nghĩ điện thoại thông minh và AI giúp ích hay làm xao nhãng học sinh? Giải thích quan điểm của bạn.',
    suggested_words: 120,
  },
  {
    id: 'prompt-3',
    title_en: 'My Memorable Journey',
    title_vi: 'Chuyến đi đáng nhớ của tôi',
    description_en: 'Describe a trip that you made recently. Where did you go, who did you go with, and why was it special?',
    description_vi: 'Mô tả một chuyến đi bạn thực hiện gần đây. Bạn đã đi đâu, đi cùng ai, và tại sao nó lại đặc biệt?',
    suggested_words: 100,
  },
  {
    id: 'prompt-4',
    title_en: 'Work-Life Balance',
    title_vi: 'Cân bằng Công việc và Cuộc sống',
    description_en: 'Many young professionals struggle to balance work and personal life. Suggest ways to improve this.',
    description_vi: 'Nhiều chuyên gia trẻ gặp khó khăn khi cân bằng giữa công việc và đời sống. Hãy đề xuất giải pháp cho việc này.',
    suggested_words: 120,
  },
];

/**
 * Basic client-side grammar & styling heuristics for instant fallback feedback
 */
export const analyzeGrammarMock = (content: string): WritingFeedback => {
  const errors: WritingFeedbackError[] = [];
  const strengths: string[] = [];
  const suggestions: string[] = [];
  
  const words = content.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // 1. Analyze word count
  if (wordCount >= 100) {
    strengths.push('Excellent writing length. You demonstrated stamina and covered detailed points.');
  } else if (wordCount >= 50) {
    strengths.push('Good basic length. You provided a clear paragraph that addresses the topic.');
  } else {
    suggestions.push('Try to write a bit more to fully explain your thoughts and develop your ideas (aim for 50+ words).');
  }

  // 2. Local heuristic checks (regexes)
  // Capitalisation check at start of sentences
  const sentenceStarts = content.match(/(?:^|[.!?]\s+)([a-z])/g);
  if (sentenceStarts) {
    errors.push({
      original: 'lowercase letters starting sentences',
      corrected: 'Capital letters',
      explanation: 'Always begin a sentence with a capital letter to show proper punctuation structure.',
    });
  }

  // Common spelling mistakes
  const spellingMistakes = [
    { regex: /\bbe\b\s+\bwent\b/i, wrong: 'be went', correct: 'went or been', expl: 'Double verb tenses or wrong participle.' },
    { regex: /\bi\s/g, wrong: 'i ', correct: 'I ', expl: 'Personal pronoun "I" should always be capitalized.' },
    { regex: /\bdo\s+not\s+has\b/i, wrong: 'do not has', correct: 'do not have', expl: 'With auxiliary "do", use base verb form "have".' },
    { regex: /\bhe\s+have\b/i, wrong: 'he have', correct: 'he has', expl: 'Third-person singular "he" requires "has".' },
    { regex: /\bshe\s+have\b/i, wrong: 'she have', correct: 'she has', expl: 'Third-person singular "she" requires "has".' },
    { regex: /\bit\s+have\b/i, wrong: 'it have', correct: 'it has', expl: 'Third-person singular "it" requires "has".' },
    { regex: /\bbecause\b\s*[,.]/i, wrong: 'because ,', correct: ', because', expl: 'Punctuation mark should go before conjunctions, not after.' },
  ];

  spellingMistakes.forEach(({ regex, wrong, correct, expl }) => {
    if (regex.test(content)) {
      errors.push({
        original: wrong,
        corrected: correct,
        explanation: expl,
      });
    }
  });

  // 3. Overall strength assessment based on vocab
  const richWords = words.filter(w => w.length > 6).length;
  if (richWords > wordCount * 0.15) {
    strengths.push('Great lexical diversity! You used advanced vocabulary which makes your essay look formal.');
  } else {
    suggestions.push('Try using more academic adjectives (e.g., instead of "good", use "beneficial", "advancement", "effective").');
  }

  // 4. Score calculation
  let score = 90;
  score -= errors.length * 8;
  if (wordCount < 40) score -= 15;
  score = Math.max(45, Math.min(98, score));

  // 5. Build revised text
  let revised = content;
  // Replace simple lowercase " i "
  revised = revised.replace(/\bi\b/g, 'I');
  // Capitalize sentences
  revised = revised.replace(/(?:^|[.!?]\s+)([a-z])/g, m => m.toUpperCase());

  return {
    overall_score: score,
    strengths: strengths.length > 0 ? strengths : ['Simple and clear phrasing.'],
    errors,
    suggestions: suggestions.length > 0 ? suggestions : ['Keep practicing to improve sentence complexity.'],
    revised_text: revised,
  };
};

/**
 * Submit essay for AI feedback analysis
 */
export const submitWritingContent = async (
  userId: string,
  prompt: string,
  content: string,
  isMock: boolean,
  aiConfig?: AIConfig
): Promise<WritingSubmission> => {
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const now = new Date().toISOString();
  let aiFeedback: WritingFeedback | null = null;
  let feedbackGenerated = false;

  // 1. Generate feedback
  // Try real AI provider first (if configured)
  if (aiConfig && aiConfig.provider !== 'none' && aiConfig.apiKey && aiConfig.model) {
    try {
      const systemPrompt = `You are an English writing tutor. Analyze the student's essay and return a JSON object (no markdown fences) with this exact structure:
{
  "overall_score": <number 0-100>,
  "strengths": [<string>, ...],
  "errors": [{"original": "<wrong text>", "corrected": "<correct text>", "explanation": "<why>"}],
  "suggestions": [<string>, ...],
  "revised_text": "<improved version of the essay>"
}
Be thorough but encouraging. Focus on grammar, spelling, vocabulary, and coherence.`;

      const messages: AIChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Topic: ${prompt}\n\nEssay:\n${content}` },
      ];

      const reply = await callAIProvider(aiConfig, messages);

      // Parse JSON from reply (handle potential markdown fences)
      const jsonStr = reply.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (isValidWritingFeedback(parsed)) {
        aiFeedback = parsed;
        feedbackGenerated = true;
      } else {
        console.warn('AI provider returned invalid WritingFeedback shape, falling back.');
      }
    } catch (err) {
      console.warn('AI provider call failed for writing feedback, falling back:', err);
    }
  }

  // Try Edge function if not mock and AI provider was not called/failed
  if (!feedbackGenerated && !isMock) {
    try {
      const { data, error: funcError } = await supabase.functions.invoke('ai-writing-feedback', {
        body: { prompt, content },
      });
      if (funcError) throw funcError;
      if (isValidWritingFeedback(data?.feedback)) {
        aiFeedback = data.feedback;
        feedbackGenerated = true;
      } else {
        console.warn('Edge function returned invalid WritingFeedback shape, falling back.');
      }
    } catch (err) {
      console.warn('Supabase Edge Function failed or not deployed, falling back:', err);
    }
  }

  // Fallback to local mock analysis
  if (!feedbackGenerated || !aiFeedback) {
    aiFeedback = analyzeGrammarMock(content);
  }

  // 2. Save submission
  if (isMock) {
    // Save mock submission to localStorage
    const submissions: WritingSubmission[] = JSON.parse(
      localStorage.getItem(`learnt_writing_submissions_${userId}`) || '[]'
    );
    const newSubmission: WritingSubmission = {
      id: `write-${Date.now()}`,
      prompt,
      content,
      word_count: wordCount,
      ai_feedback: aiFeedback,
      created_at: now,
    };
    submissions.unshift(newSubmission); // Newest first
    localStorage.setItem(`learnt_writing_submissions_${userId}`, JSON.stringify(submissions));

    // Update daily progress counter in localStorage
    const today = now.split('T')[0];
    const progressKey = `learnt_progress_${userId}_${today}`;
    const progress = JSON.parse(localStorage.getItem(progressKey) || '{"cards_reviewed": 0, "writing_count": 0}');
    progress.writing_count = (progress.writing_count || 0) + 1;
    localStorage.setItem(progressKey, JSON.stringify(progress));

    // Streak: any learning activity counts (centralized)
    await recordActivity(userId, true, new Date(now));

    return newSubmission;
  } else {
    // Save to writing_submissions table in Supabase
    let cloudResult: { id: string; created_at: string } | null = null;
    try {
      const { data: dbData, error: dbError } = await supabase
        .from('writing_submissions')
        .insert({
          learner_id: userId,
          prompt,
          content,
          word_count: wordCount,
          ai_feedback: aiFeedback,
        })
        .select('*')
        .single();

      if (dbError) throw dbError;
      cloudResult = { id: dbData.id, created_at: dbData.created_at };

      // Increment daily progress in Supabase
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
          .update({ writing_count: (progress.writing_count || 0) + 1 })
          .eq('id', progress.id);
      } else {
        await supabase.from('daily_progress').insert({
          learner_id: userId,
          activity_date: today,
          writing_count: 1,
        });
      }
    } catch (err) {
      // H2 (diagnosis 2026-06-05): cloud persistence is best-effort. The
      // learner still completed the activity and the streak must advance.
      // We fall through to recordActivity (below) regardless of success.
      console.error('Failed to save writing submission to Supabase:', err);
    }

    // H2: recordActivity runs unconditionally so a cloud save failure does
    // NOT silently reset the streak. Same fix applied in exerciseService
    // and speakingService (TC-WRITE-CLOUD-01 / TC-EXPROG-CLOUD-01 / etc.).
    await recordActivity(userId, false, new Date(now));

    if (cloudResult) {
      return {
        id: cloudResult.id,
        prompt,
        content,
        word_count: wordCount,
        ai_feedback: aiFeedback,
        created_at: cloudResult.created_at,
      };
    }
    // Cloud failed — return a simulated response as fallback
    return {
      id: `write-${Date.now()}`,
      prompt,
      content,
      word_count: wordCount,
      ai_feedback: aiFeedback,
      created_at: now,
    };
  }
};

/**
 * Fetch all writing submissions for a user
 */
export const fetchWritingSubmissions = async (
  userId: string,
  isMock: boolean
): Promise<WritingSubmission[]> => {
  if (isMock) {
    return JSON.parse(localStorage.getItem(`learnt_writing_submissions_${userId}`) || '[]');
  } else {
    const { data, error } = await supabase
      .from('writing_submissions')
      .select('*')
      .eq('learner_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      prompt: row.prompt,
      content: row.content,
      word_count: row.word_count || 0,
      ai_feedback: row.ai_feedback,
      created_at: row.created_at,
    }));
  }
};
