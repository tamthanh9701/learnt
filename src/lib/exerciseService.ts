import { supabase } from './supabase';
import { callAIProvider } from './aiClient';
import type { AIConfig, ChatMessage as AIChatMessage } from './aiClient';
import { recordActivity } from './streak';
import { isValidExerciseList } from './llmValidation';
import { withTimeout } from './timeout';

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
      id: 'ex-biz-1',
      type: 'mcq',
      prompt_en: 'Choose the word that means: "To work jointly with others on a project or activity."',
      prompt_vi: 'Chọn từ có nghĩa: "Làm việc chung với người khác trên một dự án hoặc hoạt động."',
      options: ['Collaborate', 'Compete', 'Calculate', 'Cancel'],
      correct_option: 'Collaborate',
      explanation_en: 'To collaborate means to work jointly with others. The other options are unrelated verbs.',
      explanation_vi: 'Collaborate nghĩa là làm việc chung với người khác. Các lựa chọn khác là những động từ không liên quan.',
    },
    {
      id: 'ex-biz-2',
      type: 'cloze',
      prompt_en: 'Fill in the blank with the correct vocabulary word:',
      prompt_vi: 'Điền vào chỗ trống từ vựng chính xác:',
      sentence_with_blank: 'After months of [blank], the two companies finally agreed on a partnership.',
      correct_answer: 'negotiation',
      explanation_en: 'Negotiation is the process of discussing terms to reach an agreement. The sentence describes a business agreement process.',
      explanation_vi: 'Negotiation là quá trình thảo luận các điều khoản để đạt được thỏa thuận. Câu mô tả quá trình đạt được thỏa thuận kinh doanh.',
    },
    {
      id: 'ex-biz-3',
      type: 'reorder',
      prompt_en: 'Reorder the words to make a correct sentence about business:',
      prompt_vi: 'Sắp xếp lại các từ để tạo thành câu đúng về kinh doanh:',
      scrambled_words: ['meeting', 'the', 'quarterly', 'is', 'next', 'Tuesday'],
      correct_sentence: 'the quarterly meeting is next tuesday',
      explanation_en: 'The correct order forms: "The quarterly meeting is next Tuesday."',
      explanation_vi: 'Thứ tự đúng tạo thành: "The quarterly meeting is next Tuesday." (Cuộc họp hàng quý là thứ Ba tuần sau.)',
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
      const exercises = JSON.parse(jsonStr);
      if (isValidExerciseList(exercises)) {
        return exercises;
      }
      console.warn('AI provider returned invalid ExerciseQuestion[] shape, falling back.');
    } catch (err) {
      console.warn('AI provider call failed for exercise generation, falling back:', err);
    }
  }

  if (isMock) {
    return generateMockExercises(topicId);
  } else {
    // Call Supabase Edge function to generate AI exercises based on topic keywords
    try {
      const { data, error } = await supabase.functions.invoke('ai-generate-exercises', {
        body: { topic_id: topicId },
      });

      if (error) throw error;
      if (isValidExerciseList(data?.questions)) {
        return data.questions;
      }
      console.warn('Edge function returned invalid ExerciseQuestion[] shape, falling back.');
    } catch (err) {
      console.warn('ai-generate-exercises function not available or failed. Falling back to local generation.', err);
    }
    // CH7 (2026-06-07, P2-#14): pre-fix did
    //   return fetchExercisesForTopic(topicId, true);
    // which is a RECURSIVE call to the same function. It worked
    // because the isMock=true branch does NOT recurse, but the
    // recursive structure is confusing and the original
    // aiConfig is silently dropped. Now: extract the mock
    // fallback into generateMockExercises() and call it
    // directly. The intent ("use AI as primary, fall back to
    // mock") is now obvious.
    return generateMockExercises(topicId);
  }
};

/**
 * Build a 3-exercise fallback set when the AI provider is not
 * configured or the Edge function fails. Extracted from
 * fetchExercisesForTopic (CH7 P2-#14) so the cloud branch can
 * call it directly without recursion.
 */
function generateMockExercises(topicId: string): ExerciseQuestion[] {
  if (seedExercises[topicId]) {
    return seedExercises[topicId];
  }
  // Generic fallback for topics without a hand-curated seed.
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
}

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

    // Streak: any learning activity counts (centralized)
    await recordActivity(userId, true, new Date(now));
  } else {
    try {
      // CH7 (2026-06-07, P3-#23): same pattern as writingService
      // (P3-#22). Wrap daily_progress read + update in
      // withTimeout so a slow / hung backend cannot leave the
      // page in submitting state.
      const progress = await withTimeout(
        async (signal) => {
          const res = await supabase
            .from('daily_progress')
            .select('*')
            .eq('learner_id', userId)
            .eq('activity_date', today)
            .abortSignal(signal)
            .single();
          // PGRST116 = row not found, fine here.
          if (res.error && res.error.code !== 'PGRST116') throw res.error;
          return res.data;
        },
        5_000,
        'exerciseService: readDailyProgress',
      );

      if (progress) {
        await withTimeout(
          async (signal) => {
            // Same typing workaround as writingService - see
            // comment there for the full rationale.
            const builder = supabase
              .from('daily_progress')
              .update({ exercises_completed: (progress.exercises_completed || 0) + 1 })
              .eq('id', progress.id) as unknown as { abortSignal: (s: AbortSignal) => Promise<{ error: { message: string } | null }> };
            const r = await builder.abortSignal(signal);
            if (r.error) throw r.error;
          },
          5_000,
          'exerciseService: updateDailyProgress',
        );
      } else {
        await withTimeout(
          async (signal) => {
            const builder = supabase.from('daily_progress').insert({
              learner_id: userId,
              activity_date: today,
              exercises_completed: 1,
            }) as unknown as { abortSignal: (s: AbortSignal) => Promise<{ error: { message: string } | null }> };
            const r = await builder.abortSignal(signal);
            if (r.error) throw r.error;
          },
          5_000,
          'exerciseService: insertDailyProgress',
        );
      }

      // Streak: any learning activity counts (centralized)
      await recordActivity(userId, false, new Date(now));
    } catch (err) {
      console.error('Error saving exercise completion to Supabase:', err);
    }
  }
};

