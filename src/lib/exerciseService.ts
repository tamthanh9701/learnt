import { supabase } from './supabase';
import { callAIProvider } from './aiClient';
import type { AIConfig, ChatMessage as AIChatMessage } from './aiClient';

export type ExerciseType = 'mcq' | 'cloze' | 'reorder';

export interface ExerciseQuestion {
  id: string;
  type: ExerciseType;
  prompt_en: string;
  prompt_vi: string;
  
  // MCQ specific
  options?: string[];
  correct_option?: string;
  
  // Cloze specific
  sentence_with_blank?: string; // e.g. "She was [blank] by the beautiful sunset."
  correct_answer?: string;
  
  // Reorder specific
  scrambled_words?: string[]; // e.g. ["English", "studying", "I", "am"]
  correct_sentence?: string;  // e.g. "I am studying English"

  explanation_en: string;
  explanation_vi: string;
}

export interface TopicExercises {
  topic_id: string;
  questions: ExerciseQuestion[];
}

export const seedExercises: Record<string, ExerciseQuestion[]> = {
  'topic-technology': [
    {
      id: 'ex-tech-1',
      type: 'mcq',
      prompt_en: 'Choose the word that means: "A set of instructions that performs a specific task or calculation."',
      prompt_vi: 'Chọn từ có nghĩa: "Một tập hợp các hướng dẫn thực hiện một tác vụ hoặc tính toán cụ thể."',
      options: ['Algorithm', 'Hardware', 'Memory', 'Monitor'],
      correct_option: 'Algorithm',
      explanation_en: 'An algorithm is a step-by-step procedure or set of rules for solving a problem, especially by a computer.',
      explanation_vi: 'Một thuật toán (algorithm) là một quy trình từng bước hoặc tập hợp các quy tắc để giải quyết một vấn đề, đặc biệt là bằng máy tính.'
    },
    {
      id: 'ex-tech-2',
      type: 'cloze',
      prompt_en: 'Fill in the blank with the correct vocabulary word:',
      prompt_vi: 'Điền vào chỗ trống từ vựng chính xác:',
      sentence_with_blank: 'The search engine uses a sophisticated [blank] to rank pages.',
      correct_answer: 'algorithm',
      explanation_en: 'The word is "algorithm", representing the ranking software rules used by search engines.',
      explanation_vi: 'Từ cần điền là "algorithm", đại diện cho các quy tắc phần mềm xếp hạng được sử dụng bởi các công cụ tìm kiếm.'
    },
    {
      id: 'ex-tech-3',
      type: 'reorder',
      prompt_en: 'Reorder the words to make a correct sentence about computer programs:',
      prompt_vi: 'Sắp xếp lại các từ để tạo thành câu đúng về chương trình máy tính:',
      scrambled_words: ['executes', 'every', 'an', 'computer', 'second', 'algorithm'],
      correct_sentence: 'a computer executes an algorithm every second',
      explanation_en: 'The correct order forms: "A computer executes an algorithm every second."',
      explanation_vi: 'Thứ tự đúng tạo thành: "A computer executes an algorithm every second." (Một máy tính thực thi một thuật toán mỗi giây.)'
    }
  ],
  'topic-business': [
    {
      id: 'ex-edu-1',
      type: 'mcq',
      prompt_en: 'Identify the word representing the context of teaching, instruction, or schooling:',
      prompt_vi: 'Xác định từ đại diện cho bối cảnh giảng dạy, hướng dẫn hoặc đi học:',
      options: ['Vacation', 'Education', 'Entertainment', 'Pollution'],
      correct_option: 'Education',
      explanation_en: 'Education is the process of receiving or giving systematic instruction, especially at a school.',
      explanation_vi: 'Education (Giáo dục) là quá trình nhận hoặc cung cấp hướng dẫn có hệ thống, đặc biệt là ở trường học.'
    },
    {
      id: 'ex-edu-2',
      type: 'cloze',
      prompt_en: 'Fill in the blank with the correct vocabulary word:',
      prompt_vi: 'Điền vào chỗ trống từ vựng chính xác:',
      sentence_with_blank: 'Online platforms have revolutionized modern [blank] systems.',
      correct_answer: 'education',
      explanation_en: 'The sentence speaks of online schooling/instruction, which refers to the "education" system.',
      explanation_vi: 'Câu nói về trường học/hướng dẫn trực tuyến, đề cập đến hệ thống giáo dục "education".'
    },
    {
      id: 'ex-edu-3',
      type: 'reorder',
      prompt_en: 'Reorder the words to formulate a statement about schooling:',
      prompt_vi: 'Sắp xếp lại các từ để tạo thành một tuyên bố về trường học:',
      scrambled_words: ['is', 'key', 'to', 'education', 'success', 'the'],
      correct_sentence: 'education is the key to success',
      explanation_en: 'The correct order is "education is the key to success".',
      explanation_vi: 'Thứ tự chính xác là "education is the key to success" (Giáo dục là chìa khóa dẫn đến thành công).'
    }
  ]
};

/**
 * Generates interactive exercises either from seed data or using local AI simulator fallback.
 */
export const fetchExercisesForTopic = async (
  topicId: string,
  isMock: boolean,
  aiConfig?: AIConfig
): Promise<ExerciseQuestion[]> => {
  // Try real AI provider first
  if (aiConfig && aiConfig.provider !== 'none' && aiConfig.apiKey && aiConfig.model) {
    try {
      const systemPrompt = `You are an English language exercise generator. Generate exactly 3 exercises for the topic "${topicId}". Return a JSON array (no markdown fences) with this structure:
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

      const messages: AIChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate 3 English exercises for the topic: "${topicId}"` },
      ];

      const reply = await callAIProvider(aiConfig, messages);
      const jsonStr = reply.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const exercises = JSON.parse(jsonStr) as ExerciseQuestion[];
      return exercises;
    } catch (err) {
      console.warn('AI provider call failed for exercise generation, falling back:', err);
    }
  }

  if (isMock) {
    // Return seed exercises if present, otherwise generate a mock set based on topicId
    if (seedExercises[topicId]) {
      return seedExercises[topicId];
    }
    
    // Fallback generator for other topics
    return [
      {
        id: `ex-gen-${topicId}-1`,
        type: 'mcq',
        prompt_en: 'Identify the correct definition for the core term of this topic.',
        prompt_vi: 'Xác định định nghĩa đúng cho thuật ngữ cốt lõi của chủ đề này.',
        options: ['Primary concept', 'Secondary element', 'Unrelated factor', 'Random choice'],
        correct_option: 'Primary concept',
        explanation_en: 'The primary concept represents the core study theme.',
        explanation_vi: 'Khái niệm sơ cấp đại diện cho chủ đề học tập chính.'
      },
      {
        id: `ex-gen-${topicId}-2`,
        type: 'cloze',
        prompt_en: 'Fill in the blank to complete this grammar logic:',
        prompt_vi: 'Điền vào chỗ trống để hoàn thành logic ngữ pháp:',
        sentence_with_blank: 'Learning vocabulary requires persistent [blank] practice.',
        correct_answer: 'daily',
        explanation_en: 'Daily practice helps consolidate spacing memory stability.',
        explanation_vi: 'Luyện tập hàng ngày giúp củng cố tính ổn định của trí nhớ giãn cách.'
      },
      {
        id: `ex-gen-${topicId}-3`,
        type: 'reorder',
        prompt_en: 'Reorder the scrambled word cards to form a logical English statement:',
        prompt_vi: 'Sắp xếp lại các thẻ từ lộn xộn để tạo thành một câu tiếng Anh hợp lý:',
        scrambled_words: ['daily', 'practice', 'makes', 'perfect', 'learning'],
        correct_sentence: 'daily practice makes learning perfect',
        explanation_en: 'The words assemble into: "Daily practice makes learning perfect."',
        explanation_vi: 'Thứ tự đúng tạo thành: "Daily practice makes learning perfect." (Luyện tập hàng ngày tạo nên sự học tập hoàn hảo.)'
      }
    ];
  } else {
    // Call Supabase Edge function to generate AI exercises based on topic keywords
    try {
      const { data, error } = await supabase.functions.invoke('ai-generate-exercises', {
        body: { topic_id: topicId },
      });

      if (error) throw error;
      return data.questions;
    } catch (err) {
      console.warn('ai-generate-exercises function not available or failed. Falling back to local generation.', err);
      return fetchExercisesForTopic(topicId, true);
    }
  }
};

/**
 * Records exercise completion in the daily progress table/local storage.
 */
export const recordExerciseCompletion = async (
  userId: string,
  isMock: boolean
): Promise<void> => {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  if (isMock) {
    const progressKey = `learnt_progress_${userId}_${today}`;
    const progress = JSON.parse(localStorage.getItem(progressKey) || '{"cards_reviewed": 0, "exercises_completed": 0}');
    progress.exercises_completed = (progress.exercises_completed || 0) + 1;
    localStorage.setItem(progressKey, JSON.stringify(progress));
  } else {
    try {
      const { data: progress, error: progErr } = await supabase
        .from('daily_progress')
        .select('*')
        .eq('learner_id', userId)
        .eq('activity_date', today)
        .single();

      if (!progErr && progress) {
        await supabase
          .from('daily_progress')
          .update({ exercises_completed: (progress.exercises_completed || 0) + 1 })
          .eq('id', progress.id);
      } else {
        await supabase.from('daily_progress').insert({
          learner_id: userId,
          activity_date: today,
          exercises_completed: 1,
        });
      }
    } catch (err) {
      console.error('Error saving exercise completion to Supabase:', err);
    }
  }
};

