/**
 * PCM16 audio decoding helpers for the Zephyr TTS tier.
 *
 * The `ai-speech` Edge Function returns `{ audioBase64, mimeType: "audio/L16",
 * sampleRate: 24000 }` (see contract.yaml SpeechResponse) — raw little-endian
 * PCM16 mono. The browser cannot decode raw PCM via `decodeAudioData`
 * (that path expects a container like WAV), so we decode it by hand:
 *
 *   base64 -> Uint8Array (atob) -> Int16 LE view -> Float32 (sample / 32768)
 *
 * The caller turns the resulting Float32Array into an AudioBuffer at the
 * contract's `sampleRate` and plays it through a single module-level
 * AudioContext. These functions are intentionally pure (no Web Audio) so the
 * decode is unit-testable without a real AudioContext.
 */

/** Decode a base64 string to raw bytes using the browser `atob`. */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert little-endian PCM16 bytes to Float32 samples in roughly [-1, 1).
 * Uses a DataView so the result is correct regardless of host endianness.
 * Trailing odd byte (if any) is ignored.
 */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    // true = little-endian; divide by 32768 to map Int16 -> Float32 (design §"Audio playback")
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

/**
 * Decode a base64 `audio/L16` PCM16 LE mono payload to Float32 samples.
 * Combines `base64ToUint8Array` + `pcm16ToFloat32`. Throws if the base64 is
 * malformed (atob throws) — callers treat any throw as a decode failure and
 * fall back to speechSynthesis.
 */
export function decodePcm16Base64(base64: string): Float32Array {
  return pcm16ToFloat32(base64ToUint8Array(base64));
}

/**
 * Stable in-memory cache key for a TTS utterance.
 *
 * Mirrors the design's pure `cacheKey` seam: FNV-1a (32-bit) over
 * `voice + '\u0000' + text`, returned as a base36 string. Identical text+voice
 * yields the same key so a repeat `speak()` is served from the AudioBuffer
 * cache and never re-calls the Edge Function (NFR-02 cache-hit).
 */
export function ttsCacheKey(text: string, voice: string): string {
  const input = `${voice}\u0000${text}`;
  let hash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit space via Math.imul
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 forces an unsigned 32-bit integer before stringifying
  return (hash >>> 0).toString(36);
}
