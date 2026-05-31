import { describe, it, expect } from 'vitest';
import { isValidWritingFeedback, isValidExerciseList } from '../llmValidation';

// CH4 negative-path coverage: malformed/wrong-shape model output must be REJECTED
// (so the service falls through to the safe mock). Valid output must be ACCEPTED.

const validFeedback = {
  overall_score: 80,
  strengths: ['clear structure'],
  errors: [{ original: 'i go', corrected: 'I went', explanation: 'past tense' }],
  suggestions: ['vary vocabulary'],
  revised_text: 'I went to the store.',
};

describe('isValidWritingFeedback', () => {
  it('accepts a fully-formed feedback object', () => {
    expect(isValidWritingFeedback(validFeedback)).toBe(true);
  });

  it('accepts empty arrays for strengths/errors/suggestions', () => {
    expect(isValidWritingFeedback({ ...validFeedback, strengths: [], errors: [], suggestions: [] })).toBe(true);
  });

  it('rejects null / non-object', () => {
    expect(isValidWritingFeedback(null)).toBe(false);
    expect(isValidWritingFeedback('nope')).toBe(false);
    expect(isValidWritingFeedback(42)).toBe(false);
  });

  it('rejects a non-numeric overall_score', () => {
    expect(isValidWritingFeedback({ ...validFeedback, overall_score: '80' })).toBe(false);
  });

  it('rejects when revised_text is missing', () => {
    const { revised_text, ...rest } = validFeedback;
    void revised_text;
    expect(isValidWritingFeedback(rest)).toBe(false);
  });

  it('rejects when strengths is not an array', () => {
    expect(isValidWritingFeedback({ ...validFeedback, strengths: 'good' })).toBe(false);
  });

  it('rejects when an errors[] item is missing a string field', () => {
    expect(isValidWritingFeedback({ ...validFeedback, errors: [{ original: 'x', corrected: 'y' }] })).toBe(false);
  });
});

const mcq = { id: 'q1', type: 'mcq', prompt_en: 'Pick one', options: ['a', 'b'], correct_option: 'a' };
const cloze = { id: 'q2', type: 'cloze', prompt_en: 'Fill', sentence_with_blank: 'I [blank] home', correct_answer: 'went' };
const reorder = { id: 'q3', type: 'reorder', prompt_en: 'Reorder', scrambled_words: ['home', 'went', 'I'], correct_sentence: 'I went home' };

describe('isValidExerciseList', () => {
  it('accepts a non-empty list of well-formed items (mcq/cloze/reorder)', () => {
    expect(isValidExerciseList([mcq, cloze, reorder])).toBe(true);
  });

  it('accepts mcq as-is (scope deferred, not rejected)', () => {
    expect(isValidExerciseList([mcq])).toBe(true);
  });

  it('rejects a non-array', () => {
    expect(isValidExerciseList({})).toBe(false);
    expect(isValidExerciseList(null)).toBe(false);
  });

  it('rejects an empty array', () => {
    expect(isValidExerciseList([])).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(isValidExerciseList([{ ...mcq, type: 'matching' }])).toBe(false);
  });

  it('rejects an mcq with fewer than 2 options', () => {
    expect(isValidExerciseList([{ ...mcq, options: ['only-one'] }])).toBe(false);
  });

  it('rejects a cloze missing correct_answer', () => {
    const { correct_answer, ...rest } = cloze;
    void correct_answer;
    expect(isValidExerciseList([rest])).toBe(false);
  });

  it('rejects the whole list if any single item is bad', () => {
    expect(isValidExerciseList([mcq, cloze, { ...reorder, scrambled_words: [] }])).toBe(false);
  });

  it('rejects an item with an empty prompt_en', () => {
    expect(isValidExerciseList([{ ...mcq, prompt_en: '   ' }])).toBe(false);
  });
});
