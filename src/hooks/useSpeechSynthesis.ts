import { useState, useRef, useEffect } from 'react';

export interface UseSpeechSynthesisReturn {
  speak: (text: string, opts?: { lang?: string }) => void;
  cancel: () => void;
  isSupported: boolean;
}

/**
 * Wraps the native speechSynthesis API. Voices are cached and refreshed on the
 * `voiceschanged` event so speak() works even when the voice list is empty on
 * the first synchronous getVoices() call.
 */
export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSupported] = useState(
    typeof window !== 'undefined' && 'speechSynthesis' in window
  );
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!isSupported) return;

    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [isSupported]);

  const speak = (text: string, opts?: { lang?: string }) => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = opts?.lang ?? 'en-US';
    const voice = voicesRef.current.find(
      (v) => v.lang.startsWith('en') && v.name.includes('Google')
    );
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  const cancel = () => {
    if (isSupported) window.speechSynthesis.cancel();
  };

  return { speak, cancel, isSupported };
}
