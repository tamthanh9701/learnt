// Placeholder for the optional generated vocab file.
//
// This file is REPLACED by `node scripts/generate-vocab.mjs` (user-run).
// Until the user runs the build script, only the hardcoded seed vocab in
// src/data/seedVocabulary.ts is used; the PronunciationPage falls back to
// the seed pool when this file is empty.
//
// When the user runs the build script, this file is overwritten with:
//   export const generatedFlashcards: SeedFlashcard[] = [...];
//   export const generatedTopics: SeedTopic[] = [...];
//
// The empty-array default keeps the app fully functional in the meantime:
//   - Build passes (real TS exports).
//   - PronunciationPage's guarded dynamic import succeeds, sees [], and
//     silently uses the seed pool (no visible error to the user).
//   - No `tsc -b` noUnusedLocals/verbatimModuleSyntax issues.

import type { SeedFlashcard, SeedTopic } from './seedVocabulary';

export const generatedFlashcards: SeedFlashcard[] = [];

export const generatedTopics: SeedTopic[] = [];
