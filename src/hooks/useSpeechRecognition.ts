import { useState, useRef, useEffect } from 'react';
import type {
  SpeechRecognitionInstance,
  SpeechRecognitionEvent,
} from '../types/speech';

/** Map a Web Speech recognition error code to an i18n message key. */
export function getSpeechErrorMessageKey(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'speech.micDenied';
    case 'no-speech':
      return 'speech.noSpeech';
    default:
      return 'speech.inputError';
  }
}

export interface UseSpeechRecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onStart?: () => void;
  /**
   * Fires once per `isFinal` chunk with the newly-finalized text (BR-16).
   * Back-compatible: in the single-shot (default) mode this fires exactly once
   * with the full final transcript, exactly as before.
   */
  onResult?: (transcript: string) => void;
  /**
   * NEW (additive). Fires on every interim (not-yet-final) result event with the
   * live interim string, and once with '' when a chunk finalizes. Drives the
   * live transcript bubble. Optional — existing callers that ignore it are
   * unaffected.
   */
  onInterim?: (interimTranscript: string) => void;
  onError?: (errorCode: string) => void;
  onEnd?: () => void;
}

export interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isSupported: boolean;
  /**
   * NEW (additive). The live interim transcript while listening; '' when idle or
   * once a chunk finalizes. Display-only — the authoritative text flows through
   * `onResult`. Existing destructurers that don't read this are unaffected.
   */
  interimTranscript: string;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * Wraps the native Web Speech recognition API. The recognition instance is
 * created once on mount; handler closures are kept fresh via optsRef so the
 * latest callbacks are always used without re-instantiating.
 */
export function useSpeechRecognition(
  opts: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const optsRef = useRef(opts);
  // Accumulates finalized (isFinal) text across `continuous` result events so the
  // authoritative transcript is the full final accumulation, not just the last chunk.
  const finalAccumRef = useRef('');

  // Keep the latest callbacks/options without re-creating the instance.
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    const Ctor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!Ctor) {
      setIsSupported(false);
      return;
    }

    try {
      const recognition: SpeechRecognitionInstance = new Ctor();
      recognition.continuous = optsRef.current.continuous ?? false;
      recognition.interimResults = optsRef.current.interimResults ?? false;
      recognition.lang = optsRef.current.lang ?? 'en-US';

      recognition.onstart = () => {
        // Reset the accumulator at the start of each listening session so a new
        // utterance does not concatenate onto a previous one.
        finalAccumRef.current = '';
        setInterimTranscript('');
        setIsListening(true);
        optsRef.current.onStart?.();
      };
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        // Iterate from resultIndex (the first changed result) and separate
        // finalized chunks from the still-interim tail. Accumulate finalized
        // text so `onResult` always carries the full final transcript, and emit
        // the live interim tail via `onInterim` for display.
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finalAccumRef.current = (finalAccumRef.current
              ? finalAccumRef.current + ' '
              : '') + transcript.trim();
          } else {
            interim += transcript;
          }
        }

        const liveInterim = interim.trim();
        setInterimTranscript(liveInterim);
        optsRef.current.onInterim?.(liveInterim);

        // Emit the accumulated final transcript whenever a chunk finalized this
        // event. Back-compat: in single-shot mode (interimResults/continuous off)
        // every event yields exactly one isFinal result, so this fires once with
        // the full transcript — identical to the previous results[0][0] behavior.
        const hasFinal = (() => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) return true;
          }
          return false;
        })();
        if (hasFinal && finalAccumRef.current.length > 0) {
          optsRef.current.onResult?.(finalAccumRef.current);
        }
      };
      recognition.onerror = (event: any) => {
        optsRef.current.onError?.(event?.error || 'error');
        setInterimTranscript('');
        setIsListening(false);
      };
      recognition.onend = () => {
        // Interim is provisional; on stop the last final accumulation is
        // authoritative, so clear the live interim display.
        setInterimTranscript('');
        setIsListening(false);
        optsRef.current.onEnd?.();
      };

      recognitionRef.current = recognition;
    } catch {
      setIsSupported(false);
    }
  }, []);

  const start = () => {
    if (!recognitionRef.current || !isSupported) return;
    try {
      recognitionRef.current.start();
    } catch (err) {
      console.error('Speech recognition start failed:', err);
    }
  };

  const stop = () => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
  };

  const toggle = () => {
    if (isListening) stop();
    else start();
  };

  return { isListening, isSupported, interimTranscript, start, stop, toggle };
}
