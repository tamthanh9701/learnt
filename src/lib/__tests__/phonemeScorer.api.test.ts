import { describe, it, expect } from 'vitest';
import * as phonemeScorer from '../phonemeScorer';

// CH2 (diagnosis 2026-06-06, fix-2): The on-device ASR engine path in
// PronunciationPage.finalizeAttempt was a dead branch. The function
// loaded `@huggingface/transformers` (~550 kB JS + 23.5 MB WASM) and an
// ASR pipeline (~40 MB model), stored the pipeline in a ref, and then
// NEVER USED IT. The scoring fell through to the same pure
// `alignAndBand(reference, transcript)` whether the engine loaded or
// not, so the "engine path" and the "fallback path" produced
// identical results. Removing the dead branch makes the page work
// on networks where HuggingFace CDN is blocked (Vietnam, China) and
// saves ~24 MB of bandwidth per first visit.
//
// These tests pin the cleanup: the module's public API should stay
// focused on the pure functions that DO the work, and the page
// should not need to load the transformers engine at all.

describe('phonemeScorer public API [TC-PHONEME-API]', () => {
  it('TC-PHONEME-API-01 exports the pure scoring helpers (alignAndBand, buildAttempt, etc.)', () => {
    expect(typeof phonemeScorer.alignAndBand).toBe('function');
    expect(typeof phonemeScorer.buildAttempt).toBe('function');
    expect(typeof phonemeScorer.tokenizeWords).toBe('function');
    expect(typeof phonemeScorer.levenshteinRatio).toBe('function');
    expect(typeof phonemeScorer.overallBand).toBe('function');
    expect(typeof phonemeScorer.PHONEME_MODEL_ID).toBe('string');
  });

  it('TC-PHONEME-API-02 does NOT export the unused @huggingface/transformers loader (loadPhonemeEngine, transcribe)', () => {
    // After the fix: these are removed because nothing in src/ calls
    // them. (The transformers.js engine loaded but never used the
    // pipeline — pure dead code.) If a future caller really needs an
    // in-browser ASR, they should re-introduce a fresh, tested loader.
    expect((phonemeScorer as unknown as Record<string, unknown>).loadPhonemeEngine).toBeUndefined();
    expect((phonemeScorer as unknown as Record<string, unknown>).transcribe).toBeUndefined();
  });
});

describe('alignAndBand pure behavior [TC-PHONEME-ALIGN]', () => {
  it('TC-PHONEME-ALIGN-01 perfect match -> overall 1.0, every word band=good', () => {
    const r = phonemeScorer.alignAndBand('Hello world', 'hello world');
    expect(r.overall).toBe(1.0);
    expect(r.perWord).toHaveLength(2);
    expect(r.perWord.every((p) => p.band === 'good')).toBe(true);
  });

  it('TC-PHONEME-ALIGN-02 partial match -> scores are deterministic per Levenshtein ratio', () => {
    // "hello" vs "helo" (missing l) -> Levenshtein ratio 0.8 -> score 0.9 -> band good (>=0.8)
    // "world" missing entirely -> score 0.2 -> band off
    const r = phonemeScorer.alignAndBand('hello world', 'helo');
    expect(r.perWord).toHaveLength(2);
    expect(r.perWord[0].band).toBe('good');
    expect(r.perWord[1].band).toBe('off');
  });

  it('TC-PHONEME-ALIGN-03 empty reference -> overall 0, no per-word entries', () => {
    const r = phonemeScorer.alignAndBand('', 'anything');
    expect(r.overall).toBe(0);
    expect(r.perWord).toEqual([]);
  });
});

describe('buildAttempt pure behavior [TC-PHONEME-BUILD]', () => {
  it('TC-PHONEME-BUILD-01 produces a PronunciationAttempt with sentence + source_card_id + per-phoneme banding', () => {
    const a = phonemeScorer.buildAttempt('Hello world', 'card-biz-1', 'hello world');
    expect(a.sentence).toBe('Hello world');
    expect(a.source_card_id).toBe('card-biz-1');
    expect(a.phonemes).toHaveLength(2);
    expect(a.overall_band).toBe('good');
  });
});

// Bundle audit: verify the production build does not include the
// @huggingface/transformers runtime. We assert this by checking the
// dist output from a representative build (test-friendly: we read
// the page source and grep for the dynamic import path). This catches
// the "I forgot to remove an import" regression.
describe('PronunciationPage does not import @huggingface/transformers [TC-PHONEME-NO-IMPRT]', () => {
  it('TC-PHONEME-NO-IMPRT-01 the page source has no transformers dynamic import', async () => {
    // Read the page file as text and assert no transformer import. The
    // import('@huggingface/transformers') call site used to live here;
    // after the fix, it should be gone.
    // (vitest runs in Node; @ts-ignore because tsconfig.app.json only
    //  loads vite/client types, not node.)
    // @ts-ignore -- node modules not in app tsconfig types
    const fsPromises = await import('fs/promises');
    // @ts-ignore
    const urlModule = await import('url');
    // @ts-ignore
    const pathModule = await import('path');
    const pagePath = pathModule.default.resolve(
      pathModule.default.dirname(urlModule.default.fileURLToPath(import.meta.url)),
      '../../pages/PronunciationPage.tsx',
    );
    const src = await fsPromises.readFile(pagePath, 'utf8');
    expect(src).not.toMatch(/@huggingface\/transformers/);
    expect(src).not.toMatch(/loadPhonemeEngine/);
    expect(src).not.toMatch(/transcribe\b/);
    // Sanity: the pure scoring helpers SHOULD still be imported.
    expect(src).toMatch(/buildAttempt/);
  });
});
