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
  onResult?: (transcript: string) => void;
  onError?: (errorCode: string) => void;
  onEnd?: () => void;
}

export interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isSupported: boolean;
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
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const optsRef = useRef(opts);

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
        setIsListening(true);
        optsRef.current.onStart?.();
      };
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        optsRef.current.onResult?.(transcript);
      };
      recognition.onerror = (event: any) => {
        optsRef.current.onError?.(event?.error || 'error');
        setIsListening(false);
      };
      recognition.onend = () => {
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

  return { isListening, isSupported, start, stop, toggle };
}
