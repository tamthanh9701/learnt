// @ts-check
//
// generate-vocab.mjs — OFFLINE vocab seed generator (D10/D11, BR-01..06).
//
// WHAT: reads NGSL-family word lists (one word per line) from scripts/wordlists/<track>.txt,
// calls Gemini to enrich each word into the 7 SeedFlashcard content fields (incl. Vietnamese),
// then writes src/data/seedVocabulary.generated.ts exporting `generatedTopics` + `generatedFlashcards`
// typed by the EXISTING SeedTopic / SeedFlashcard interfaces (imported, never redefined).
//
// WHY OFFLINE: the Vocabulary load path must issue ZERO runtime AI calls (BR-05, NFR-34). This
// script is run BY THE USER at build time, OUTSIDE the app bundle. It lives under scripts/ so
// `tsc -b` (tsconfig.app.json include:["src"]) never type-checks it and `npm run build` never
// runs it. It is a .mjs Node script — not part of the Vite graph, not imported by any src/** file.
//
// RUN (PowerShell, from the app root):
//   $env:GEMINI_API_KEY="your_real_key"; node scripts/generate-vocab.mjs
// Optional model override:
//   $env:GEMINI_API_KEY="..."; $env:GEMINI_MODEL="gemini-2.5-flash"; node scripts/generate-vocab.mjs
//
// SECURITY (NFR-28): the key is read from process.env.GEMINI_API_KEY at generation time ONLY.
// It is NEVER written into seedVocabulary.generated.ts and NEVER committed. Do not paste the key
// into this file or any wordlist.
//
// DETERMINISM (NFR-34): same wordlists + pinned model + pinned prompt => reproducible output.
//
// NOTE: the bundled scripts/wordlists/*.txt are SMALL DEMO lists (~8-10 words/track) so the script
// is runnable as a demo. Replace them with full NGSL-family lists (~100-150 words/track) before a
// real content build — see scripts/README-vocab.md.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_ROOT = resolve(__dirname, "..");
const WORDLIST_DIR = join(__dirname, "wordlists");
const OUTPUT_FILE = join(APP_ROOT, "src", "data", "seedVocabulary.generated.ts");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_HOST = "https://generativelanguage.googleapis.com";

/** Per-call timeout (inline withTimeout-equivalent; the script is standalone). */
const CALL_TIMEOUT_MS = 30_000;
/** Polite delay between calls — the key hit 429 before; stay rate-limit friendly. */
const DELAY_BETWEEN_CALLS_MS = 1_200;
/** Transient-failure retries per word. */
const MAX_RETRIES = 2;

/**
 * Track -> Topic mapping (D10/BR-03). Each NGSL-family list maps to one Topic.
 * The 4 EXISTING topics (topic-business/technology/travel/daily-life) are PRESERVED
 * untouched in seedVocabulary.ts; these NEW topic rows are additive (distinct ids).
 * The generated `id` scheme is `card-<track>-<n>` so it never collides with the
 * existing hardcoded card-biz-N / card-tech-N / ... ids (BR-04 additive-only).
 */
const TRACKS = [
  {
    track: "essential",
    sourceList: "NGSL-core",
    topic: {
      id: "topic-essential",
      name_en: "Essential English",
      name_vi: "Tiếng Anh Thiết Yếu",
      description_en: "Core high-frequency words every learner needs (NGSL core).",
      description_vi: "Những từ vựng cốt lõi tần suất cao mà mọi người học cần (NGSL core).",
    },
  },
  {
    track: "academic",
    sourceList: "NAWL",
    topic: {
      id: "topic-academic",
      name_en: "Academic English",
      name_vi: "Tiếng Anh Học Thuật",
      description_en: "Academic vocabulary for study, research, and exams (NAWL).",
      description_vi: "Từ vựng học thuật cho việc học, nghiên cứu và thi cử (NAWL).",
    },
  },
  {
    track: "toeic",
    sourceList: "TSL",
    topic: {
      id: "topic-toeic",
      name_en: "TOEIC English",
      name_vi: "Tiếng Anh TOEIC",
      description_en: "Workplace and test vocabulary for the TOEIC exam (TSL).",
      description_vi: "Từ vựng công sở và luyện thi cho kỳ thi TOEIC (TSL).",
    },
  },
  {
    track: "business",
    sourceList: "BSL",
    topic: {
      id: "topic-business-extended",
      name_en: "Business English (Extended)",
      name_vi: "Tiếng Anh Thương Mại (Mở Rộng)",
      description_en: "Extended business vocabulary for professional communication (BSL).",
      description_vi: "Từ vựng thương mại mở rộng cho giao tiếp chuyên nghiệp (BSL).",
    },
  },
];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Inline withTimeout: wraps fetch in an AbortController so a hung call can never
 * stall the whole generation (mirrors the app's src/lib/timeout.ts intent).
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} ms
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, init, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate the 7 content fields are present + non-empty after trim (BR-01).
 * Returns the list of missing/empty field names ([] === valid).
 * @param {Record<string, unknown>} card
 * @returns {string[]}
 */
function missingFields(card) {
  const required = [
    "word",
    "part_of_speech",
    "phonetic",
    "definition_en",
    "definition_vi",
    "example_en",
    "example_vi",
  ];
  return required.filter((k) => typeof card[k] !== "string" || /** @type {string} */ (card[k]).trim().length === 0);
}

/**
 * Extract the first balanced {...} JSON object from a possibly prose-wrapped string,
 * then JSON.parse it. Returns null on failure (never throws).
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
function tolerantParseObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // fall through to balanced-brace extraction
  }
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gemini enrichment (fills the 7 SeedFlashcard content fields incl. Vietnamese)
// ---------------------------------------------------------------------------

/**
 * Gemini responseSchema mirroring SeedFlashcard minus id/topic_id (be-design.md §5.3).
 * Using structured output (responseMimeType application/json) for reliable parsing.
 */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string" },
    part_of_speech: { type: "string" },
    phonetic: { type: "string" },
    definition_en: { type: "string" },
    definition_vi: { type: "string" },
    example_en: { type: "string" },
    example_vi: { type: "string" },
  },
  required: [
    "word",
    "part_of_speech",
    "phonetic",
    "definition_en",
    "definition_vi",
    "example_en",
    "example_vi",
  ],
};

/**
 * Build the strict enrichment prompt for one word.
 * BR-01: every field non-empty; definition_vi (Vietnamese) is the highest-risk field
 * (DB NOT NULL) — the prompt explicitly demands a non-empty Vietnamese definition.
 * @param {string} word
 */
function buildPrompt(word) {
  return [
    `You are an English-Vietnamese lexicographer creating a vocabulary flashcard for a Vietnamese intermediate English learner.`,
    `For the English word: "${word}"`,
    `Return ONLY a JSON object with exactly these 7 fields, all NON-EMPTY:`,
    `- word: the headword (use "${word}", normalized capitalization)`,
    `- part_of_speech: short tag like "n.", "v.", "adj.", "adv."`,
    `- phonetic: IPA transcription wrapped in slashes, e.g. "/kəˈlæb.ə.reɪt/"`,
    `- definition_en: a clear English definition (one sentence)`,
    `- definition_vi: the Vietnamese definition/meaning (REQUIRED, must be in Vietnamese, never empty)`,
    `- example_en: a natural English example sentence using the word`,
    `- example_vi: the Vietnamese translation of that example sentence`,
    `Do not include id or topic_id. Do not add commentary.`,
  ].join("\n");
}

/**
 * Enrich a single word via Gemini. Retries on transient failure. Returns the parsed
 * 7-field object, or null if it could not be produced cleanly (caller skips+logs).
 * @param {string} apiKey
 * @param {string} word
 * @returns {Promise<Record<string, string> | null>}
 */
async function enrichWord(apiKey, word) {
  const url = `${GEMINI_HOST}/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: buildPrompt(word) }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
        },
        CALL_TIMEOUT_MS,
      );

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 5;
        console.warn(`  [429] rate limited on "${word}" — waiting ${retryAfter}s (attempt ${attempt + 1})`);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) {
        console.warn(`  [${res.status}] upstream error on "${word}" (attempt ${attempt + 1})`);
        await sleep(DELAY_BETWEEN_CALLS_MS);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string" || text.trim().length === 0) {
        console.warn(`  [empty] no text returned for "${word}" (attempt ${attempt + 1})`);
        continue;
      }

      const parsed = tolerantParseObject(text);
      if (!parsed) {
        console.warn(`  [parse] could not parse JSON for "${word}" (attempt ${attempt + 1})`);
        continue;
      }

      const missing = missingFields(parsed);
      if (missing.length > 0) {
        console.warn(`  [incomplete] "${word}" missing/empty: ${missing.join(", ")} (attempt ${attempt + 1})`);
        continue;
      }

      // Normalize: trim all 7 fields.
      return {
        word: String(parsed.word).trim(),
        part_of_speech: String(parsed.part_of_speech).trim(),
        phonetic: String(parsed.phonetic).trim(),
        definition_en: String(parsed.definition_en).trim(),
        definition_vi: String(parsed.definition_vi).trim(),
        example_en: String(parsed.example_en).trim(),
        example_vi: String(parsed.example_vi).trim(),
      };
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network";
      console.warn(`  [${reason}] error on "${word}" (attempt ${attempt + 1})`);
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wordlist loading + dedupe
// ---------------------------------------------------------------------------

/**
 * Read a track wordlist: one word per line. Blank lines and lines starting with
 * `#` (comments) are ignored. Dedupe within a track by lowercase word (BR-03/05).
 * @param {string} track
 * @returns {Promise<string[]>}
 */
async function loadWordlist(track) {
  const file = join(WORDLIST_DIR, `${track}.txt`);
  if (!existsSync(file)) {
    console.warn(`  [skip-track] no wordlist at ${file}`);
    return [];
  }
  const text = await readFile(file, "utf8");
  /** @type {string[]} */
  const words = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim();
    if (word.length === 0 || word.startsWith("#")) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words;
}

// ---------------------------------------------------------------------------
// Codegen — emit src/data/seedVocabulary.generated.ts
// ---------------------------------------------------------------------------

/**
 * Serialize a JS string to a safe single-quoted TS literal (escape backslash + quote).
 * @param {string} s
 */
function tsString(s) {
  return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, " ")}'`;
}

/**
 * Render the generated TS module. Imports the EXISTING SeedTopic/SeedFlashcard types
 * (type-only import — verbatimModuleSyntax safe) and exports the two arrays.
 * @param {{id:string,name_en:string,name_vi:string,description_en:string,description_vi:string}[]} topics
 * @param {Record<string,string> & {id:string,topic_id:string}[]} cards
 */
function renderModule(topics, cards) {
  const header = [
    "// AUTO-GENERATED by scripts/generate-vocab.mjs — DO NOT EDIT BY HAND.",
    "// Regenerate with: $env:GEMINI_API_KEY=\"...\"; node scripts/generate-vocab.mjs",
    "// Contains ZERO secrets (NFR-28). Committed seed -> 0 runtime AI calls (BR-05/NFR-34).",
    "",
    "import type { SeedTopic, SeedFlashcard } from './seedVocabulary';",
    "",
  ].join("\n");

  const topicLines = topics
    .map(
      (t) =>
        `  {\n` +
        `    id: ${tsString(t.id)},\n` +
        `    name_en: ${tsString(t.name_en)},\n` +
        `    name_vi: ${tsString(t.name_vi)},\n` +
        `    description_en: ${tsString(t.description_en)},\n` +
        `    description_vi: ${tsString(t.description_vi)},\n` +
        `  },`,
    )
    .join("\n");

  const cardLines = cards
    .map(
      (c) =>
        `  {\n` +
        `    id: ${tsString(c.id)},\n` +
        `    topic_id: ${tsString(c.topic_id)},\n` +
        `    word: ${tsString(c.word)},\n` +
        `    part_of_speech: ${tsString(c.part_of_speech)},\n` +
        `    phonetic: ${tsString(c.phonetic)},\n` +
        `    definition_en: ${tsString(c.definition_en)},\n` +
        `    definition_vi: ${tsString(c.definition_vi)},\n` +
        `    example_en: ${tsString(c.example_en)},\n` +
        `    example_vi: ${tsString(c.example_vi)},\n` +
        `  },`,
    )
    .join("\n");

  return (
    header +
    "\nexport const generatedTopics: SeedTopic[] = [\n" +
    topicLines +
    "\n];\n\nexport const generatedFlashcards: SeedFlashcard[] = [\n" +
    cardLines +
    "\n];\n"
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error(
      "ERROR: GEMINI_API_KEY is not set.\n" +
        'Run:  $env:GEMINI_API_KEY="your_real_key"; node scripts/generate-vocab.mjs',
    );
    process.exit(1);
    return;
  }

  console.log(`generate-vocab — model=${GEMINI_MODEL}`);
  console.log(`wordlists: ${WORDLIST_DIR}`);
  console.log(`output:    ${OUTPUT_FILE}\n`);

  /** @type {{id:string,name_en:string,name_vi:string,description_en:string,description_vi:string}[]} */
  const topics = [];
  /** @type {(Record<string,string> & {id:string,topic_id:string})[]} */
  const cards = [];

  let totalOk = 0;
  let totalSkipped = 0;

  for (const { track, topic } of TRACKS) {
    console.log(`\n== Track: ${track} -> ${topic.id} ==`);
    const words = await loadWordlist(track);
    if (words.length === 0) {
      console.warn(`  no words for "${track}" — skipping track`);
      continue;
    }
    topics.push(topic);

    let n = 0;
    for (const word of words) {
      const enriched = await enrichWord(apiKey, word);
      if (!enriched) {
        // BR-01: skip + log words that fail to produce all 7 fields.
        console.warn(`  SKIP "${word}" — could not produce complete card`);
        totalSkipped++;
        await sleep(DELAY_BETWEEN_CALLS_MS);
        continue;
      }
      n++;
      cards.push({
        id: `card-${track}-${n}`,
        topic_id: topic.id,
        ...enriched,
      });
      totalOk++;
      console.log(`  ok  card-${track}-${n}  ${enriched.word}`);
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
    console.log(`  track "${track}" produced ${n} cards`);
  }

  if (cards.length === 0) {
    console.error("\nERROR: 0 cards generated — refusing to write an empty seed file.");
    process.exit(1);
    return;
  }

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, renderModule(topics, cards), "utf8");

  console.log(`\nDONE: wrote ${cards.length} cards across ${topics.length} topics`);
  console.log(`  ok=${totalOk}  skipped=${totalSkipped}`);
  console.log(`  -> ${OUTPUT_FILE}`);
  console.log(
    `\nReminder: validate per-topic card counts (BR-02: ~100-150/topic) before shipping a real build.`,
  );
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

