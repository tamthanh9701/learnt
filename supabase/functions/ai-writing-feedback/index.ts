/// <reference lib="deno.ns" />
//
// ai-writing-feedback - Gemini writing-tutor proxy Edge Function (Deno).
//
// CH7 (2026-06-07, P1-#2): writingService.submitWritingContent has
// invoked this function since S4, but the function file was never
// created in the fresh repo. Every call hit a 404 and the service
// silently fell back to analyzeGrammarMock (writingService.ts:77).
// In cloud mode Learners thought they were getting real AI
// feedback on their essays when they were not.
//
// PURPOSE (NFR-24): keep GEMINI_API_KEY server-side. Contract
// (inferred from writingService.ts:209-216 and the system
// prompt at writingService.ts:175-183):
//   Request:  POST { prompt: string, content: string }
//   Response: 200 { feedback: WritingFeedback }
//             400/401/429/500/504 as below
//
// WritingFeedback shape (matches writingService.ts:13-19):
//   {
//     overall_score: number (0-100),
//     strengths: string[],
//     errors: [{ original, corrected, explanation }],
//     suggestions: string[],
//     revised_text: string
//   }
//
// RUNTIME: Deno (Deno.serve). Deployed by the USER via the
// Supabase CLI. Agent cannot deploy.
//
// verify_jwt POSTURE (NFR-25): default `verify_jwt = true`.
// Platform rejects unauthenticated requests with 401 BEFORE
// the handler runs.
//
// SECURITY: the key is read from runtime_secrets via the
// service_role key (NFR-24). It is NEVER read from the request
// body, NEVER returned in a response, and NEVER logged.

import { CORS_HEADERS } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { getApiKey } from "../_shared/apiKey.ts";
import {
  WRITING_FEEDBACK_RESPONSE_SCHEMA,
  buildWritingFeedbackSystemPrompt,
} from "../_shared/aiContentContracts.ts";
import { callGeminiText, type GeminiTextOutcome } from "../_shared/gemini.ts";
import { parseGeminiJson } from "../_shared/json.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "gemini-2.5-flash";

/** Server-side text guards. */
const MAX_PROMPT_LEN = 500;
const MAX_CONTENT_LEN = 5000;

/** Server-side upstream budget. */
const UPSTREAM_TIMEOUT_MS = 25_000;

const GEMINI_HOST = "https://generativelanguage.googleapis.com";

/** Structured-output schema mirroring WritingFeedback. The
 *  result is ALWAYS validated by the client (isValidWritingFeedback
 *  in llmValidation.ts), but schema-validity here is the first
 *  line of defense. */
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
  prompt: string;
  content: string;
}

function validateBody(raw: unknown): { ok: true; value: ParsedRequest } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.prompt !== "string") {
    return { ok: false, message: "prompt is required and must be a string" };
  }
  const prompt = body.prompt.trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LEN) {
    return { ok: false, message: `prompt must be 1-${MAX_PROMPT_LEN} characters` };
  }

  if (typeof body.content !== "string") {
    return { ok: false, message: "content is required and must be a string" };
  }
  const content = body.content.trim();
  if (content.length < 10) {
    return { ok: false, message: "content must be at least 10 characters" };
  }
  if (content.length > MAX_CONTENT_LEN) {
    return { ok: false, message: `content must be at most ${MAX_CONTENT_LEN} characters` };
  }

  return { ok: true, value: { prompt, content } };
}

// ---------------------------------------------------------------------------
// Gemini call — body assembly + prompt stay LOCAL; transport + text-tail come
// from the shared callGeminiText (timeoutMs is OUR local UPSTREAM_TIMEOUT_MS).
// ---------------------------------------------------------------------------

async function callGemini(apiKey: string, prompt: string, content: string): Promise<GeminiTextOutcome> {
  const systemPrompt = buildWritingFeedbackSystemPrompt();

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: `Topic: ${prompt}\n\nEssay:\n${content}` }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: WRITING_FEEDBACK_RESPONSE_SCHEMA,
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
    return errorResponse(500, "ai_failed", "Writing-feedback AI is not configured");
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

  const { prompt, content } = validated.value;
  const outcome = await callGemini(apiKey, prompt, content);

  switch (outcome.kind) {
    case "ok": {
      // Contract (header line 16) is { feedback: WritingFeedback }, an
      // OBJECT. outcome.text is the raw Gemini JSON string, so parse it
      // server-side before wrapping. If it fails to parse or is the wrong
      // shape (not a plain object), return ai_failed instead of a bad 200
      // so the client falls cleanly to its next tier rather than rejecting
      // a malformed payload and silently dropping to mock.
      const feedback = parseGeminiJson(outcome.text);
      if (typeof feedback !== "object" || feedback === null || Array.isArray(feedback)) {
        return errorResponse(500, "ai_failed", "Writing-feedback AI returned an unparseable response");
      }
      return jsonResponse(200, { feedback });
    }
    case "rate_limited":
      return errorResponse(
        429,
        "rate_limited",
        "Writing-feedback AI temporarily rate limited, please retry",
        outcome.retryAfter ? { "Retry-After": outcome.retryAfter } : undefined,
      );
    case "upstream_timeout":
      return errorResponse(504, "upstream_timeout", "Writing-feedback AI upstream timed out");
    case "failed":
      return errorResponse(500, "ai_failed", "Writing-feedback AI call failed");
  }
}

Deno.serve(handler);
