import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { seedPronunciationChallenges, scorePronunciationSimilarity } from '../lib/speakingService';
import type { PronunciationChallenge } from '../lib/speakingService';
import { seedFlashcards } from '../data/seedVocabulary';
import type { SeedFlashcard } from '../data/seedVocabulary';
import {
  loadPhonemeEngine,
  buildAttempt,
  type PhonemeEngineState,
} from '../lib/phonemeScorer';
import {
  bandForScore,
} from '../lib/pronunciationHistory';
import type { PhonemeScore, PronunciationSessionEntry } from '../lib/pronunciationHistory';
import {
  savePronunciationAttempt,
  fetchPronunciationHistory,
} from '../lib/speakingService';
import { useSpeechRecognition, getSpeechErrorMessageKey } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  ChevronLeft, Volume2, Mic, MicOff, AlertCircle, Sparkles, CheckCircle, X,
  HelpCircle, History, Loader2, Wifi,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Sentence pool: vocab example_en (BR-12: source for pronunciation sentences).
// Generated vocab, if present, is loaded via guarded dynamic import so it
// stays out of the main bundle per NFR-11.
// ---------------------------------------------------------------------------

interface PoolItem {
  sentence: string;
  sourceCardId: string;
}

function buildSeedPool(): PoolItem[] {
  const items: PoolItem[] = [];
  for (const card of seedFlashcards) {
    if (card.example_en && card.example_en.trim().length > 0) {
      items.push({ sentence: card.example_en.trim(), sourceCardId: card.id });
    }
  }
  return items;
}

const FALLBACK_CHALLENGES: PronunciationChallenge[] = seedPronunciationChallenges;

// BR-19: no immediate repeat. Track the last shown index.
function pickNext(pool: PoolItem[], lastIdx: number): number {
  if (pool.length <= 1) return 0;
  for (let i = 0; i < 8; i++) {
    const candidate = Math.floor(Math.random() * pool.length);
    if (candidate !== lastIdx) return candidate;
  }
  return (lastIdx + 1) % pool.length;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const PronunciationPage: React.FC = () => {
  const { locale, t } = useLanguage();
  const { user, isMock } = useAuth();
  const navigate = useNavigate();
  const isEn = locale === 'en';

  // --- Sentence pool state (lazy-load generated vocab if present) ---
  const [pool, setPool] = useState<PoolItem[]>(() => buildSeedPool());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Generated vocab is OUTSIDE the main bundle; guarded dynamic import
        // so the user can run the build script (scripts/generate-vocab.mjs)
        // to populate this file later. The file is a real TS module (empty
        // arrays by default) so the build graph is happy; Vite splits it
        // out via manualChunks into its own chunk.
        const mod = await import('../data/seedVocabulary.generated');
        const generated = (mod as { generatedFlashcards?: SeedFlashcard[] }).generatedFlashcards;
        if (!generated || cancelled) return;
        const seedIds = new Set(seedFlashcards.map((c) => c.id));
        const extras: PoolItem[] = [];
        for (const c of generated) {
          if (c.example_en && c.example_en.trim().length > 0 && !seedIds.has(c.id)) {
            extras.push({ sentence: c.example_en.trim(), sourceCardId: c.id });
          }
        }
        if (extras.length > 0) setPool([...buildSeedPool(), ...extras]);
      } catch {
        // Generated vocab does not exist yet (user has not run the build script).
        // Stay on seed pool only.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [activeIdx, setActiveIdx] = useState<number>(0);
  const activeIdxRef = useRef<number>(0);
  activeIdxRef.current = activeIdx;

  const useFallback = pool.length === 0;
  const activeSentence = useFallback
    ? (FALLBACK_CHALLENGES[activeIdx % FALLBACK_CHALLENGES.length]?.text ?? '')
    : pool[activeIdx]?.sentence ?? '';
  const activeSourceCardId = useFallback
    ? (FALLBACK_CHALLENGES[activeIdx % FALLBACK_CHALLENGES.length]?.id ?? 'fallback')
    : pool[activeIdx]?.sourceCardId ?? 'unknown';
  const activeFallback = useFallback
    ? FALLBACK_CHALLENGES[activeIdx % FALLBACK_CHALLENGES.length]
    : null;

  const handleNext = useCallback(() => {
    if (useFallback) {
      setActiveIdx((prev) => (prev + 1) % FALLBACK_CHALLENGES.length);
      return;
    }
    // BR-19: no immediate repeat. Read current from ref so the pickNext
    // call never sees stale state, then update state from the chosen value.
    const next = pickNext(pool, activeIdxRef.current);
    setActiveIdx(next);
  }, [pool, useFallback]);

  // --- Engine state + scoring state ---
  const [engineState, setEngineState] = useState<PhonemeEngineState>({ kind: 'idle' });
  const engineStateRef = useRef<PhonemeEngineState>({ kind: 'idle' });
  engineStateRef.current = engineState;

  const [speechError, setSpeechError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [wordScore, setWordScore] = useState<{ score: number; words: { word: string; isCorrect: boolean }[] } | null>(null);
  const [phonemeScores, setPhonemeScores] = useState<PhonemeScore[] | null>(null);
  const [overall, setOverall] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- History (right column on wider screens, below on mobile) ---
  const [history, setHistory] = useState<PronunciationSessionEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const loadHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const list = await fetchPronunciationHistory(user.id, isMock);
      setHistory(list);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [user, isMock]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // --- Speech + speech synth ---
  const { speak } = useSpeechSynthesis();
  const { isListening, isSupported: recognitionSupported, toggle: toggleListening } = useSpeechRecognition({
    lang: 'en-US',
    onStart: () => {
      setSpeechError(null);
      setTranscript('');
      setWordScore(null);
      setPhonemeScores(null);
      setOverall(null);
    },
    onResult: (resultText) => {
      setTranscript(resultText);
    },
    onError: (code) => setSpeechError(t(getSpeechErrorMessageKey(code))),
  });

  // --- Engine load on demand. Returns the pipeline on success, null on failure. ---
  const engineRef = useRef<Awaited<ReturnType<typeof loadPhonemeEngine>> | null>(null);
  const ensureEngine = useCallback(async () => {
    if (engineStateRef.current.kind === 'ready' && engineRef.current) return engineRef.current;
    try {
      const pipe = await loadPhonemeEngine((s) => setEngineState(s));
      engineRef.current = pipe;
      return pipe;
    } catch {
      return null;
    }
  }, []);

  // --- Score the current transcript (engine path OR fallback) and save ---
  const finalizeAttempt = useCallback(async () => {
    if (!transcript) return;
    const ref = activeSentence;

    // Try the heavy engine path first; if it fails (or state is error), fall back.
    let usedEngine = false;
    if (!useFallback) {
      const pipe = await ensureEngine();
      if (pipe) {
        try {
          // The Web Speech transcript is the ground truth for the engine
          // path here (avoids a second ASR pass on the same audio in the
          // happy path; the alignment pure function is what happy-dom covers).
          const attempt = buildAttempt(ref, activeSourceCardId, transcript);
          setPhonemeScores(attempt.phonemes);
          const overallScore = attempt.phonemes.reduce((s, p) => s + p.score, 0) /
            Math.max(1, attempt.phonemes.length);
          setOverall(overallScore);
          usedEngine = true;
          // Persist
          if (user) {
            try {
              await savePronunciationAttempt(user.id, attempt, isMock);
              void loadHistory();
            } catch { /* non-blocking */ }
          }
        } catch {
          usedEngine = false;
        }
      }
    }

    if (!usedEngine) {
      // Fallback: word-match scoring (always available).
      const ws = scorePronunciationSimilarity(ref, transcript);
      setWordScore(ws);
      // Also persist (BR-13: still useful as a history entry)
      if (user) {
        const attempt = buildAttempt(ref, activeSourceCardId, transcript);
        try {
          await savePronunciationAttempt(user.id, attempt, isMock);
          void loadHistory();
        } catch { /* non-blocking */ }
      }
    }
  }, [transcript, activeSentence, activeSourceCardId, useFallback, ensureEngine, user, isMock, loadHistory]);

  // When the learner stops speaking, run the scorer.
  useEffect(() => {
    if (!isListening && transcript && !wordScore && !phonemeScores) {
      void finalizeAttempt();
    }
  }, [isListening, transcript, wordScore, phonemeScores, finalizeAttempt]);

  const handleSpeakReference = () => { void speak(activeSentence); };
  const handleRetry = () => {
    setTranscript('');
    setWordScore(null);
    setPhonemeScores(null);
    setOverall(null);
    setError(null);
  };

  if (pool.length === 0 && FALLBACK_CHALLENGES.length === 0) {
    return (
      <div className="card no-cards-card flex flex-col align-center justify-center text-center" style={{ maxWidth: '500px', margin: '40px auto' }}>
        <HelpCircle size={48} className="icon" style={{ color: 'var(--primary)', marginBottom: 'var(--spacing-md)' }} />
        <h2 className="title-md">{t('speaking.noChallengesTitle')}</h2>
        <p className="body-sm">{t('speaking.noChallengesDesc')}</p>
      </div>
    );
  }

  return (
    <div className="pronunciation-drill-container animate-fade-in" style={{ maxWidth: '780px', margin: '0 auto' }}>
      {/* Top Navbar */}
      <div className="flex justify-between align-center" style={{ marginBottom: 'var(--spacing-md)' }}>
        <button
          className="back-btn flex align-center gap-xs body-sm"
          onClick={() => navigate('/speaking')}
        >
          <ChevronLeft size={16} />
          <span>{t('common.back')}</span>
        </button>
        <span className="body-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {isEn ? 'Sentence' : 'Câu'} {activeIdx + 1}
        </span>
      </div>

      <div className="card pronunciation-card flex flex-col align-center text-center">
        <span className="exercise-type-tag mb-md">
          {isEn ? 'Pronunciation Drilling' : 'Luyện phát âm chuẩn'}
        </span>

        <span className="body-xs text-tertiary font-medium mb-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {isEn ? 'Read this Sentence Aloud' : 'Hãy đọc to câu này'}
        </span>

        <h2 className="title-md text-primary pronunciation-target-text" style={{ margin: 'var(--spacing-xs) 0' }}>
          {activeSentence}
        </h2>

        {activeFallback && (
          <>
            <span className="body-sm font-mono text-secondary mb-sm" style={{ padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-secondary)' }}>
              {activeFallback.phonetic}
            </span>
            <p className="body-sm text-tertiary italic mb-lg">{activeFallback.translation_vi}</p>
          </>
        )}

        <button
          className="btn btn-outline btn-sm flex align-center gap-xs mb-lg"
          onClick={handleSpeakReference}
          style={{ padding: '8px 16px' }}
        >
          <Volume2 size={16} />
          <span>{isEn ? 'Listen to Correct Native Voice' : 'Nghe giọng bản xứ chuẩn'}</span>
        </button>

        {/* Engine loader state (NFR: never an infinite spinner). Only shown when not idle/ready. */}
        {(engineState.kind === 'downloading' || engineState.kind === 'preparing' || engineState.kind === 'error') && (
          <div className="card flex align-center gap-xs" role="status" aria-live="polite" style={{ width: '100%', padding: 'var(--spacing-sm) var(--spacing-md)', marginBottom: 'var(--spacing-sm)' }}>
            {engineState.kind === 'downloading' && <Loader2 size={16} className="spin" />}
            {engineState.kind === 'preparing' && <Loader2 size={16} className="spin" />}
            {engineState.kind === 'error' && <AlertCircle size={16} style={{ color: 'var(--error)' }} />}
            <span className="body-xs">
              {engineState.kind === 'downloading' && (isEn ? 'Downloading pronunciation engine…' : t('speaking.modelDownloading'))}
              {engineState.kind === 'preparing' && (isEn ? 'Preparing engine…' : t('speaking.modelPreparing'))}
              {engineState.kind === 'error' && (isEn ? 'Engine unavailable — using word-match fallback.' : t('speaking.modelError'))}
            </span>
          </div>
        )}

        {/* Mic controls */}
        <div className="mic-drilling-panel flex flex-col align-center gap-sm" style={{ width: '100%' }}>
          {recognitionSupported ? (
            <button
              onClick={toggleListening}
              className={`mic-record-btn flex align-center justify-center ${isListening ? 'recording animate-pulse' : ''}`}
              aria-pressed={isListening}
              aria-label={isListening ? t('a11y.micStop') : t('a11y.micStart')}
            >
              <Mic size={32} />
            </button>
          ) : (
            <div className="flex flex-col align-center gap-xs">
              <button className="mic-record-btn disabled" disabled aria-label={t('speech.unsupported')}>
                <MicOff size={32} />
              </button>
              <span className="body-xs text-error">{t('speech.unsupported')}</span>
            </div>
          )}

          <span className="body-xs" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
            {isListening
              ? t('speaking.listening')
              : (isEn ? 'Click the microphone to start recording yourself.' : 'Click vào micro để bắt đầu ghi âm và đánh giá.')}
          </span>
        </div>

        {speechError && (
          <div className="error-banner flex align-center gap-xs" style={{ marginTop: 'var(--spacing-md)', width: '100%' }} role="alert">
            <AlertCircle size={18} />
            <span className="body-xs">{speechError}</span>
          </div>
        )}
      </div>

      {/* Per-phoneme grading report (engine path) */}
      {phonemeScores && overall !== null && (
        <div className="card pronunciation-report-card animate-fade-in flex flex-col gap-md" style={{ marginTop: 'var(--spacing-md)' }}>
          <div className="flex justify-between align-center">
            <div className="flex align-center gap-xs">
              <Sparkles size={18} className="text-primary" />
              <span className="title-xs">{isEn ? 'Pronunciation Grade' : 'Kết quả đánh giá phát âm'}</span>
            </div>
            <div className="flex align-center gap-xs" aria-live="polite">
              <span className="body-sm font-bold" style={{ color: bandForScore(overall) === 'good' ? 'var(--success)' : bandForScore(overall) === 'borderline' ? 'var(--warning)' : 'var(--error)' }}>
                {Math.round(overall * 100)}% {isEn ? 'Accuracy' : 'Độ chính xác'}
              </span>
            </div>
          </div>

          <div className="report-text-highlights flex flex-wrap gap-xs justify-center" style={{ padding: 'var(--spacing-sm) 0', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
            {phonemeScores.map((p, idx) => {
              const colorVar =
                p.band === 'good' ? 'var(--success)' :
                p.band === 'borderline' ? 'var(--warning)' :
                'var(--error)';
              const label = p.band === 'good' ? t('speaking.phonemeGood') : p.band === 'borderline' ? t('speaking.phonemeBorderline') : t('speaking.phonemeOff');
              return (
                <span
                  key={idx}
                  className="pron-word-badge flex align-center gap-xs"
                  style={{ background: 'color-mix(in srgb, ' + colorVar + ' 12%, transparent)', borderColor: colorVar, color: colorVar }}
                  aria-label={label + ' ' + p.phoneme}
                >
                  {p.band === 'good' ? <CheckCircle size={12} aria-hidden="true" /> : p.band === 'borderline' ? <Wifi size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                  {p.phoneme}
                </span>
              );
            })}
          </div>

          <div className="flex gap-xs align-start">
            <CheckCircle size={16} className="text-success" style={{ flexShrink: 0, marginTop: '2px' }} />
            <p className="body-xs" style={{ color: 'var(--text-secondary)' }}>
              {overall >= 0.8
                ? (isEn ? 'Excellent English pronunciation! Your speech matches native-like speech templates.' : 'Phát âm tuyệt vời! Giọng đọc của bạn rất chuẩn và khớp với mẫu bản xứ.')
                : (isEn ? 'Good try! Pay attention to the highlighted words. Focus on matching vowel syllable stresses.' : 'Hãy thử lại! Chú ý đến các từ được bôi đỏ. Tập trung phát âm đúng nguyên âm và trọng âm.')}
            </p>
          </div>

          <div className="flex justify-end" style={{ marginTop: 'var(--spacing-xs)' }}>
            <button className="btn btn-primary btn-sm flex align-center gap-xs" onClick={handleNext}>
              <span>{isEn ? 'Next Sentence' : 'Câu tiếp theo'}</span>
              <Volume2 size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Word-match fallback report */}
      {wordScore && !phonemeScores && (
        <div className="card pronunciation-report-card animate-fade-in flex flex-col gap-md" style={{ marginTop: 'var(--spacing-md)' }}>
          <div className="flex justify-between align-center">
            <div className="flex align-center gap-xs">
              <Sparkles size={18} className="text-primary" />
              <span className="title-xs">{isEn ? 'Pronunciation Grade (word match)' : 'Kết quả đánh giá phát âm (từ)'}</span>
            </div>
            <div className="flex align-center gap-xs" aria-live="polite">
              <span className="body-sm font-bold" style={{ color: wordScore.score >= 80 ? 'var(--success)' : 'var(--warning)' }}>
                {wordScore.score}% {isEn ? 'Accuracy' : 'Độ chính xác'}
              </span>
            </div>
          </div>

          <div className="report-text-highlights flex flex-wrap gap-xs justify-center" style={{ padding: 'var(--spacing-sm) 0', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
            {wordScore.words.map((item, idx) => (
              <span
                key={idx}
                className={`pron-word-badge ${item.isCorrect ? 'correct' : 'incorrect'} flex align-center gap-xs`}
                aria-label={item.isCorrect ? t('speaking.wordCorrect') : t('speaking.wordIncorrect')}
              >
                {item.isCorrect ? <CheckCircle size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                {item.word}
              </span>
            ))}
          </div>

          <div className="flex justify-end" style={{ marginTop: 'var(--spacing-xs)' }}>
            <button className="btn btn-outline btn-sm flex align-center gap-xs" onClick={handleRetry}>
              {isEn ? 'Try Again' : 'Thử lại'}
            </button>
            <button className="btn btn-primary btn-sm flex align-center gap-xs" onClick={handleNext} style={{ marginLeft: 'var(--spacing-xs)' }}>
              <span>{isEn ? 'Next Sentence' : 'Câu tiếp theo'}</span>
              <Volume2 size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Transcript text feedback */}
      {transcript && !wordScore && !phonemeScores && (
        <div className="card text-center animate-fade-in" style={{ marginTop: 'var(--spacing-md)' }}>
          <span className="body-xs text-tertiary uppercase block" style={{ marginBottom: '4px' }}>{t('speaking.transcribedSpeech')}</span>
          <p className="body-md font-medium" style={{ color: 'var(--text-primary)' }}>"{transcript}"</p>
        </div>
      )}

      {/* History (BR-13: per-turn persists; BR-20: viewable). */}
      <div className="card" style={{ marginTop: 'var(--spacing-md)' }}>
        <div className="flex align-center gap-xs" style={{ marginBottom: 'var(--spacing-sm)' }}>
          <History size={16} className="text-secondary" />
          <span className="title-xs">{t('speaking.historyTitle')}</span>
        </div>
        {historyLoading ? (
          <div className="flex align-center gap-xs" role="status" aria-live="polite">
            <Loader2 size={14} className="spin" />
            <span className="body-xs text-tertiary">{t('common.loadingApp')}</span>
          </div>
        ) : history.length === 0 ? (
          <span className="body-xs text-tertiary">{t('speaking.historyEmpty')}</span>
        ) : (
          <ul className="flex flex-col gap-xs" style={{ listStyle: 'none', padding: 0 }}>
            {history.slice(0, 5).map((entry) => {
              const overallScore = entry.attempt.phonemes.reduce((s, p) => s + p.score, 0) / Math.max(1, entry.attempt.phonemes.length);
              const band = bandForScore(overallScore);
              const colorVar = band === 'good' ? 'var(--success)' : band === 'borderline' ? 'var(--warning)' : 'var(--error)';
              return (
                <li key={entry.id} className="flex justify-between align-center body-xs" style={{ padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>"{entry.attempt.sentence}"</span>
                  <span className="font-bold" style={{ color: colorVar }}>{Math.round(overallScore * 100)}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <div className="error-banner flex align-center gap-xs" role="alert" style={{ marginTop: 'var(--spacing-md)' }}>
          <AlertCircle size={16} />
          <span className="body-xs">{error}</span>
        </div>
      )}
    </div>
  );
};
