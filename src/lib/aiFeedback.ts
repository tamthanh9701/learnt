/**
 * Structured AI feedback — types + pure, defensive parser (P0 foundation).
 *
 * Backs Change 3 (live-feel Speaking) per be-design.md §3 and business rules
 * BR-12 / BR-15 / BR-23. NO network, NO I/O — every function here is pure and
 * deterministic so it is unit-testable in happy-dom (fixtures F-A, F-B1..B4).
 *
 * Field names are snake_case to match the Gemini JSON contract AND the test
 * fixtures (F-A / F-E) byte-for-byte, so serialize↔deserialize is identity with
 * no key remapping.
 */

/** A single discrete correction within a feedback object. */
export interface FeedbackError {
  original: string;
  correction: string;
  explanation: string;
}

/**
 * The structured feedback attached to a Learner's conversation turn.
 * `corrected_text` + `errors[]` are REQUIRED (errors:[] is a valid "no errors
 * found" signal); `better_phrasing` is OPTIONAL.
 */
export interface StructuredFeedback {
  corrected_text: string;
  errors: FeedbackError[];
  better_phrasing?: string;
}

/** Result of parsing one model turn: always a reply, feedback only if complete. */
export interface ParsedTurn {
  reply: string;
  feedback?: StructuredFeedback;
}

/**
 * The EXACT "complete enough to show" type guard (BR-12 bar / BR-23 negation).
 *
 * A feedback object is complete ⟺ it is a non-null, non-array object AND
 * `corrected_text` is a non-empty (after trim) string AND `errors` is an array
 * (empty or not). `better_phrasing`, when present, must be a string or null.
 *
 * Deterministic and never throws.
 */
export function isCompleteFeedback(value: unknown): value is StructuredFeedback {
  // BR-23 cond.1: must be a non-null, non-array object
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fb = value as Record<string, unknown>;

  // BR-23 cond.2: corrected_text REQUIRED, string, non-empty after trim
  if (typeof fb.corrected_text !== 'string' || fb.corrected_text.trim().length === 0) {
    return false;
  }

  // BR-23 cond.3: errors REQUIRED and MUST be an array ([] is valid/complete)
  if (!Array.isArray(fb.errors)) {
    return false;
  }

  // better_phrasing OPTIONAL: absent | null | string all acceptable.
  // A non-string, non-null better_phrasing (e.g. number/object) is malformed → reject.
  if (
    fb.better_phrasing !== undefined &&
    fb.better_phrasing !== null &&
    typeof fb.better_phrasing !== 'string'
  ) {
    return false;
  }

  return true;
}

/** Strip a leading/embedded ```json … ``` (or bare ``` … ```) code fence, if any. */
function stripCodeFences(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1].trim().length > 0) {
    return fenceMatch[1].trim();
  }
  return text;
}

/**
 * Locate the first balanced `{ … }` block in `text`, respecting string literals
 * and escapes so braces inside JSON strings do not throw off the depth count.
 * Returns the substring, or undefined if no balanced block exists (e.g. the
 * model output was truncated mid-object).
 */
function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/**
 * Try to parse `raw` into a plain object, tolerating real-world model drift:
 *   1. direct JSON.parse of the trimmed text;
 *   2. JSON.parse after stripping a ```json fence;
 *   3. JSON.parse of the first balanced {…} block found in the text (prose-wrapped).
 * Returns the first candidate that parses to a non-null, non-array object, else
 * undefined. Never throws.
 */
function tryParseObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  const fenced = stripCodeFences(trimmed);

  const candidates: string[] = [trimmed];
  if (fenced !== trimmed) {
    candidates.push(fenced);
  }
  const extracted = extractFirstJsonObject(fenced);
  if (extracted !== undefined && !candidates.includes(extracted)) {
    candidates.push(extracted);
  }

  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // parse failed for this candidate — try the next one
    }
  }
  return undefined;
}

/**
 * Defensive parser for one model turn (BR-15 / BR-23). Pure, deterministic,
 * NEVER throws.
 *
 * Behavior:
 *  - If nothing usable parses (truncated/non-JSON), OR the parsed object has no
 *    usable `reply` string → return a plain reply using the raw text (trimmed),
 *    with NO feedback (BR-15: F-B1, F-B4).
 *  - If a usable object parses and carries a non-empty `reply` string → return
 *    that reply, and attach `feedback` ONLY when isCompleteFeedback() is true
 *    (BR-23: F-B3 partial → feedback omitted; F-A complete → feedback attached).
 *
 * F-B2 (prose-wrapped JSON) note: this impl chooses TOLERANT EXTRACT FIRST — the
 * first balanced {…} block is parsed (per be-design.md §3.3). Both extract and
 * whole-text fallback satisfy BR-15; the chosen path never throws and always
 * yields a defined `reply` string.
 */
export function parseStructuredReply(raw: string): ParsedTurn {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

  const parsed = tryParseObject(trimmed);
  if (parsed === undefined) {
    // parse failed entirely → plain reply (BR-15)
    return { reply: trimmed };
  }

  const replyValue = parsed.reply;
  if (typeof replyValue !== 'string' || replyValue.trim().length === 0) {
    // parsed, but no usable reply → plain reply using the raw text (BR-15)
    return { reply: trimmed };
  }

  // usable reply present → attach feedback only when complete (BR-23)
  if (isCompleteFeedback(parsed.feedback)) {
    return { reply: replyValue, feedback: parsed.feedback };
  }
  return { reply: replyValue };
}
