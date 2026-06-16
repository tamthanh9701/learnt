/// <reference lib="deno.ns" />
//
// ai-generate-exercises - Gemini exercise-generator proxy Edge Function.
//
// CH7 (2026-06-07, P1-#2): exerciseService.fetchExercisesForTopic
// has invoked this function since S4, but the function file was
// never created in the fresh repo. Every call hit a 404 and the
// service silently fell back to seedExercises (the 2 hard-coded
// topics) or the inline fallback generator. In cloud mode
// Learners on Travel / Daily topics only ever saw the 2 hard-coded
// topic-generic exercises, not AI-generated ones.
//
// PURPOSE (NFR-24): keep GEMINI_API_KEY server-side. Contract
// (inferred from exerciseService.ts:208-216 and the system
// prompt at exerciseService.ts:114-147):
//   Request:  POST { topic_id: string }
//   Response: 200 { questions: ExerciseQuestion[] }  (array of 3)
//             400/401/429/500/504 as below
//
// ExerciseQuestion shape (matches exerciseService.ts:9-29):
//   { id, type ('mcq'|'cloze'|'reorder'), prompt_en, prompt_vi,
//     options? (mcq), correct_option? (mcq), sentence_with_blank?
//     (cloze), correct_answer? (cloze), scrambled_words? (reorder),
//     correct_sentence? (reorder), explanation_en, explanation_vi }
//
// RUNTIME: Deno (Deno.serve). Deployed by the USER via the
// Supabase CLI. Agent cannot deploy.
//
// verify_jwt POSTURE (NFR-25): default `verify_jwt = true`.

import { CORS_HEADERS } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { getApiKey } from "../_shared/apiKey.ts";
import {
  EXERCISE_GENERATION_RESPONSE_SCHEMA,
  buildExerciseGenerationSystemPrompt,
} from "../_shared/aiContentContracts.ts";
import { callGeminiText, type GeminiTextOutcome } from "../_shared/gemini.ts";
import { parseGeminiJson } from "../_shared/json.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "gemini-2.5-flash";

/** Server-side text guards. */
const MAX_TOPIC_LEN = 100;

/** Server-side upstream budget. */
const UPSTREAM_TIMEOUT_MS = 30_000;

const GEMINI_HOST = "https://generativelanguage.googleapis.com";

/** Structured-output schema for the 3-exercise array. */
type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "rate_limited"
  | "ai_failed"
  | "upstream_timeout";

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ParsedRequest {
  topic_id: string;
}

function validateBody(raw: unknown): { ok: true; value: ParsedRequest } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.topic_id !== "string") {
    return { ok: false, message: "topic_id is required and must be a string" };
  }
  const topic_id = body.topic_id.trim();
  if (topic_id.length === 0 || topic_id.length > MAX_TOPIC_LEN) {
    return { ok: false, message: `topic_id must be 1-${MAX_TOPIC_LEN} characters` };
  }
  return { ok: true, value: { topic_id } };
}

// ---------------------------------------------------------------------------
// Gemini call — systemPrompt + body assembly stay LOCAL; transport + text-tail
// come from the shared callGeminiText (timeoutMs is OUR local UPSTREAM_TIMEOUT_MS).
// ---------------------------------------------------------------------------

async function callGemini(apiKey: string, topicId: string) {
  const systemPrompt = buildExerciseGenerationSystemPrompt(topicId);

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: `Generate 3 English exercises for the topic: "${topicId}"` }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: EXERCISE_GENERATION_RESPONSE_SCHEMA,
    },
  };

  return callGeminiText({
    apiKey,
    host: GEMINI_HOST,
    model: MODEL,
    body,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "bad_request", "Method not allowed; use POST");
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return errorResponse(401, "unauthorized", "Missing or invalid authentication token");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = await getApiKey(supabaseUrl, serviceKey);
  if (!apiKey) {
    return errorResponse(500, "ai_failed", "Exercise-generation AI is not configured");
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return errorResponse(400, "bad_request", "Request body must be valid JSON");
  }
  const validated = validateBody(parsedBody);
  if (!validated.ok) {
    return errorResponse(400, "bad_request", validated.message);
  }

  const outcome = await callGemini(apiKey, validated.value.topic_id);

  switch (outcome.kind) {
    case "ok": {
      // Contract (header line 17) is { questions: ExerciseQuestion[] }, an
      // ARRAY. outcome.text is the raw Gemini JSON string, so parse it
      // server-side before wrapping. If it fails to parse or is the wrong
      // shape (not an array), return ai_failed instead of a bad 200 so the
      // client falls cleanly to its next tier (seed/inline) rather than
      // rejecting a malformed payload via isValidExerciseList.
      const questions = parseGeminiJson(outcome.text);
      if (!Array.isArray(questions)) {
        return errorResponse(500, "ai_failed", "Exercise-generation AI returned an unparseable response");
      }
      return jsonResponse(200, { questions });
    }
    case "rate_limited":
      return errorResponse(
        429,
        "rate_limited",
        "Exercise-generation AI temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined,
      );
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "Exercise-generation AI upstream timed out");
    case "failed":
      return errorResponse(500, "ai_failed", "Exercise-generation AI call failed");
  }
}

Deno.serve(handler);
