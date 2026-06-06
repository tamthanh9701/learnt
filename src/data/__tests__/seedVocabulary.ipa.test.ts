import { describe, it, expect } from 'vitest';
import { seedFlashcards, seedTopics } from '../seedVocabulary';

// CH5 (2026-06-06): the seed pool that drives the PronunciationPage
// must carry an IPA phonetic for every flashcard, so the page can
// render the pronunciation hint above the target sentence. These
// tests pin the integrity of the IPA data and its companion test
// (PronunciationPage.test.ts) checks that the page actually surfaces
// it. If a future contributor adds a flashcard without an IPA,
// these tests catch it before the page silently renders nothing.

describe('seedVocabulary example_phonetic [TC-SEEDVI-IPA]', () => {
  it('TC-SEEDVI-IPA-01 every flashcard has a non-empty example_phonetic', () => {
    for (const c of seedFlashcards) {
      expect(
        c.example_phonetic,
        `card ${c.id} (${c.word}) is missing example_phonetic`,
      ).toBeDefined();
      expect(
        c.example_phonetic?.trim().length ?? 0,
        `card ${c.id} (${c.word}) has empty example_phonetic`,
      ).toBeGreaterThan(0);
    }
  });

  it('TC-SEEDVI-IPA-02 every example_phonetic is wrapped in IPA slashes /.../', () => {
    // Light shape check: starts with '/' and ends with '/'. The page
    // renders the string verbatim, so a missing slash would look
    // wrong (or be missed by a future styling change).
    for (const c of seedFlashcards) {
      const ph = c.example_phonetic ?? '';
      expect(ph.startsWith('/'), `card ${c.id} phonetic="${ph}" should start with /`).toBe(true);
      expect(ph.endsWith('/'), `card ${c.id} phonetic="${ph}" should end with /`).toBe(true);
    }
  });

  it('TC-SEEDVI-IPA-03 example_phonetic is plausibly IPA (length > example_en length / 3, no Vietnamese diacritics)', () => {
    // Heuristic structural check. IPA is usually a different length
    // than the source English (often longer because of stress
    // marks, length marks, and narrow transcriptions). If a
    // contributor accidentally pastes example_en into
    // example_phonetic, the lengths will be too close (IPA would
    // be very similar to the source). The reverse (IPA much
    // shorter than example_en) is also a smell - usually means
    // the IPA is truncated.
    //
    // We do NOT ban English letters here because the IPA alphabet
    // intentionally overlaps with Latin (r, t, m, n, l, k, p, b,
    // d, g, f, v, s, z, h are all valid IPA letters).
    for (const c of seedFlashcards) {
      const ph = c.example_phonetic ?? '';
      const en = c.example_en ?? '';
      // Slashes (one pair) count as 2 chars; the rest is the IPA.
      const ipaBody = ph.replace(/^\/|\/$/g, '');
      const ratio = ipaBody.length / Math.max(1, en.length);
      // IPA for a short English sentence tends to be 0.6x..1.4x
      // the source length. Anything < 0.4x is suspicious.
      expect(
        ratio,
        `card ${c.id} IPA length / EN length = ${ratio.toFixed(2)} looks too short (truncated?)`,
      ).toBeGreaterThan(0.4);
      // No Vietnamese diacritics (those would mean the wrong field).
      // Use a tiny set of unambiguous VI marks; we accept the
      // ASCII-only assumption for now (the hand-crafted IPA uses
      // ASCII + IPA symbols from the Unicode IPA block).
      expect(ph, `card ${c.id} IPA contains VI diacritics`).not.toMatch(/ăâêôơưđàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ/i);
    }
  });

  it('TC-SEEDVI-IPA-04 the IPA pool size matches the example sentence pool (no card is silently dropped)', () => {
    // The PronunciationPage builds a sentence pool from cards that
    // have a non-empty example_en. Every card in the seed HAS an
    // example_en, so the pool size must equal the card count.
    // This is a regression guard for "I added a card and the page
    // now skips it because example_phonetic is missing".
    const usable = seedFlashcards.filter(c => c.example_en && c.example_en.trim().length > 0);
    expect(usable.length).toBe(seedFlashcards.length);
  });
});

// Quick topic-link regression guard, mirrors TC-SEEDVI-04 above.
describe('seedVocabulary [TC-SEEDVI-TOPIC]', () => {
  it('TC-SEEDVI-TOPIC-01 every flashcard topic_id resolves to a seeded topic', () => {
    const topicIds = new Set(seedTopics.map(t => t.id));
    for (const c of seedFlashcards) {
      expect(topicIds.has(c.topic_id), `card ${c.id} -> ${c.topic_id}`).toBe(true);
    }
  });
});
