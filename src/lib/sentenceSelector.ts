/**
 * sentenceSelector.ts — pure sentence-picking for the Pronunciation Drill.
 *
 * The Pronunciation Drill draws sentences from a pool (vocab example_en +
 * fallback challenges). Before this module the page always started at index 0,
 * so every visit replayed the SAME first sentence (the "stuck on sentence 1"
 * bug). This module decides which sentence to show, driven by the Learner's
 * own practice history.
 *
 * Two prioritisation signals (the "C — by history" design):
 *   1. COVERAGE (Slice 1): prefer sentences the Learner has practiced LEAST.
 *      Brand-new sentences (0 attempts) come first; ties broken randomly so
 *      repeated visits don't feel deterministic.
 *   2. MASTERY (Slice 2): among equally-covered sentences, prefer the ones with
 *      the LOWEST score. Only meaningful once the espeak-ng engine produces a
 *      trustworthy score — until then `attemptScores` is omitted and selection
 *      is coverage-only.
 *
 * Everything here is PURE — no React, no I/O, no Date.now, no Math.random in the
 * core ranking. Randomness is injected (`rng`) so tests are deterministic. This
 * keeps the module unit-testable in happy-dom, like phonemeScorer.
 */

/** A candidate sentence in the drill pool, identified by its source card id. */
export interface SentenceCandidate {
  sourceCardId: string;
  sentence: string;
}

/** Per-card practice stats derived from pronunciation history. */
export interface CardHistoryStat {
  /** How many times the Learner has practiced this sentence/card. */
  attempts: number;
  /**
   * Mean overall score in [0,1] across attempts, or null if unknown.
   * MASTERY signal (Slice 2). Omit/null to rank by coverage only.
   */
  meanScore?: number | null;
}

export interface SelectionOptions {
  /** Map of sourceCardId -> practice stats. Missing card = never practiced. */
  history: Record<string, CardHistoryStat>;
  /**
   * The index just shown, so we never immediately repeat it (BR-19). Use -1
   * when there is no previous sentence (first mount).
   */
  lastIndex?: number;
  /** Injected RNG in [0,1) for deterministic tests. Defaults to Math.random. */
  rng?: () => number;
  /**
   * When true, factor meanScore into ranking (MASTERY, Slice 2). When false
   * (default), rank by coverage only (Slice 1).
   */
  useMastery?: boolean;
}

/** Aggregate practice counters for the "X attempts · Y sentences" display. */
export interface PracticeCounters {
  /** Total number of attempts across all sentences. */
  totalAttempts: number;
  /** Number of DISTINCT sentences/cards practiced at least once. */
  distinctSentences: number;
}

/**
 * Rank value for a candidate. Lower = higher priority (show sooner).
 * Pure deterministic given its inputs (the random tiebreaker is the caller's
 * injected rng, captured into `jitter`).
 */
interface Ranked {
  index: number;
  attempts: number;
  meanScore: number;
  jitter: number;
}

/**
 * Choose the index of the next sentence to practice.
 *
 * Ranking (ascending priority key):
 *   1. fewest attempts first (COVERAGE)
 *   2. if useMastery: lower meanScore first (MASTERY)
 *   3. random jitter (stable per call via injected rng)
 * The previously-shown index (`lastIndex`) is excluded unless it is the only
 * candidate. Returns 0 for an empty pool (caller guards rendering).
 */
export function selectNextSentenceIndex(
  pool: SentenceCandidate[],
  opts: SelectionOptions,
): number {
  if (pool.length === 0) return 0;
  if (pool.length === 1) return 0;

  const rng = opts.rng ?? Math.random;
  const useMastery = opts.useMastery ?? false;
  const lastIndex = opts.lastIndex ?? -1;

  const ranked: Ranked[] = pool.map((candidate, index) => {
    const stat = opts.history[candidate.sourceCardId];
    const attempts = stat?.attempts ?? 0;
    // Unknown score ranks as "mastered" (1) so we don't push unscored
    // sentences to the front on the mastery signal — coverage handles novelty.
    const meanScore =
      useMastery && typeof stat?.meanScore === 'number' ? stat.meanScore : 1;
    return { index, attempts, meanScore, jitter: rng() };
  });

  const eligible = ranked.filter((r) => r.index !== lastIndex);
  const pickFrom = eligible.length > 0 ? eligible : ranked;

  pickFrom.sort((a, b) => {
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    if (useMastery && a.meanScore !== b.meanScore) return a.meanScore - b.meanScore;
    return a.jitter - b.jitter;
  });

  return pickFrom[0].index;
}

/**
 * Compute the "X attempts · Y sentences" counters from a per-card history map.
 * Pure. distinctSentences counts cards with >= 1 attempt.
 */
export function computePracticeCounters(
  history: Record<string, CardHistoryStat>,
): PracticeCounters {
  let totalAttempts = 0;
  let distinctSentences = 0;
  for (const key of Object.keys(history)) {
    const attempts = history[key]?.attempts ?? 0;
    totalAttempts += attempts;
    if (attempts > 0) distinctSentences += 1;
  }
  return { totalAttempts, distinctSentences };
}
