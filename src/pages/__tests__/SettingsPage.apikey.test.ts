import { describe, it, expect } from 'vitest';

// CH1 (diagnosis 2026-06-06, fix-1): the AI API key in SettingsPage
// is masked by type="password" + a show/hide toggle (good), but the
// underlying React state is still visible to anyone with DevTools
// (`localStorage.getItem('learnt_ai_config')` or React DevTools).
// We CANNOT fully hide a value that lives in the browser - the
// server-side Tier C fix (proxy via Edge Function) is the only way.
// What we CAN do for Tier A/D is:
//
//   1. Add a "Clear API key" button that wipes it from state +
//      localStorage + ai_configs row.
//   2. Add an auto-hide timer: if the user reveals the key, it
//      auto-hides after 30s so shoulder-surfing windows are short.
//   3. Make the SECURITY NOTE more prominent (warning-styled,
//      with a visible shield icon) so users understand the
//      "localStorage" tradeoff before they paste a key.
//
// These tests pin the mitigations at the source level (UI tests
// would require @testing-library/react, which the project doesn't
// currently use - all existing tests are pure-function or static).
// The pure-function behavior is covered by aiConfigService.test.ts;
// these tests catch "I forgot to add the clear button" regressions.

describe('SettingsPage API-key mitigations (CH1) [TC-APIKEY-UI]', () => {
  // (vitest runs in Node; @ts-ignore because tsconfig.app.json only
  //  loads vite/client types, not node.)
  // @ts-ignore -- node modules not in app tsconfig types
  const fsModule = require('fs') as typeof import('fs');
  // @ts-ignore
  const pathModule = require('path') as typeof import('path');
  // @ts-ignore
  const urlModule = require('url') as typeof import('url');

  const here = pathModule.dirname(urlModule.fileURLToPath(import.meta.url));
  const pagePath = pathModule.resolve(here, '../../pages/SettingsPage.tsx');
  const src = fsModule.readFileSync(pagePath, 'utf8');

  it('TC-APIKEY-UI-01 ships a "Clear API key" button (handler + label)', () => {
    // The handler should reset aiApiKey state to '' and call
    // updateConfig with apiKey=''. The button should be labeled
    // "Clear" in EN and "Xoá" in VI to match the existing
    // bilingual pattern.
    expect(src).toMatch(/handleClearApiKey|clearApiKey/);
    expect(src).toMatch(/['"]Clear(?: API key)?['"]/i);
    expect(src).toMatch(/['"]Xo[aá](?:\s*kh[oó]a)?\s*API['"]?/i);
  });

  it('TC-APIKEY-UI-02 auto-hides the key after 30s of being revealed (useEffect + setTimeout cleanup)', () => {
    // The auto-hide pattern: a useEffect that watches showApiKey,
    // and if it becomes true, sets a 30s setTimeout that calls
    // setShowApiKey(false). The effect MUST clean up on unmount
    // or when showApiKey changes (return () => clearTimeout).
    // Accept either `if (!showApiKey) {...} setTimeout(...)` or
    // `showApiKey && setTimeout(...)` patterns.
    expect(src).toMatch(/showApiKey[\s\S]{0,400}setTimeout/);
    expect(src).toMatch(/clearTimeout/);
    expect(src).toMatch(/30[_]?000/);  // 30s in ms
  });

  it('TC-APIKEY-UI-03 the SECURITY NOTE is visibly styled (warning, not gray)', () => {
    // Find the EN string body (the user-visible text) - that's the
    // second occurrence of the "Your API key is stored" phrase.
    const phrase = 'Your API key is stored in this browser';
    const first = src.indexOf(phrase);
    expect(first).toBeGreaterThan(-1);
    // Look BEHIND from the phrase (within 800 chars) for the warning
    // styling on the wrapping div. The div opens before the inner
    // span/text.
    const slice = src.slice(Math.max(0, first - 800), first);
    expect(slice).toMatch(/var\(--warning\)|text-warning|color:\s*['"]?var\(--warning/);
  });

  it('TC-APIKEY-UI-04 still uses type="password" by default (regression guard for the existing mask)', () => {
    expect(src).toMatch(/type=\{showApiKey\s*\?\s*['"]text['"]\s*:\s*['"]password['"]\}/);
  });
});
