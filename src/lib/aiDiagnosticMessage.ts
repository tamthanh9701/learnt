/**
 * Human-readable, localized messages for AI fallback diagnostics (G3,
 * diagnosis 2026-06-05).
 *
 * The learning flows (Conversation / Writing / Exercise) degrade gracefully
 * to a local mock when the configured AI provider can't be used. Pre-G3 this
 * was silent — the Learner saw a generic response with no idea the real AI
 * never ran ("gemini api won't load"). This helper turns the structured
 * `AIDiagnostic` into a sentence the Learner can act on (e.g. quota exhausted
 * -> switch to gemini-2.5-flash in Settings).
 *
 * Kept separate from aiClient.ts so it has zero coupling to fetch/network and
 * can be unit-tested as a pure function.
 */

import type { AIDiagnostic } from './aiClient';

/** The model we know is reliably available on the Gemini free tier (verified
 *  2026-06-05; see runbook §8.3). Surfaced as the suggested swap target. */
const SUGGESTED_FREE_MODEL = 'gemini-2.5-flash';

/**
 * Format an AIDiagnostic into a localized, actionable message.
 *
 * @param d   the diagnostic emitted by a learning flow's onDiagnostic callback
 * @param isEn true for English, false for Vietnamese
 * @returns a single human-readable sentence (no markdown)
 */
export function formatAIDiagnostic(d: AIDiagnostic, isEn: boolean): string {
  const model = d.model ?? 'AI';
  switch (d.reason) {
    case 'quota':
      return isEn
        ? `The AI model "${model}" has hit its free-tier quota, so a basic response is shown. Switch to ${SUGGESTED_FREE_MODEL} in Settings, or wait a few minutes and try again.`
        : `Mô hình AI "${model}" đã hết hạn ngạch miễn phí nên đang hiển thị câu trả lời cơ bản. Hãy đổi sang ${SUGGESTED_FREE_MODEL} trong Cài đặt, hoặc đợi vài phút rồi thử lại.`;
    case 'rate_limit': {
      const secs = d.retryAfter && d.retryAfter > 0 ? d.retryAfter : null;
      return isEn
        ? `The AI model "${model}" is rate-limited right now. ${secs ? `Wait ${secs}s` : 'Wait a moment'} and try again. (Showing a basic response for now.)`
        : `Mô hình AI "${model}" đang bị giới hạn tốc độ. ${secs ? `Đợi ${secs}s` : 'Đợi một lát'} rồi thử lại. (Đang hiển thị câu trả lời cơ bản.)`;
    }
    case 'auth':
      return isEn
        ? `Your API key was rejected by "${model}". Check the key in Settings — it may be wrong, expired, or revoked. (Showing a basic response for now.)`
        : `Khoá API của bạn bị "${model}" từ chối. Hãy kiểm tra khoá trong Cài đặt — có thể sai, hết hạn hoặc đã bị thu hồi. (Đang hiển thị câu trả lời cơ bản.)`;
    case 'invalid_shape':
      return isEn
        ? `The AI replied but its answer didn't match the expected format, so a basic response is shown. Try again, or switch model in Settings.`
        : `AI đã trả lời nhưng không đúng định dạng mong đợi nên đang hiển thị câu trả lời cơ bản. Hãy thử lại, hoặc đổi mô hình trong Cài đặt.`;
    case 'not_configured':
      return isEn
        ? `No AI provider is configured, so you're seeing basic practice content. Add your API key in Settings to get personalized AI responses.`
        : `Chưa cấu hình nhà cung cấp AI nên bạn đang thấy nội dung luyện tập cơ bản. Hãy thêm khoá API trong Cài đặt để nhận phản hồi AI cá nhân hoá.`;
    case 'edge_unavailable':
      return isEn
        ? `The AI service isn't reachable right now, so a basic response is shown. Add your own API key in Settings for direct AI responses.`
        : `Hiện không kết nối được dịch vụ AI nên đang hiển thị câu trả lời cơ bản. Hãy thêm khoá API của riêng bạn trong Cài đặt để nhận phản hồi AI trực tiếp.`;
    case 'error':
    default:
      return isEn
        ? `The AI couldn't be reached (${d.message || 'unknown error'}), so a basic response is shown. Check your connection or try again.`
        : `Không thể kết nối AI (${d.message || 'lỗi không xác định'}) nên đang hiển thị câu trả lời cơ bản. Hãy kiểm tra kết nối hoặc thử lại.`;
  }
}
