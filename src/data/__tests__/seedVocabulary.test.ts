import { describe, it, expect } from 'vitest';
import { seedFlashcards, seedTopics } from '../seedVocabulary';

// CHARACTERIZATION (protected baseline) - seedVocabulary.ts.
// Pins the CURRENT state of the TS seed (the source-of-truth for CH5/migration
// 004). Today the TS seed already has Vietnamese example_vi distinct from
// example_en; these tests guard that source so 004 can be cross-checked against
// it. Must stay GREEN (TS seed is not edited in Tier A).
// Re-run: npx vitest run src/data/__tests__/seedVocabulary.test.ts

// Vietnamese-specific diacritic set; a string with any of these is unambiguously VI.
const VI_DIACRITICS =
  /[ăâêôơưđàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵĂÂÊÔƠƯĐ]/;

describe('seedVocabulary integrity [TC-SEEDVI]', () => {
  it('TC-SEEDVI-01 every flashcard has a non-empty example_vi', () => {
    for (const c of seedFlashcards) {
      expect(c.example_vi.trim().length, `card ${c.id}`).toBeGreaterThan(0);
    }
  });

  it('TC-SEEDVI-02 example_vi differs from example_en for every flashcard', () => {
    for (const c of seedFlashcards) {
      expect(c.example_vi, `card ${c.id}`).not.toBe(c.example_en);
    }
  });

  it('TC-SEEDVI-03 example_vi contains Vietnamese diacritics for every flashcard', () => {
    for (const c of seedFlashcards) {
      expect(VI_DIACRITICS.test(c.example_vi), `card ${c.id} example_vi="${c.example_vi}"`).toBe(true);
    }
  });

  it('TC-SEEDVI-04 every flashcard topic_id resolves to a seeded topic', () => {
    const topicIds = new Set(seedTopics.map(t => t.id));
    for (const c of seedFlashcards) {
      expect(topicIds.has(c.topic_id), `card ${c.id} -> ${c.topic_id}`).toBe(true);
    }
  });

  it('TC-SEEDVI-05 flashcard ids are unique (stable migration keys)', () => {
    const ids = seedFlashcards.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
