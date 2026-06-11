/**
 * g2p.ts — grapheme-to-phoneme for the Pronunciation Drill (Slice 2).
 *
 * Turns English text into a sequence of phonemes PER WORD, so the scorer can
 * align the reference sentence against the Learner's spoken transcript at the
 * phoneme level (not the whole-word level the old Levenshtein path used).
 *
 * Engine: `phonemize` (MIT, pure-JS, rule-based G2P). Chosen over espeak-ng
 * because it is ~5x lighter (3.8MB pure-JS vs 18.7MB WASM) and needs no
 * self-hosted WASM asset — for sequence alignment a rule-based G2P is enough.
 *
 * LAZY: the phonemize module is loaded via dynamic import the first time
 * `phonemizeWords` runs, so it stays OUT of the main bundle (NFR-11 — the same
 * discipline that removed the 24MB transformers engine). Callers must be async.
 *
 * The phonemizer is pure given its input, but loading is async + cached at
 * module scope so repeated calls pay the import cost once.
 */

/** A single word and its ordered phoneme tokens (ARPABET, stress stripped). */
export interface WordPhonemes {
  word: string;
  phonemes: string[];
}

type ToArpabet = (text: string) => string;

let arpabetFnPromise: Promise<ToArpabet> | null = null;

/**
 * Lazily import phonemize and resolve its `toARPABET` function. Cached so the
 * dynamic import + module init happens once per session.
 */
async function loadArpabet(): Promise<ToArpabet> {
  if (!arpabetFnPromise) {
    arpabetFnPromise = import('phonemize').then((mod) => {
      const fn = (mod as { toARPABET?: ToArpabet }).toARPABET;
      if (typeof fn !== 'function') {
        throw new Error('phonemize.toARPABET unavailable');
      }
      return fn;
    });
  }
  return arpabetFnPromise;
}

/** Normalize a word for G2P: lowercase, strip surrounding punctuation. */
export function normalizeWordForG2P(raw: string): string {
  return raw.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, '').trim();
}

/**
 * Strip the ARPABET stress digit suffix (e.g. "EL1" -> "EL", "OW2" -> "OW") so
 * alignment compares phoneme identity, not stress. Pure.
 */
export function stripStress(token: string): string {
  return token.replace(/\d+$/, '');
}

/**
 * Split a raw ARPABET string ("HH AX EL1 OW") into clean phoneme tokens
 * (["HH","AX","EL","OW"]), dropping empties and stress digits. Pure.
 */
export function parseArpabet(arpabet: string): string[] {
  return arpabet
    .split(/\s+/)
    .map((tok) => stripStress(tok.trim()))
    .filter((tok) => tok.length > 0);
}

/**
 * Phonemize a sentence into per-word phoneme sequences. Words that the G2P
 * cannot pronounce degrade to an empty phoneme list rather than throwing, so a
 * single odd word never breaks scoring. Async (lazy engine load).
 *
 * Tokenizes on whitespace; each token is normalized then phonemized
 * individually so the per-word mapping is exact (needed for phoneme->word
 * display).
 */
export async function phonemizeWords(sentence: string): Promise<WordPhonemes[]> {
  const toArpabet = await loadArpabet();
  const words = sentence
    .split(/\s+/)
    .map(normalizeWordForG2P)
    .filter((w) => w.length > 0);

  return words.map((word) => {
    let phonemes: string[];
    try {
      phonemes = parseArpabet(toArpabet(word));
    } catch {
      phonemes = [];
    }
    return { word, phonemes };
  });
}

/** Flatten per-word phonemes into one ordered phoneme stream. Pure. */
export function flattenPhonemes(words: WordPhonemes[]): string[] {
  const out: string[] = [];
  for (const w of words) out.push(...w.phonemes);
  return out;
}
