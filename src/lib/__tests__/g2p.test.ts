import { describe, it, expect } from 'vitest';
import {
  normalizeWordForG2P,
  stripStress,
  parseArpabet,
  flattenPhonemes,
  type WordPhonemes,
} from '../g2p';

describe('g2p pure helpers [TC-G2P]', () => {
  it('TC-G2P-01 normalizeWordForG2P lowercases and strips punctuation', () => {
    expect(normalizeWordForG2P('Hello,')).toBe('hello');
    expect(normalizeWordForG2P('"World!"')).toBe('world');
    expect(normalizeWordForG2P('  Test?  ')).toBe('test');
  });

  it('TC-G2P-02 stripStress removes trailing stress digits', () => {
    expect(stripStress('EL1')).toBe('EL');
    expect(stripStress('OW2')).toBe('OW');
    expect(stripStress('HH')).toBe('HH');
  });

  it('TC-G2P-03 parseArpabet splits, strips stress, drops empties', () => {
    expect(parseArpabet('HH AX EL1 OW')).toEqual(['HH', 'AX', 'EL', 'OW']);
    expect(parseArpabet('  W1   ER  ')).toEqual(['W', 'ER']);
    expect(parseArpabet('')).toEqual([]);
  });

  it('TC-G2P-04 flattenPhonemes concatenates per-word phonemes in order', () => {
    const words: WordPhonemes[] = [
      { word: 'hello', phonemes: ['HH', 'AX', 'L', 'OW'] },
      { word: 'world', phonemes: ['W', 'ER', 'L', 'D'] },
    ];
    expect(flattenPhonemes(words)).toEqual([
      'HH', 'AX', 'L', 'OW', 'W', 'ER', 'L', 'D',
    ]);
  });

  it('TC-G2P-05 flattenPhonemes handles empty word lists', () => {
    expect(flattenPhonemes([])).toEqual([]);
    expect(flattenPhonemes([{ word: 'x', phonemes: [] }])).toEqual([]);
  });
});
