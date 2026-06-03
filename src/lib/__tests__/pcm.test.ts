import { describe, it, expect } from 'vitest';
import {
  base64ToUint8Array,
  pcm16ToFloat32,
  decodePcm16Base64,
  ttsCacheKey,
} from '../pcm';

// QA S4 unit tests — PCM16 decode helpers + TTS cache key.
// Backs the Zephyr decode seam (TC-TTS-01-2) and the text-hash cache key
// (TC-TTS-03-2). All values are hand-computed / deterministic — no AudioContext.
// Re-run: npx vitest run src/lib/__tests__/pcm.test.ts

describe('base64ToUint8Array (TC-TTS-01-2 decode seam)', () => {
  it('round-trips a known base64 to its exact bytes', () => {
    // btoa('Hi') === 'SGk=' ; 'H' = 72, 'i' = 105.
    expect(Array.from(base64ToUint8Array('SGk='))).toEqual([72, 105]);
  });

  it('decodes a known little-endian PCM16 byte payload exactly', () => {
    // btoa of bytes [0x00,0x00, 0x00,0x80, 0xFF,0x7F, 0x00,0x40] === 'AAAAgP9/AEA='.
    const bytes = base64ToUint8Array('AAAAgP9/AEA=');
    expect(Array.from(bytes)).toEqual([0x00, 0x00, 0x00, 0x80, 0xff, 0x7f, 0x00, 0x40]);
  });
});

describe('pcm16ToFloat32 (TC-TTS-01-2 — LE PCM16 → Float32 in [-1, 1))', () => {
  it('0x0000 LE → 0.0', () => {
    const out = pcm16ToFloat32(new Uint8Array([0x00, 0x00]));
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(0);
  });

  it('0x0080 LE (= int16 -32768) → -1.0 (negative-sample sign check)', () => {
    // bytes [0x00, 0x80] read little-endian = 0x8000 = -32768 → -32768/32768 = -1.0
    const out = pcm16ToFloat32(new Uint8Array([0x00, 0x80]));
    expect(out[0]).toBe(-1);
  });

  it('0x4000 LE (= int16 16384) → 0.5', () => {
    const out = pcm16ToFloat32(new Uint8Array([0x00, 0x40]));
    expect(out[0]).toBe(0.5);
  });

  it('0x7FFF LE (= int16 32767, max positive) → just under 1.0, stays in [-1, 1)', () => {
    const out = pcm16ToFloat32(new Uint8Array([0xff, 0x7f]));
    // 32767/32768 = 0.999969...; must be < 1 (the half-open upper bound)
    expect(out[0]).toBeCloseTo(0.99997, 4);
    expect(out[0]).toBeLessThan(1);
    expect(out[0]).toBeGreaterThanOrEqual(-1);
  });

  it('decodes a 4-sample LE buffer to the expected Float32 sequence', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x80, 0x00, 0x40, 0x00, 0xc0]);
    // samples: 0 → 0.0 ; 0x8000 = -32768 → -1.0 ; 0x4000 = 16384 → 0.5 ; 0xC000 = -16384 → -0.5
    const out = pcm16ToFloat32(bytes);
    expect(Array.from(out)).toEqual([0, -1, 0.5, -0.5]);
  });

  it('ignores a trailing odd byte (no half-sample)', () => {
    const out = pcm16ToFloat32(new Uint8Array([0x00, 0x40, 0x7f]));
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(0.5);
  });
});

describe('decodePcm16Base64 (base64 → Float32, end-to-end of the two helpers)', () => {
  it('decodes a base64 PCM16 payload to the expected Float32 samples', () => {
    // 'AAAAgABA' = bytes [0x00,0x00, 0x00,0x80, 0x00,0x40] → [0.0, -1.0, 0.5]
    const out = decodePcm16Base64('AAAAgABA');
    expect(Array.from(out)).toEqual([0, -1, 0.5]);
  });
});

describe('ttsCacheKey (TC-TTS-03-2 — text-hash cache key)', () => {
  const voice = 'Zephyr';

  it('same (text, voice) → same key (cache hit, BR-09)', () => {
    const a = ttsCacheKey('Hello there', voice);
    const b = ttsCacheKey('Hello there', voice);
    expect(a).toBe(b);
  });

  it('different text → different key (collision-free over distinct text)', () => {
    const a = ttsCacheKey('Hello there', voice);
    const b = ttsCacheKey('Goodbye now', voice);
    expect(a).not.toBe(b);
  });

  it('same text but different voice → different key', () => {
    const a = ttsCacheKey('Hello there', 'Zephyr');
    const b = ttsCacheKey('Hello there', 'Puck');
    expect(a).not.toBe(b);
  });

  it('returns a non-empty base36 string', () => {
    const key = ttsCacheKey('Hello there', voice);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
    expect(key).toMatch(/^[0-9a-z]+$/);
  });
});
