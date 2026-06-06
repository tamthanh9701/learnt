import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { withTimeout, TimeoutError } from '../lib/timeout';
import { decodePcm16Base64, ttsCacheKey } from '../lib/pcm';

/**
 * Tiered text-to-speech hook.
 *
 * PUBLIC SHAPE IS UNCHANGED so the existing call sites keep working untouched
 * (ConversationPage :98/:117/:241, PronunciationPage :48, ReviewPage :97):
 *   { speak(text, opts?), cancel(), isSupported }
 *
 * Internally `speak()` resolves a tier from VITE_TTS_MODE:
 *   - 'proxy'  -> Zephyr via the `ai-speech` Edge Function (server-side key),
 *                 decode base64 PCM16 @24000Hz -> AudioBuffer -> AudioContext.
 *                 ANY failure/timeout falls through to speechSynthesis.
 *   - 'direct' -> temporary dev path. CURRENTLY STUBBED: logs a warning and
 *                 falls through to speechSynthesis (see DIRECT_TIER note below).
 *   - 'off'    -> (default) the original speechSynthesis behavior, verbatim.
 *
 * Guarantees (NFR-18/21): every path resolves. A decode failure, a non-200,
 * a network error, or a 10s timeout all degrade to speechSynthesis; if even
 * that is unsupported the call ends in the `unavailable` status. No path can
 * leave a caller hanging or stick on a spinner forever.
 */

export type TtsTier = 'zephyr' | 'speech-synthesis' | 'unavailable';
export type TtsMode = 'proxy' | 'direct' | 'off';
export type TtsStatus =
  | 'idle'
  | 'synthesizing'
  | 'playing'
  | 'fallback'
  | 'unavailable';

export interface SpeakOptions {
  lang?: string;
  /** Gemini prebuilt voice for the Zephyr tier. Defaults to 'Zephyr'. */
  voice?: string;
}

export interface UseSpeechSynthesisReturn {
  /** Fire-and-forget read-aloud. Signature preserved for existing callers. */
  speak: (text: string, opts?: SpeakOptions) => void;
  /** Stop any in-flight audio (both Zephyr AudioContext + speechSynthesis). */
  cancel: () => void;
  /** True when the browser can produce audio via at least one tier. */
  isSupported: boolean;
  /** Optional per-call status; additive — callers may ignore it. */
  status: TtsStatus;
}

/** Shape of a successful `ai-speech` response (contract.yaml SpeechResponse). */
interface SpeechResponse {
  audioBase64: string;
  mimeType: string;
  sampleRate: number;
}

// ---------------------------------------------------------------------------
// Module-level singletons (shared across all hook instances / renders)
// ---------------------------------------------------------------------------

/** Default Zephyr request timeout (NFR-04/16). */
const AI_SPEECH_TIMEOUT_MS = 10_000;

/**
 * Resolve the TTS mode from the build-time env. Unknown/unset -> 'off' so the
 * app NEVER silently attempts a network tier it wasn't configured for.
 */
function resolveTtsMode(): TtsMode {
  const raw = (import.meta.env.VITE_TTS_MODE ?? '').toString().trim().toLowerCase();
  if (raw === 'proxy' || raw === 'direct' || raw === 'off') return raw;
  return 'off';
}

/**
 * In-memory decoded-audio cache keyed by ttsCacheKey(text, voice). A repeat
 * speak() of the same text+voice replays from here with 0 network calls
 * (NFR-02 cache-hit). Lives at module scope so it survives re-renders and is
 * shared across pages.
 */
const audioBufferCache = new Map<string, AudioBuffer>();

/** Single lazily-created AudioContext (autoplay policy: first speak is a click). */
let sharedAudioContext: AudioContext | null = null;
/** The currently-playing Zephyr source, so cancel() can stop it. */
let activeSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new Ctor();
  }
  return sharedAudioContext;
}

/** True if either TTS tier can run (speechSynthesis OR Web Audio AudioContext). */
function detectTtsSupport(): boolean {
  if (typeof window === 'undefined') return false;
  if ('speechSynthesis' in window) return true;
  const w = window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return !!(w.AudioContext || w.webkitAudioContext);
}

/** Build a mono AudioBuffer from decoded Float32 samples at the given rate. */
function toAudioBuffer(ctx: AudioContext, samples: Float32Array, sampleRate: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  // getChannelData().set() avoids the Float32Array<ArrayBufferLike> generic
  // mismatch that copyToChannel's signature is strict about.
  buffer.getChannelData(0).set(samples);
  return buffer;
}

/** Stop any in-flight Zephyr playback (idempotent). */
function stopActiveSource(): void {
  if (activeSource) {
    try {
      activeSource.onended = null;
      activeSource.stop();
    } catch {
      // already stopped / not started — safe to ignore
    }
    activeSource = null;
  }
}

/**
 * Play a decoded AudioBuffer through the shared AudioContext. Resolves true
 * once playback STARTS (not when it ends) so the caller can flip to `playing`
 * promptly; resolves false if no AudioContext is available (caller falls back).
 */
async function playBuffer(buffer: AudioBuffer): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  // AudioContext may start 'suspended' until a user gesture resumes it; the
  // first speak() is always behind a click on both pages, so this resolves.
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // ignore — start() below will still attempt playback
    }
  }
  stopActiveSource();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => {
    if (activeSource === source) activeSource = null;
  };
  activeSource = source;
  source.start();
  return true;
}

/**
 * The original speechSynthesis behavior, preserved verbatim as the universal
 * fallback (BR-10). Returns true if it could speak, false if unsupported.
 *
 * Exported for unit testing the cancel+speak race (CH3, 2026-06-06).
 *
 * CH3 (diagnosis 2026-06-06, fix-3): the synchronous cancel() + speak()
 * pattern is a known race on Chrome/Safari/Firefox — the still-pending
 * cancel() can kill the freshly-queued speak() utterance. Symptom: "After
 * sentence 1, the Pronunciation Drill native voice is silent on sentence
 * 2+". The fix defers speak() by 50ms (enough for cancel() to settle on
 * every supported browser per Chromium source, but small enough to be
 * imperceptible to the Learner).
 */
export function speakViaSpeechSynthesis(
  text: string,
  lang: string,
  voices: SpeechSynthesisVoice[],
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = voices.find((v) => v.lang.startsWith('en') && v.name.includes('Google'));
  if (voice) utterance.voice = voice;
  // Defer speak() so the still-pending cancel() above can drain first.
  // Without this, the new utterance can be queued and immediately killed
  // by the cancel that hasn't finished settling. 50ms is below the
  // perceptual threshold (~100ms) and above the time cancel() needs
  // across all supported browsers.
  setTimeout(() => {
    window.speechSynthesis.speak(utterance);
  }, 50);
  return true;
}

/**
 * Zephyr tier (proxy mode): fetch + decode + play, fully bounded.
 * Returns true on successful playback start; false on ANY failure so the
 * caller degrades to speechSynthesis. Never throws.
 */
async function trySpeakZephyr(text: string, voice: string): Promise<boolean> {
  const key = ttsCacheKey(text, voice);

  // Cache hit -> replay, zero network (NFR-02).
  const cached = audioBufferCache.get(key);
  if (cached) {
    return playBuffer(cached).catch(() => false);
  }

  try {
    const result = await withTimeout(
      async () =>
        supabase.functions.invoke<SpeechResponse>('ai-speech', {
          body: { text, voice },
        }),
      AI_SPEECH_TIMEOUT_MS,
      'ai-speech',
    );

    if (result.error || !result.data?.audioBase64) {
      return false; // non-200 / empty -> speechSynthesis fallback
    }

    const { audioBase64, sampleRate } = result.data;
    const ctx = getAudioContext();
    if (!ctx) return false;

    const samples = decodePcm16Base64(audioBase64);
    if (samples.length === 0) return false;

    const buffer = toAudioBuffer(ctx, samples, sampleRate || 24000);
    audioBufferCache.set(key, buffer);
    return await playBuffer(buffer);
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.warn('[useSpeechSynthesis] ai-speech timed out; using speechSynthesis');
    }
    // network error / decode error / unexpected -> fallback
    return false;
  }
}

// ---------------------------------------------------------------------------
// DIRECT_TIER decision (P1):
// 'direct' is a TEMPORARY dev-only path for calling Gemini TTS straight from
// the browser (x-goog-api-key style, like src/lib/aiClient.ts). Fully wiring it
// here would require pulling the live API key out of useAI() into this hook,
// pinning a TTS-specific Gemini model, and parsing a different audio envelope —
// all of that is out of P1 scope and higher-risk than its dev-only value.
// CHOICE: STUB-TO-FALLBACK. In 'direct' mode we log a warning + TODO and fall
// through to speechSynthesis. It stays gated behind this mode ONLY and is never
// the default. The proxy tier remains the production path (BR-08).
// ---------------------------------------------------------------------------

/**
 * Wraps tiered text-to-speech. Voices are cached + refreshed on `voiceschanged`
 * so the speechSynthesis fallback works even when the first getVoices() is empty.
 */
export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSupported] = useState(detectTtsSupport);
  const [status, setStatus] = useState<TtsStatus>('idle');
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const modeRef = useRef<TtsMode>(resolveTtsMode());
  // Monotonic id so a stale async speak() can't clobber a newer call's status.
  const callIdRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const speak = useCallback((text: string, opts?: SpeakOptions) => {
    if (!isSupported || !text) return;

    const myCallId = ++callIdRef.current;
    const lang = opts?.lang ?? 'en-US';
    const voice = opts?.voice ?? 'Zephyr';
    const mode = modeRef.current;

    // Stop whatever is currently playing before starting a new utterance.
    stopActiveSource();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    // Helper: degrade to the speechSynthesis tier, then to unavailable.
    const fallback = (markFallback: boolean) => {
      if (myCallId !== callIdRef.current) return;
      const spoke = speakViaSpeechSynthesis(text, lang, voicesRef.current);
      if (myCallId !== callIdRef.current) return;
      if (spoke) setStatus(markFallback ? 'fallback' : 'playing');
      else setStatus('unavailable');
    };

    // 'off' (default) or 'direct' (stubbed) -> speechSynthesis, no network.
    if (mode === 'off') {
      fallback(false);
      return;
    }
    if (mode === 'direct') {
      // TODO(direct-tier): wire browser-direct Gemini TTS for pre-deploy testing.
      console.warn(
        '[useSpeechSynthesis] VITE_TTS_MODE=direct is not wired (stub); using speechSynthesis.',
      );
      fallback(false);
      return;
    }

    // 'proxy' -> Zephyr tier with bounded fallback. Synthesizing spinner is
    // bounded by withTimeout inside trySpeakZephyr, so it can never stick.
    setStatus('synthesizing');
    trySpeakZephyr(text, voice)
      .then((ok) => {
        if (myCallId !== callIdRef.current) return;
        if (ok) setStatus('playing');
        else fallback(true);
      })
      .catch(() => fallback(true));
  }, [isSupported]);

  const cancel = useCallback(() => {
    callIdRef.current++;
    stopActiveSource();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setStatus('idle');
  }, []);

  return { speak, cancel, isSupported, status };
}
