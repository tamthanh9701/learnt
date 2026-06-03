import { describe, it, expect } from 'vitest';
import {
  isCompleteFeedback,
  parseStructuredReply,
} from '../aiFeedback';
import type { ParsedTurn } from '../aiFeedback';

// QA S4 unit tests — structured AI feedback parser + completeness guard.
// Realizes TC-SPEAK-03-1 (F-A happy parse) and TC-SPEAK-07-1 (F-B1..B4
// D5 defensive parse) at unit level. Backs BR-12 / BR-15 / BR-23.
// Fixtures F-A, F-B1..B4 are taken byte-for-byte from
// .agents/store/20260602-0751-learnt-v2/test-data-requirements.md.
// Re-run: npx vitest run src/lib/__tests__/aiFeedback.test.ts

// ---------------------------------------------------------------------------
// Fixtures (test-data-requirements.md §F-A / §F-B)
// ---------------------------------------------------------------------------

// F-A — valid structured-feedback JSON (BR-12 happy path)
const F_A = {
  reply: 'That sounds like a great trip! How long did you stay in Da Nang?',
  feedback: {
    corrected_text: 'I went to Da Nang last summer and it was beautiful.',
    errors: [
      {
        original: 'I go to Da Nang last summer',
        correction: 'I went to Da Nang last summer',
        explanation: "Past tense: use 'went' for a completed past action.",
      },
      {
        original: 'it very beautiful',
        correction: 'it was beautiful',
        explanation: "Add the verb 'was' before the adjective.",
      },
    ],
    better_phrasing:
      'I visited Da Nang last summer, and it was absolutely stunning.',
  },
};

// F-B1 — truncated / invalid JSON (model cut off)
const F_B1_TRUNCATED =
  '{"reply":"Sure, here is what I think about your sentence","feedback":{"corrected_text":"I went to';

// F-B2 — prose-wrapped / narration around the JSON object
const F_B2_PROSE_WRAPPED = `Here's my response in JSON:
{"reply":"Good effort!","feedback":{"corrected_text":"I am learning English.","errors":[],"better_phrasing":"I'm learning English."}}
Hope that helps!`;

// F-B3 — valid JSON, wrong shape (feedback missing errors[] + better_phrasing)
const F_B3_MISSING_ERRORS =
  '{ "reply": "Nice!", "feedback": { "corrected_text": "I like coffee." } }';

// F-B4 — plain prose, no JSON at all (non-Gemini provider / older prompt)
const F_B4_PLAIN_PROSE =
  'I think you meant to say "I went to the store yesterday." Nice work!';

// F-B3's embedded feedback object, isolated for the guard test (errors[] missing).
const F_B3_MISSING_ERRORS_FEEDBACK = (
  JSON.parse(F_B3_MISSING_ERRORS) as { feedback: unknown }
).feedback;

describe('isCompleteFeedback (BR-12 bar / BR-23 negation)', () => {
  it('F-A valid feedback object → true', () => {
    expect(isCompleteFeedback(F_A.feedback)).toBe(true);
  });

  it('errors:[] WITH valid corrected_text → TRUE (affirming-card boundary, BA-flagged BR-12/BR-23)', () => {
    // The key distinction BA flagged: an empty errors array is a *result*
    // ("no grammatical errors found"), NOT a missing field. MUST be complete.
    const affirming = {
      corrected_text: 'I am learning English.',
      errors: [],
    };
    expect(isCompleteFeedback(affirming)).toBe(true);
  });

  it('F-B3 missing errors → false (BR-23 cond.3)', () => {
    expect(isCompleteFeedback(F_B3_MISSING_ERRORS_FEEDBACK)).toBe(false);
  });

  it('corrected_text empty string → false (BR-23 cond.2)', () => {
    expect(isCompleteFeedback({ corrected_text: '', errors: [] })).toBe(false);
  });

  it('corrected_text whitespace-only → false (BR-23 cond.2, trim)', () => {
    expect(isCompleteFeedback({ corrected_text: '   ', errors: [] })).toBe(
      false,
    );
  });

  it('better_phrasing as number → false (malformed optional field)', () => {
    expect(
      isCompleteFeedback({
        corrected_text: 'I like coffee.',
        errors: [],
        better_phrasing: 42,
      }),
    ).toBe(false);
  });

  it('better_phrasing as object → false (malformed optional field)', () => {
    expect(
      isCompleteFeedback({
        corrected_text: 'I like coffee.',
        errors: [],
        better_phrasing: { text: 'nope' },
      }),
    ).toBe(false);
  });

  it('better_phrasing null WITH valid corrected_text + array errors → true (optional absent)', () => {
    expect(
      isCompleteFeedback({
        corrected_text: 'I like coffee.',
        errors: [],
        better_phrasing: null,
      }),
    ).toBe(true);
  });

  it('errors present but NOT an array (object) → false (BR-23 cond.3)', () => {
    expect(
      isCompleteFeedback({ corrected_text: 'I like coffee.', errors: {} }),
    ).toBe(false);
  });

  it('null feedback → false', () => {
    expect(isCompleteFeedback(null)).toBe(false);
  });

  it('undefined feedback → false', () => {
    expect(isCompleteFeedback(undefined)).toBe(false);
  });

  it('non-object (string) feedback → false', () => {
    expect(isCompleteFeedback('not feedback')).toBe(false);
  });

  it('array feedback → false (BR-23 cond.1: arrays are not feedback objects)', () => {
    expect(isCompleteFeedback([])).toBe(false);
  });
});

// Parse the F-B3 fixture once into its embedded feedback object for the guard test.
describe('parseStructuredReply (BR-15 / BR-23 defensive parse — NEVER throws)', () => {
  it('TC-SPEAK-03-1 F-A → { reply, feedback } with all fields populated', () => {
    const result: ParsedTurn = parseStructuredReply(JSON.stringify(F_A));
    expect(result.reply).toBe(F_A.reply);
    expect(result.feedback).toBeDefined();
    expect(result.feedback?.corrected_text).toBe(F_A.feedback.corrected_text);
    expect(result.feedback?.errors).toHaveLength(2);
    expect(result.feedback?.better_phrasing).toBe(F_A.feedback.better_phrasing);
  });

  it('TC-SPEAK-07-1 F-B1 truncated JSON → plain reply (trimmed), no feedback, no throw', () => {
    const raw = `   ${F_B1_TRUNCATED}   `;
    let result: ParsedTurn | undefined;
    expect(() => {
      result = parseStructuredReply(raw);
    }).not.toThrow();
    expect(result?.reply).toBe(F_B1_TRUNCATED); // raw text trimmed, used as the reply
    expect(result?.feedback).toBeUndefined();
  });

  it('TC-SPEAK-07-1 F-B2 prose-wrapped/code-fenced JSON → extracts reply + complete feedback', () => {
    const result = parseStructuredReply(F_B2_PROSE_WRAPPED);
    // impl chooses tolerant-extract-first; embedded object is complete (errors:[]).
    expect(result.reply).toBe('Good effort!');
    expect(result.feedback).toBeDefined();
    expect(result.feedback?.corrected_text).toBe('I am learning English.');
    expect(result.feedback?.errors).toEqual([]);
  });

  it('TC-SPEAK-07-1 F-B3 parses but missing errors → reply only, no feedback (BR-23)', () => {
    const result = parseStructuredReply(F_B3_MISSING_ERRORS);
    expect(result.reply).toBe('Nice!');
    expect(result.feedback).toBeUndefined();
  });

  it('TC-SPEAK-07-1 F-B4 plain prose → reply = the prose, no feedback', () => {
    const result = parseStructuredReply(F_B4_PLAIN_PROSE);
    expect(result.reply).toBe(F_B4_PLAIN_PROSE);
    expect(result.feedback).toBeUndefined();
  });

  it('TC-SPEAK-07-1 NEVER throws across all F-A/F-B variants', () => {
    const variants = [
      JSON.stringify(F_A),
      F_B1_TRUNCATED,
      F_B2_PROSE_WRAPPED,
      F_B3_MISSING_ERRORS,
      F_B4_PLAIN_PROSE,
      '',
      '   ',
      '{}',
      '[]',
      'null',
      'not json at all { [ }',
    ];
    for (const v of variants) {
      expect(() => parseStructuredReply(v)).not.toThrow();
      const r = parseStructuredReply(v);
      expect(typeof r.reply).toBe('string'); // always a defined reply string
    }
  });
});
