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
