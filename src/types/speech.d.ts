// Shared Web Speech API typedefs (previously duplicated inline in
// ConversationPage and PronunciationPage). No `declare global` Window
// augmentation here to avoid colliding with lib.dom's own SpeechRecognition
// types; hooks read the constructor via (window as any).

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

export interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (e: Event) => void;
  onresult: (e: SpeechRecognitionEvent) => void;
  onerror: (e: any) => void;
  onend: () => void;
}
