/**
 * phonemeScorer.ts — in-browser pronunciation scoring.
 *
 * The ONLY file in src/ that may import @huggingface/transformers.
 * It is intended to be loaded via a dynamic import() from PronunciationPage
 * so Rollup splits it into a separate lazy chunk (BR-21, NFR-11 veto).
 *
 * Approach (chosen for robustness + small model size, NOT a phoneme CTC):
 *   - ASR pipeline (whisper-tiny.en) transcribes the learner's audio to text.
 *   - The PURE scoring function (alignAndBand below) compares the recognized
 *     words to the reference words, computes per-word scores, and bands them
 *     (good/borderline/off) per BR-18. The pure function is unit-testable
 *     in happy-dom without ever loading transformers.
 *
 * On model load failure -> caller falls back to speakingService.scorePronunciationSimilarity.
 */

import { bandForScore } from './pronunciationHistory';
import type { PhonemeBand, PhonemeScore, PronunciationAttempt } from './pronunciationHistory';

// ---------------------------------------------------------------------------
// Public loader state machine (NFR: never an infinite spinner, terminal always).
// ---------------------------------------------------------------------------

export type PhonemeEngineState =
  | { kind: 'idle' }
  | { kind: 'downloading'; file?: string; loaded?: number; total?: number }
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/** Identifier of the in-browser model (pin to one place for easy swap). */
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

// ---------------------------------------------------------------------------
// Side-effecty loader (transformers.js). Imported only via dynamic import()
// from PronunciationPage so Rollup splits it out of the main bundle.
// ---------------------------------------------------------------------------

type AsrPipeline = (
  input: Float32Array | string,
  options?: Record<string, unknown>,
) => Promise<{ text?: string; chunks?: Array<{ text?: string }> }>;

/**
 * Load the ASR pipeline. The onState callback is invoked for each loader state
 * (downloading, preparing, ready, error). Returns the pipeline or throws on
 * failure. The caller is expected to ALWAYS reach a terminal state.
 */
export async function loadPhonemeEngine(
  onState: (s: PhonemeEngineState) => void,
): Promise<AsrPipeline> {
  onState({ kind: 'downloading' });
  try {
    // Dynamic import of the HEAVY package happens ONLY here.
    // Rollup will not see it as a static import of src/ (this file is the
    // only one that imports it, and it is reached via dynamic import from the page).
    const mod = await import('@huggingface/transformers');
    const { pipeline, env } = mod as {
      pipeline: (task: string, model?: string, opts?: Record<string, unknown>) => Promise<AsrPipeline>;
      env: { allowLocalModel?: boolean; useFsWrite?: boolean };
    };
    // Stay WASM, single-thread. Do not enable WebGPU.
    onState({ kind: 'preparing' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env as any).useFsWrite = false;
    const pipe = await pipeline('automatic-speech-recognition', PHONEME_MODEL_ID, {
      // quantized, wasm, single-thread (NFR: WASM not WebGPU; Safari-safe)
      dtype: 'q8',
      device: 'wasm',
    } as Record<string, unknown>);
    onState({ kind: 'ready' });
    return pipe;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onState({ kind: 'error', message });
    throw err;
  }
}

/**
 * Transcribe audio (Float32Array @ 16kHz) to text using the loaded pipeline.
 */
export async function transcribe(
  pipe: AsrPipeline,
  audio: Float32Array,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await pipe(audio as any, { chunk_length_s: 30, stride_length_s: 5 });
  if (typeof out?.text === 'string') return out.text;
  if (Array.isArray(out?.chunks) && out.chunks.length > 0) {
    return out.chunks.map((c: { text?: string }) => c.text || '').join(' ');
  }
  return '';
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
