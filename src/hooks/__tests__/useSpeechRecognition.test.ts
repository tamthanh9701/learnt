import { describe, it, expect } from 'vitest';
import { getSpeechErrorMessageKey } from '../useSpeechRecognition';

// AC-E1.7: speech recognition error codes map to friendly localized message keys.
describe('getSpeechErrorMessageKey', () => {
  it('maps permission-denied codes to micDenied', () => {
    expect(getSpeechErrorMessageKey('not-allowed')).toBe('speech.micDenied');
    expect(getSpeechErrorMessageKey('service-not-allowed')).toBe('speech.micDenied');
  });

  it('maps no-speech to noSpeech', () => {
    expect(getSpeechErrorMessageKey('no-speech')).toBe('speech.noSpeech');
  });

  it('maps unknown/other codes to the generic inputError key', () => {
    expect(getSpeechErrorMessageKey('audio-capture')).toBe('speech.inputError');
    expect(getSpeechErrorMessageKey('network')).toBe('speech.inputError');
    expect(getSpeechErrorMessageKey('')).toBe('speech.inputError');
  });

  it('returns keys that exist in the i18n catalog', async () => {
    const en = (await import('../../i18n/en.json')).default as Record<string, any>;
    for (const code of ['not-allowed', 'no-speech', 'anything']) {
      const key = getSpeechErrorMessageKey(code);
      const [group, leaf] = key.split('.');
      expect(en[group]?.[leaf], key).toBeTypeOf('string');
    }
  });
});
