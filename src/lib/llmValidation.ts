import type { WritingFeedback } from './writingService';
import type { ExerciseQuestion, ExerciseType } from './exerciseService';

/**
 * Zero-dependency runtime type guards for LLM-generated payloads.
 *
 * LLM providers (and Supabase Edge Functions) return free-form JSON that we
 * `JSON.parse(...) as T`. These guards verify the parsed shape at runtime
 * before we trust it, since a malformed/hallucinated response would otherwise
 * crash the UI. No external validation library (e.g. zod) is used — only
 * `type` imports, which are erased at compile time (no circular-import risk).
 */

/** Narrow an unknown value to a plain, non-null object we can index safely. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when value is an array whose every element is a string. */
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** True when value is a non-empty string after trimming. */
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** Validate a single WritingFeedback.errors[] item. */
const isValidWritingFeedbackError = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return (
    typeof value.original === 'string' &&
    typeof value.corrected === 'string' &&
    typeof value.explanation === 'string'
  );
};

/**
 * Validates an LLM-produced WritingFeedback object.
 *
 * Shape (from writingService.ts WritingFeedback / WritingFeedbackError):
 *   - overall_score: number (finite)
 *   - strengths: string[]
 *   - suggestions: string[]
 *   - revised_text: string
 *   - errors: { original: string; corrected: string; explanation: string }[]
 *
 * Empty arrays are acceptable. Any missing or wrong-typed field => false.
 */
export const isValidWritingFeedback = (x: unknown): x is WritingFeedback => {
  if (!isRecord(x)) return false;

  if (typeof x.overall_score !== 'number' || !Number.isFinite(x.overall_score)) {
    return false;
  }

  if (!isStringArray(x.strengths)) return false;
  if (!isStringArray(x.suggestions)) return false;
  if (typeof x.revised_text !== 'string') return false;

  if (!Array.isArray(x.errors)) return false;
  if (!x.errors.every(isValidWritingFeedbackError)) return false;

  return true;
};

/** The exact ExerciseType literal union (from exerciseService.ts). */
const EXERCISE_TYPES: readonly ExerciseType[] = ['mcq', 'cloze', 'reorder'];

const isExerciseType = (value: unknown): value is ExerciseType =>
  typeof value === 'string' && (EXERCISE_TYPES as readonly string[]).includes(value);

/** Validate a single ExerciseQuestion item, including per-type required fields. */
const okItem = (value: unknown): boolean => {
  if (!isRecord(value)) return false;

  if (!isExerciseType(value.type)) return false;
  if (!isNonEmptyString(value.prompt_en)) return false;

  switch (value.type) {
    case 'mcq':
      return (
        Array.isArray(value.options) &&
        value.options.length >= 2 &&
        typeof value.correct_option === 'string'
      );
    case 'cloze':
      return (
        typeof value.sentence_with_blank === 'string' &&
        typeof value.correct_answer === 'string'
      );
    case 'reorder':
      return (
        Array.isArray(value.scrambled_words) &&
        value.scrambled_words.length > 0 &&
        typeof value.correct_sentence === 'string'
      );
    default:
      return false;
  }
};

/**
 * Validates an LLM-produced list of ExerciseQuestion objects.
 *
 * True iff x is a non-empty array and every item passes okItem:
 *   - item is a non-null object
 *   - item.type is one of 'mcq' | 'cloze' | 'reorder'
 *   - item.prompt_en is a non-empty string
 *   - mcq:     options.length >= 2 AND correct_option is a string
 *   - cloze:   sentence_with_blank is a string AND correct_answer is a string
 *   - reorder: scrambled_words.length > 0 AND correct_sentence is a string
 *
 * Any single failing item invalidates the whole list (return false).
 */
export const isValidExerciseList = (x: unknown): x is ExerciseQuestion[] => {
  if (!Array.isArray(x)) return false;
  if (x.length === 0) return false;
  return x.every(okItem);
};
