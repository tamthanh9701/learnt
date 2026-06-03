# Vocab seed generator (`scripts/generate-vocab.mjs`)

Offline, build-time generator for `src/data/seedVocabulary.generated.ts` (D10/D11, BR-01..06).
**Run by the developer/user — never at app runtime, never in the bundle.**

It reads NGSL-family word lists, enriches each word into the 7 `SeedFlashcard` content
fields (including Vietnamese) via Gemini, and writes a committed TypeScript seed module.
The Vocabulary load path then issues **zero** runtime AI calls (BR-05 / NFR-34).

---

## Why this lives outside `src/`

- `tsconfig.app.json` has `include: ["src"]`, so `tsc -b` never type-checks this `.mjs` script.
- No `src/**` file imports it, so Vite never pulls it into the app bundle.
- It therefore **cannot break `npm run build`** and adds **0 KB** to the client bundle.

## Security (NFR-28)

- The Gemini key is read from `process.env.GEMINI_API_KEY` at generation time **only**.
- It is **never** written into `seedVocabulary.generated.ts` and **never** committed.
- Do not paste a key into this file or any wordlist.

## Run command (PowerShell, from the app root)

```powershell
$env:GEMINI_API_KEY="your_real_gemini_key"; node scripts/generate-vocab.mjs
```

Optional model override (defaults to `gemini-2.5-flash`):

```powershell
$env:GEMINI_API_KEY="..."; $env:GEMINI_MODEL="gemini-2.5-flash"; node scripts/generate-vocab.mjs
```

bash/zsh equivalent:

```bash
GEMINI_API_KEY="your_real_gemini_key" node scripts/generate-vocab.mjs
```

## Input: word lists

One word per line in `scripts/wordlists/<track>.txt`. Blank lines and `#` comments are ignored.
Tracks → Topics (BR-03):

| Track file        | Source list | Target Topic id            |
|-------------------|-------------|----------------------------|
| `essential.txt`   | NGSL-core   | `topic-essential`          |
| `academic.txt`    | NAWL        | `topic-academic`           |
| `toeic.txt`       | TSL         | `topic-toeic`              |
| `business.txt`    | BSL         | `topic-business-extended`  |

> The bundled wordlists are **small DEMO lists (~10 words/track)** so the script is runnable
> as a demo. **Replace them with full NGSL-family lists (~100–150 words/track, BR-02)** before
> a real content build. The 4 existing topics in `seedVocabulary.ts`
> (`topic-business/technology/travel/daily-life`) are preserved untouched; these are additive
> new topics with non-colliding `card-<track>-<n>` ids (BR-04).

## Output

`src/data/seedVocabulary.generated.ts`, exporting:

```ts
export const generatedTopics: SeedTopic[]
export const generatedFlashcards: SeedFlashcard[]
```

Both arrays are typed by the **existing** `SeedTopic` / `SeedFlashcard` interfaces
(imported from `./seedVocabulary`, never redefined). The file is `git`-committed.

## Behavior / guarantees

- **Completeness (BR-01):** a card ships only if all 7 fields are non-empty after `trim()`,
  including the Vietnamese `definition_vi`. Words that fail are **skipped and logged**.
- **Dedupe (BR-03/05):** within a track, words are deduped case-insensitively.
- **Keying (BR-04):** ids are `card-<track>-<n>`, never colliding with existing seed ids.
- **Rate-limit friendly:** a small delay between calls + retry on `429`/transient errors
  (the key has hit `429` before). Each call has an inline 30s `AbortController` timeout.
- **Determinism (NFR-34):** same wordlists + pinned model + pinned prompt → reproducible output.

---

## Wiring the generated seed into the app (deferred to P2 — NOT done here)

To keep the P1 build safe and additive, `seedVocabulary.ts` is **left untouched** and the
generated file is **not yet imported** by any `src/**` module. When P2 wires it in,
`vocabularyService.ts` should merge defensively so the app still builds when the generated
file is absent:

```ts
// src/lib/vocabularyService.ts (P2 — illustrative, additive, guarded)
let generatedTopics: SeedTopic[] = [];
let generatedFlashcards: SeedFlashcard[] = [];
try {
  // Optional import — only present after the generator has been run.
  const gen = await import('../data/seedVocabulary.generated');
  generatedTopics = gen.generatedTopics ?? [];
  generatedFlashcards = gen.generatedFlashcards ?? [];
} catch {
  // No generated seed yet — fall back to the hand-curated seed only.
}

const allTopics = [...seedTopics, ...generatedTopics];
const allFlashcards = [...seedFlashcards, ...generatedFlashcards];
```

A dynamic `import()` inside `try/catch` keeps the build green whether or not
`seedVocabulary.generated.ts` exists, and the spread merge preserves the existing 4 topics
and their cards (BR-04). This wiring is intentionally **out of scope for P1**.
