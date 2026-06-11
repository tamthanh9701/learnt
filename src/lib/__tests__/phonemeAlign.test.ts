import { describe, it, expect } from 'vitest';
import {
  needlemanWunsch,
  scorePhonemeWords,
} from '../phonemeScorer';
import type { WordPhonemes } from '../g2p';

describe('needlemanWunsch [TC-NW]', () => {
  it('TC-NW-01 identical streams -> all cells match', () => {
    const aligned = needlemanWunsch(['HH', 'AX', 'L'], ['HH', 'AX', 'L']);
    expect(aligned).toHaveLength(3);
    expect(aligned.every((c) => c.match)).toBe(true);
  });

  it('TC-NW-02 a substitution is marked as non-match, same length', () => {
    const aligned = needlemanWunsch(['HH', 'AX', 'L'], ['HH', 'IH', 'L']);
    const matches = aligned.filter((c) => c.match).length;
    expect(matches).toBe(2);
  });

  it('TC-NW-03 a deletion produces a ref-only cell (hyp null)', () => {
    // hyp is missing the middle phoneme
    const aligned = needlemanWunsch(['HH', 'AX', 'L'], ['HH', 'L']);
    expect(aligned.some((c) => c.ref !== null && c.hyp === null)).toBe(true);
    // both HH and L should still match
    expect(aligned.filter((c) => c.match).length).toBe(2);
  });

  it('TC-NW-04 an insertion produces a hyp-only cell (ref null)', () => {
    const aligned = needlemanWunsch(['HH', 'L'], ['HH', 'AX', 'L']);
    expect(aligned.some((c) => c.ref === null && c.hyp !== null)).toBe(true);
  });

  it('TC-NW-05 empty ref -> all insertions', () => {
    const aligned = needlemanWunsch([], ['HH', 'AX']);
    expect(aligned).toHaveLength(2);
    expect(aligned.every((c) => c.ref === null)).toBe(true);
  });
});

const w = (word: string, phonemes: string[]): WordPhonemes => ({ word, phonemes });

describe('scorePhonemeWords [TC-SPW]', () => {
  it('TC-SPW-01 perfect match -> overall 1.0, every word good', () => {
    const ref = [w('hello', ['HH', 'AX', 'L', 'OW']), w('world', ['W', 'ER', 'L', 'D'])];
    const { overall, perWord } = scorePhonemeWords(ref, ref);
    expect(overall).toBe(1);
    expect(perWord).toHaveLength(2);
    expect(perWord.every((p) => p.band === 'good')).toBe(true);
  });

  it('TC-SPW-02 perWord carries the WORD (not IPA) for display', () => {
    const ref = [w('hello', ['HH', 'AX', 'L', 'OW'])];
    const { perWord } = scorePhonemeWords(ref, ref);
    expect(perWord[0].phoneme).toBe('hello');
  });

  it('TC-SPW-03 a fully-missed word scores 0 / off', () => {
    const ref = [w('hello', ['HH', 'AX', 'L', 'OW']), w('world', ['W', 'ER', 'L', 'D'])];
    const hyp = [w('hello', ['HH', 'AX', 'L', 'OW'])]; // world not spoken
    const { perWord } = scorePhonemeWords(ref, hyp);
    expect(perWord[0].band).toBe('good');
    expect(perWord[1].score).toBe(0);
    expect(perWord[1].band).toBe('off');
  });

  it('TC-SPW-04 partial phoneme match yields a fractional word score', () => {
    // ref "cat" = K AE T ; hyp "cap" = K AE P -> 2/3 matched ~0.67 -> borderline
    const ref = [w('cat', ['K', 'AE', 'T'])];
    const hyp = [w('cap', ['K', 'AE', 'P'])];
    const { perWord } = scorePhonemeWords(ref, hyp);
    expect(perWord[0].score).toBeCloseTo(2 / 3, 5);
    expect(perWord[0].band).toBe('borderline');
  });

  it('TC-SPW-05 empty reference -> overall 0, no scored words', () => {
    const { overall, perWord } = scorePhonemeWords([], []);
    expect(overall).toBe(0);
    expect(perWord).toEqual([]);
  });

  it('TC-SPW-06 a word with no phonemes (G2P miss) is excluded from overall', () => {
    const ref = [w('hello', ['HH', 'AX', 'L', 'OW']), w('xyzzy', [])];
    const { overall, perWord } = scorePhonemeWords(ref, [ref[0]]);
    // only "hello" counts toward overall (perfect) -> 1.0
    expect(overall).toBe(1);
    expect(perWord).toHaveLength(2);
  });
});
