/**
 * pronunciationChallenges.ts — Pronunciation Drill seed/fallback content.
 *
 * Owns the `PronunciationChallenge` type and the curated seed list used as
 * fallback when no Vocabulary-derived sentences are available. This is content,
 * not persistence — kept separate from `pronunciationAttemptRepository` so the
 * repo stays pure (storage only) and the Pronunciation Drill domain still has
 * one home for its baseline content.
 */

export interface PronunciationChallenge {
  id: string;
  text: string;
  phonetic: string;
  translation_vi: string;
}

export const seedPronunciationChallenges: PronunciationChallenge[] = [
  {
    id: 'pron-1',
    text: 'Algorithms process data with incredible speed.',
    phonetic: '/ˈæl.ɡə.rɪ.ðəmz ˈprəʊ.ses ˈdeɪ.tə wɪð ɪnˈkred.ə.bəl spiːd/',
    translation_vi: 'Các thuật toán xử lý dữ liệu với tốc độ đáng kinh ngạc.',
  },
  {
    id: 'pron-2',
    text: 'Education opens doors to unexpected opportunities.',
    phonetic: '/ˌed.jʊˈkeɪ.ʃən ˈəʊ.pənz dɔːz tuː ˌʌn.ɪkˈspek.tɪd ˌɒp.əˈtʃuː.nə.tiz/',
    translation_vi: 'Giáo dục mở ra cánh cửa dẫn đến những cơ hội bất ngờ.',
  },
  {
    id: 'pron-3',
    text: 'Artificial intelligence can simulate human conversation.',
    phonetic: '/ˌɑː.tɪˈfɪʃ.əl ɪnˈtel.ɪ.dʒəns kæn ˈsɪm.jə.leɪt ˈhjuː.mən ˌkɒn.vəˈseɪ.ʃən/',
    translation_vi: 'Trí tuệ nhân tạo có thể mô phỏng cuộc trò chuyện của con người.',
  },
  {
    id: 'pron-4',
    text: 'Consistency is crucial when learning a foreign language.',
    phonetic: '/kənˈsɪs.tən.si ɪz ˈkruː.ʃəl wen ˈlɜː.nɪŋ ə ˈfɒr.ən ˈlæŋ.ɡwɪdʒ/',
    translation_vi: 'Sự nhất quán là rất quan trọng khi học một ngoại ngữ.',
  },
];
