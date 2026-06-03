/**
 * Pronunciation history — types + pure score→band mapping + serializers (P0).
 *
 * Backs Change 4 (Pronunciation Drill) per be-design.md §4.2/§4.4 and business
 * rules BR-18 / BR-20. Pronunciation attempts ride the SAME `speaking_sessions`
 * store as conversations, distinguished by the `PRONUNCIATION_TOPIC` sentinel.
 *
 * Everything here is pure — NO Supabase calls, NO I/O — so the score→band
 * mapping and the serializers are unit-testable in happy-dom (fixtures F-F, F-G).
 * Privacy (NFR-27): an attempt entry holds DERIVED phoneme scores only, never
 * raw audio bytes.
 */

/** Learner-facing status band for a phoneme / sentence (BR-18). */
export type PhonemeBand = 'good' | 'borderline' | 'off';

/** Per-phoneme assessment: IPA symbol, model score (0.0–1.0), and derived band. */
export interface PhonemeScore {
  phoneme: string;
  score: number;
  band: PhonemeBand;
}

/** A single pronunciation attempt's derived result (no raw audio — NFR-27). */
export interface PronunciationAttempt {
  sentence: string;
  source_card_id: string;
  overall_band: PhonemeBand;
  phonemes: PhonemeScore[];
}

/**
 * A pronunciation attempt as it rides `speaking_sessions.dialogue_history` JSONB,
 * tagged with the sentinel topic so it stays separable from conversation rows.
 */
export interface PronunciationSessionEntry {
  id: string;
  topic: typeof PRONUNCIATION_TOPIC;
  created_at: string;
  attempt: PronunciationAttempt;
}

/**
 * Reserved `topic` value marking a row as a pronunciation attempt rather than a
 * conversation. No real Topic uses this value (BR-20).
 */
export const PRONUNCIATION_TOPIC = '__PRONUNCIATION__' as const;

/**
 * Map a numeric phoneme score (0.0–1.0) to its status band (BR-18, F-G).
 * Boundaries are lower-inclusive: good ≥ 0.80, borderline 0.50–0.79, off < 0.50.
 *   0.80 → good, 0.79 → borderline, 0.50 → borderline, 0.49 → off,
 *   1.00 → good, 0.00 → off.
 */
export function bandForScore(score: number): PhonemeBand {
  if (score >= 0.8) {
    return 'good';
  }
  if (score >= 0.5) {
    return 'borderline';
  }
  return 'off';
}

/** Narrowing guard for the PhonemeBand union. */
function isPhonemeBand(value: unknown): value is PhonemeBand {
  return value === 'good' || value === 'borderline' || value === 'off';
}

/**
 * Serialize a pronunciation attempt entry into the JSONB-ready shape that rides
 * `speaking_sessions.dialogue_history` (matches fixture F-F). Pure transform —
 * no persistence. `topic` is forced to the sentinel so the row is always
 * separable from conversation rows.
 */
export function serializePronunciationAttempt(entry: PronunciationSessionEntry): unknown {
  return {
    id: entry.id,
    topic: PRONUNCIATION_TOPIC,
    created_at: entry.created_at,
    attempt: {
      sentence: entry.attempt.sentence,
      source_card_id: entry.attempt.source_card_id,
      overall_band: entry.attempt.overall_band,
      phonemes: entry.attempt.phonemes.map((p) => ({
        phoneme: p.phoneme,
        score: p.score,
        band: p.band,
      })),
    },
  };
}

/**
 * Deserialize one stored row back into a PronunciationSessionEntry. Returns null
 * for anything that is not a sentinel pronunciation row (so conversation rows are
 * cleanly ignored — TC-PRON-03-4). Defensive: malformed/missing fields degrade to
 * empty/`'off'` rather than throwing. For a well-formed F-F row this is the exact
 * inverse of serialize, so serialize→deserialize is an identity round-trip.
 */
export function deserializePronunciationAttempt(raw: unknown): PronunciationSessionEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (row.topic !== PRONUNCIATION_TOPIC) {
    // not a pronunciation row — ignore (separation contract, BR-20)
    return null;
  }

  const attemptRaw = row.attempt;
  if (typeof attemptRaw !== 'object' || attemptRaw === null || Array.isArray(attemptRaw)) {
    return null;
  }
  const attempt = attemptRaw as Record<string, unknown>;

  const phonemesRaw: unknown[] = Array.isArray(attempt.phonemes) ? attempt.phonemes : [];
  const phonemes: PhonemeScore[] = phonemesRaw.map((p) => {
    const ph = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    return {
      phoneme: typeof ph.phoneme === 'string' ? ph.phoneme : '',
      score: typeof ph.score === 'number' ? ph.score : 0,
      band: isPhonemeBand(ph.band) ? ph.band : 'off',
    };
  });

  return {
    id: typeof row.id === 'string' ? row.id : '',
    topic: PRONUNCIATION_TOPIC,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    attempt: {
      sentence: typeof attempt.sentence === 'string' ? attempt.sentence : '',
      source_card_id: typeof attempt.source_card_id === 'string' ? attempt.source_card_id : '',
      overall_band: isPhonemeBand(attempt.overall_band) ? attempt.overall_band : 'off',
      phonemes,
    },
  };
}

/**
 * Read pronunciation attempts out of a mixed store of `speaking_sessions` rows.
 * Reads ONLY sentinel rows; conversation rows are ignored (separation contract,
 * TC-PRON-03-4). Never throws.
 */
export function deserializePronunciationHistory(rows: unknown[]): PronunciationSessionEntry[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const result: PronunciationSessionEntry[] = [];
  for (const row of rows) {
    const entry = deserializePronunciationAttempt(row);
    if (entry !== null) {
      result.push(entry);
    }
  }
  return result;
}
