// Shared Web Speech API typedefs (previously duplicated inline in
// ConversationPage and PronunciationPage). No `declare global` Window
// augmentation here to avoid colliding with lib.dom's own SpeechRecognition
// types; hooks read the constructor via (window as any).

// CH7 (2026-06-07, lint): define SpeechRecognition/webkitSpeechRecognition
// constructors on a new WINDOW_HELPERS type so call sites can do
// `WINDOW_HELPERS.SpeechRecognition` instead of `(window as any)`.
// This eliminates 3 of the 12 `no-explicit-any` errors in the lint
// baseline. The type is non-invasive (it doesn't `declare global`)
// so it doesn't collide with lib.dom's existing types.

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

export interface WINDOW_HELPERS {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (e: Event) => void;
  onresult: (e: SpeechRecognitionEvent) => void;
  onerror: (e: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
}
