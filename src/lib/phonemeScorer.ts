/**
 * phonemeScorer.ts — in-browser pronunciation scoring.
 *
 * CH2 (diagnosis 2026-06-06, fix-2): the on-device ASR engine path
 * (loadPhonemeEngine + transcribe, @huggingface/transformers) was a
 * dead branch. PronunciationPage.finalizeAttempt called the loader
 * but never invoked the returned pipeline — the per-word scoring
 * used the same pure `alignAndBand` function on the Web Speech
 * transcript regardless. The result: every Learner in production
 * paid the cost of a 40 MB ASR model download + 23.5 MB ONNX WASM
 * + 550 kB transformers runtime, only to fall through to the same
 * text-alignment path. On networks where HuggingFace CDN is blocked
 * (Vietnam, China, corporate firewalls) the page errored with
 * "Engine unavailable — using word-match fallback" even though the
 * word-match path is the only one that actually works.
 *
 * This module now exports ONLY the pure helpers that do the work:
 *   - alignAndBand(reference, recognized) -> { overall, perWord }
 *   - buildAttempt(sentence, sourceCardId, recognized) -> PronunciationAttempt
 *   - tokenizeWords / levenshteinRatio / overallBand
 *   - PHONEME_MODEL_ID (kept for documentation; no runtime consumer)
 *
 * If a future feature really needs in-browser ASR (e.g., accent
 * scoring the recognizer can't do), re-introduce the loader behind
 * a feature flag and ensure the call site ACTUALLY USES the
 * pipeline. Until then: no model load, no WASM, no 24 MB download.
 */

import { bandForScore } from './pronunciationHistory';
import type { PhonemeBand, PhonemeScore, PronunciationAttempt } from './pronunciationHistory';
import type { WordPhonemes } from './g2p';

/** Identifier of the (no-longer-loaded) in-browser model.
 *  Kept as a docstring-style constant so future contributors know
 *  which model was considered during the BR-21 / NFR-11 design. */
export const PHONEME_MODEL_ID = 'Xenova/whisper-tiny.en' as const;

// ---------------------------------------------------------------------------
// Pure (testable) — alignment + banding, NO model dependency.
// ---------------------------------------------------------------------------

/** Normalize for word comparison: lowercase, strip punctuation, collapse spaces. */
function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, '').trim();
}

/** Tokenize a string into normalized words, dropping empties. */
export function tokenizeWords(s: string): string[] {
  return s.split(/\s+/).map(normalizeWord).filter(Boolean);
}

/**
 * Align recognized words vs reference words and emit a per-word PhonemeScore
 * (we reuse the PhonemeScore shape; "phoneme" here carries the word).
 *
 * Scoring heuristic (intentionally simple + deterministic so it is easy to test
 * and the BR-18 band cuts are stable):
 *   - word in both, identical -> 1.0
 *   - word in both, fuzzy match (Levenshtein ratio >= 0.8) -> 0.9
 *   - word in both, near-miss (0.5..0.8) -> 0.6
 *   - otherwise (missing or far) -> 0.2
 * Overall = mean of per-word scores (0..1).
 *
 * PURE — happy-dom testable (fixture F-G).
 */
export function alignAndBand(referenceText: string, recognizedText: string): {
  overall: number;
  perWord: PhonemeScore[];
} {
  const ref = tokenizeWords(referenceText);
  const rec = tokenizeWords(recognizedText);
  const perWord: PhonemeScore[] = [];
  let sum = 0;
  for (const w of ref) {
    let best: number = 0;
    for (const r of rec) {
      if (r === w) {
        best = 1.0;
        break;
      }
      const sim = levenshteinRatio(r, w);
      if (sim > best) best = sim;
    }
    // Map raw ratio -> the 3-or-4-bucket score.
    let score: number;
    if (best >= 0.95) score = 1.0;
    else if (best >= 0.8) score = 0.9;
    else if (best >= 0.5) score = 0.6;
    else score = 0.2;
    perWord.push({ phoneme: w, score, band: bandForScore(score) });
    sum += score;
  }
  const overall = ref.length === 0 ? 0 : sum / ref.length;
  return { overall, perWord };
}

/** Levenshtein similarity ratio in [0, 1] (1 = identical). */
export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // rolling row, O(min(m,n)) memory
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins && del < sub ? del : ins < sub ? ins : sub;
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Map an overall score in [0,1] to the project's 3-banded representation. */
export function overallBand(overall: number): PhonemeBand {
  return bandForScore(overall);
}

/** Build a PronunciationAttempt from a reference + recognized text. */
export function buildAttempt(
  sentence: string,
  sourceCardId: string,
  recognizedText: string,
): PronunciationAttempt {
  const { overall, perWord } = alignAndBand(sentence, recognizedText);
  return {
    sentence,
    source_card_id: sourceCardId,
    overall_band: overallBand(overall),
    phonemes: perWord,
  };
}

// ---------------------------------------------------------------------------
// Slice 2 — phoneme-level scoring via Needleman-Wunsch alignment.
//
// The word-level path above stays for back-compat + as a synchronous fallback.
// The functions below align the REFERENCE phoneme stream against the SPOKEN
// phoneme stream (both produced by g2p.ts), so a Learner gets per-phoneme
// credit — then we map phonemes back onto words for display (the UI shows a
// badge per word, not per IPA symbol).
//
// All pure + deterministic. The async G2P step lives in g2p.ts; these helpers
// take already-phonemized input so they stay unit-testable with no I/O.
// ---------------------------------------------------------------------------

/** One aligned cell: reference phoneme vs spoken phoneme (either may be null). */
export interface AlignedPair {
  ref: string | null;
  hyp: string | null;
  /** true when ref and hyp are a matching phoneme. */
  match: boolean;
}

const NW_MATCH = 1;
const NW_MISMATCH = -1;
const NW_GAP = -1;

/**
 * Global sequence alignment (Needleman-Wunsch) of two phoneme streams.
 * Returns the aligned pair list (substitutions, insertions, deletions explicit)
 * so the caller can attribute each reference phoneme to a hit/miss. Pure.
 *
 * Same dynamic-programming family as the existing `levenshtein`, but it keeps
 * the traceback so we know WHICH phonemes matched, not just the edit distance.
 */
export function needlemanWunsch(ref: string[], hyp: string[]): AlignedPair[] {
  const m = ref.length;
  const n = hyp.length;
  // Score matrix (m+1) x (n+1).
  const score: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) score[i][0] = i * NW_GAP;
  for (let j = 0; j <= n; j++) score[0][j] = j * NW_GAP;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const diag =
        score[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? NW_MATCH : NW_MISMATCH);
      const up = score[i - 1][j] + NW_GAP;
      const left = score[i][j - 1] + NW_GAP;
      score[i][j] = Math.max(diag, up, left);
    }
  }

  // Traceback from (m,n) to (0,0).
  const aligned: AlignedPair[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const diag =
        score[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? NW_MATCH : NW_MISMATCH);
      if (score[i][j] === diag) {
        const r = ref[i - 1];
        const h = hyp[j - 1];
        aligned.push({ ref: r, hyp: h, match: r === h });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && score[i][j] === score[i - 1][j] + NW_GAP) {
      aligned.push({ ref: ref[i - 1], hyp: null, match: false }); // deletion
      i -= 1;
      continue;
    }
    // insertion
    aligned.push({ ref: null, hyp: hyp[j - 1], match: false });
    j -= 1;
  }
  aligned.reverse();
  return aligned;
}

/**
 * Score the Learner's spoken phonemes against the reference, attributing the
 * result back to each reference WORD (phoneme->word mapping for display).
 *
 * For each reference word: count how many of its phonemes matched in the
 * alignment, score = matched / total, banded via bandForScore. A word with no
 * phonemes (G2P miss) falls back to a neutral 'off' so it is never silently
 * treated as perfect. Pure given its inputs.
 */
export function scorePhonemeWords(
  refWords: WordPhonemes[],
  hypWords: WordPhonemes[],
): { overall: number; perWord: PhonemeScore[] } {
  const refStream: string[] = [];
  // Track which word each reference phoneme belongs to.
  const wordOfPhoneme: number[] = [];
  refWords.forEach((w, wi) => {
    for (const p of w.phonemes) {
      refStream.push(p);
      wordOfPhoneme.push(wi);
    }
  });
  const hypStream: string[] = [];
  for (const w of hypWords) hypStream.push(...w.phonemes);

  const aligned = needlemanWunsch(refStream, hypStream);

  // Walk the alignment; for each non-insertion cell (ref !== null) advance a
  // reference-phoneme cursor and credit its owning word on a match.
  const matchedPerWord = new Array<number>(refWords.length).fill(0);
  let refCursor = 0;
  for (const cell of aligned) {
    if (cell.ref === null) continue; // insertion: no reference phoneme consumed
    const wi = wordOfPhoneme[refCursor];
    if (cell.match && wi !== undefined) matchedPerWord[wi] += 1;
    refCursor += 1;
  }

  const perWord: PhonemeScore[] = refWords.map((w, wi) => {
    const total = w.phonemes.length;
    const score = total === 0 ? 0 : matchedPerWord[wi] / total;
    return { phoneme: w.word, score, band: bandForScore(score) };
  });

  const scored = perWord.filter((_, wi) => refWords[wi].phonemes.length > 0);
  const overall =
    scored.length === 0
      ? 0
      : scored.reduce((s, p) => s + p.score, 0) / scored.length;

  return { overall, perWord };
}
