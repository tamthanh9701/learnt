// CH5 (2026-06-06): source-level tests for the two new PronunciationPage
// features. The project does not currently use @testing-library/react
// (all existing tests are pure-function or static), so we assert at the
// source level - the same pattern used by SettingsPage.apikey.test.ts.
// If the project later adds a DOM testing library, these can be promoted
// to behavior tests.

// @ts-ignore -- node modules not in app tsconfig types
const fsModule = require('fs') as typeof import('fs');
// @ts-ignore
const pathModule = require('path') as typeof import('path');
// @ts-ignore
const urlModule = require('url') as typeof import('url');

import { describe, it, expect } from 'vitest';

const here = pathModule.dirname(urlModule.fileURLToPath(import.meta.url));
const pagePath = pathModule.resolve(here, '../PronunciationPage.tsx');
const src = fsModule.readFileSync(pagePath, 'utf8');

describe('PronunciationPage IPA hint (CH5) [TC-PRON-IPA-UI]', () => {
  it('TC-PRON-IPA-UI-01 renders the activePhonetic pill above the sentence', () => {
    // The page reads activePhonetic and renders a styled span
    // before the target sentence. The data-testid is for future
    // behavior tests; the visual is the same as the existing
    // fallback phonetic display.
    expect(src).toMatch(/activePhonetic/);
    expect(src).toMatch(/data-testid="pronunciation-ipa"/);
  });

  it('TC-PRON-IPA-UI-02 shows the IPA for BOTH the main pool path AND the fallback path', () => {
    // The unified treatment replaces the old "activeFallback &&
    // <phonetic>" branch with a single activePhonetic check that
    // works for both code paths.
    expect(src).toMatch(/pool\[activeIdx\]\?\.phonetic/);
    expect(src).toMatch(/FALLBACK_CHALLENGES\[activeIdx[^\]]*\]\?\.phonetic/);
  });

  it('TC-PRON-IPA-UI-03 the IPA pill is bilingual-labeled for screen readers', () => {
    expect(src).toMatch(/aria-label=\{[^}]*['"]Pronunciation hint['"]/);
    expect(src).toMatch(/aria-label=\{[^}]*['"]G[oợ]i [yý] ph[aá]t [aâ]m['"]/);
  });
});

describe('PronunciationPage TTS loading state (CH5) [TC-PRON-TTS-UI]', () => {
  it('TC-PRON-TTS-UI-01 destructures status from useSpeechSynthesis', () => {
    // The page must read ttsStatus so it can show a spinner while
    // the Zephyr Edge function is busy. If a future refactor drops
    // this, the badge will be invisible AND the button will not
    // show its loading state.
    expect(src).toMatch(/useSpeechSynthesis\(\)/);
    expect(src).toMatch(/status:\s*ttsStatus/);
  });

  it('TC-PRON-TTS-UI-02 the speak button shows a spinner + "Generating audio..." while synthesizing', () => {
    // Button text changes to "Generating audio..." (EN) or
    // "Dang tao am thanh..." (VI) when ttsStatus is 'synthesizing'.
    // The button is also disabled to prevent double-clicks.
    expect(src).toMatch(/ttsStatus === ['"]synthesizing['"][\s\S]{0,200}Generating audio/);
    expect(src).toMatch(/ttsStatus === ['"]synthesizing['"][\s\S]{0,200}[ĐD]ang t[ạa]o [âa]m thanh/);
    expect(src).toMatch(/disabled=\{ttsStatus === ['"]synthesizing['"]\}/);
  });

  it('TC-PRON-TTS-UI-03 a separate live-region badge appears under the button during synthesizing + playing', () => {
    // The badge is the authoritative accessibility cue (the button
    // text changing is decorative). It must use role="status" +
    // aria-live="polite" so SR users hear the status change.
    expect(src).toMatch(/data-testid="tts-loading-badge"/);
    expect(src).toMatch(/data-testid="tts-playing-badge"/);
    expect(src).toMatch(/aria-live="polite"/);
  });

  it('TC-PRON-TTS-UI-04 the loading badge is bilingual (EN + VI)', () => {
    expect(src).toMatch(/Contacting the AI speech service/);
    expect(src).toMatch(/[ĐD]ang li[eê]n h[ệe] d[ịi]ch v[ụu] gi[oọ]ng n[oó]i AI/);
    expect(src).toMatch(/Playing[.]{0,3}/);
    expect(src).toMatch(/[ĐD]ang ph[aá]t/);
  });
});
