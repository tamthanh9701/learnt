import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { seedPronunciationChallenges, scorePronunciationSimilarity } from '../lib/speakingService';
import type { PronunciationChallenge } from '../lib/speakingService';
import { useSpeechRecognition, getSpeechErrorMessageKey } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { ChevronLeft, Volume2, Mic, MicOff, AlertCircle, Sparkles, CheckCircle, X, HelpCircle } from 'lucide-react';

export const PronunciationPage: React.FC = () => {
  const { locale, t } = useLanguage();
  const navigate = useNavigate();

  const [challenges] = useState<PronunciationChallenge[]>(seedPronunciationChallenges);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [speechError, setSpeechError] = useState<string | null>(null);

  // Result States
  const [transcript, setTranscript] = useState('');
  const [scoreResult, setScoreResult] = useState<{
    score: number;
    words: { word: string; isCorrect: boolean }[];
  } | null>(null);

  const isEn = locale === 'en';

  const { speak } = useSpeechSynthesis();
  const { isListening, isSupported: recognitionSupported, toggle: toggleListening } = useSpeechRecognition({
    lang: 'en-US',
    onStart: () => {
      setSpeechError(null);
      setTranscript('');
      setScoreResult(null);
    },
    onResult: (resultText) => {
      setTranscript(resultText);
      const activeChallenge = challenges[currentIndex];
      if (activeChallenge) {
        setScoreResult(scorePronunciationSimilarity(activeChallenge.text, resultText));
      }
    },
    onError: (code) => setSpeechError(t(getSpeechErrorMessageKey(code))),
  });

  const handleSpeakReference = () => {
    if (currentIndex >= challenges.length) return;
    speak(challenges[currentIndex].text);
  };

  const handleNextChallenge = () => {
    if (currentIndex + 1 < challenges.length) {
      setCurrentIndex(prev => prev + 1);
    } else {
      // Loop back to start
      setCurrentIndex(0);
    }
    setTranscript('');
    setScoreResult(null);
    setSpeechError(null);
  };

  if (challenges.length === 0) {
    return (
      <div className="card no-cards-card flex flex-col align-center justify-center text-center" style={{ maxWidth: '500px', margin: '40px auto' }}>
        <HelpCircle size={48} className="icon" style={{ color: 'var(--primary)', marginBottom: 'var(--spacing-md)' }} />
        <h2 className="title-md">{t('speaking.noChallengesTitle')}</h2>
        <p className="body-sm">{t('speaking.noChallengesDesc')}</p>
      </div>
    );
  }

  const activeChallenge = challenges[currentIndex];

  return (
    <div className="pronunciation-drill-container animate-fade-in" style={{ maxWidth: '680px', margin: '0 auto' }}>
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
          {isEn ? 'Sentence' : 'Câu'} {currentIndex + 1} / {challenges.length}
        </span>
      </div>

      {/* Challenge Card */}
      <div className="card pronunciation-card flex flex-col align-center text-center">
        <span className="exercise-type-tag mb-md">
          {isEn ? 'Pronunciation Drilling' : 'Luyện phát âm chuẩn'}
        </span>

        {/* Translation reference */}
        <span className="body-xs text-tertiary font-medium mb-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {isEn ? 'Read this Sentence Aloud' : 'Hãy đọc to câu này'}
        </span>

        {/* Challenge Text */}
        <h2 className="title-md text-primary pronunciation-target-text" style={{ margin: 'var(--spacing-xs) 0' }}>
          {activeChallenge.text}
        </h2>

        {/* Phonetics IPA */}
        <span className="body-sm font-mono text-secondary mb-sm" style={{ padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-secondary)' }}>
          {activeChallenge.phonetic}
        </span>

        {/* Vietnamese Translation */}
        <p className="body-sm text-tertiary italic mb-lg">
          {activeChallenge.translation_vi}
        </p>

        {/* Listen Reference Button */}
        <button 
          className="btn btn-outline btn-sm flex align-center gap-xs mb-lg"
          onClick={handleSpeakReference}
          style={{ padding: '8px 16px' }}
        >
          <Volume2 size={16} />
          <span>{isEn ? 'Listen to Correct Native Voice' : 'Nghe giọng bản xứ chuẩn'}</span>
        </button>

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
              : (isEn ? 'Click the microphone to start recording yourself.' : 'Click vào micro để bắt đầu ghi âm và đánh giá.')
            }
          </span>
        </div>

        {speechError && (
          <div className="error-banner flex align-center gap-xs" style={{ marginTop: 'var(--spacing-md)', width: '100%' }} role="alert">
            <AlertCircle size={18} />
            <span className="body-xs">{speechError}</span>
          </div>
        )}
      </div>

      {/* Grading report analysis */}
      {scoreResult && (
        <div className="card pronunciation-report-card animate-fade-in flex flex-col gap-md" style={{ marginTop: 'var(--spacing-md)' }}>
          <div className="flex justify-between align-center">
            <div className="flex align-center gap-xs">
              <Sparkles size={18} className="text-primary" />
              <span className="title-xs">{isEn ? 'Pronunciation Grade' : 'Kết quả đánh giá phát âm'}</span>
            </div>
            
            <div className="flex align-center gap-xs" aria-live="polite">
              <span className="body-sm font-bold" style={{ color: scoreResult.score >= 80 ? 'var(--success)' : 'var(--warning)' }}>
                {scoreResult.score}% {isEn ? 'Accuracy' : 'Độ chính xác'}
              </span>
            </div>
          </div>

          <div className="report-text-highlights flex flex-wrap gap-xs justify-center" style={{ padding: 'var(--spacing-sm) 0', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
            {scoreResult.words.map((item, idx) => (
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

          {/* Detailed instruction tip */}
          <div className="flex gap-xs align-start">
            <CheckCircle size={16} className="text-success" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <p className="body-xs" style={{ color: 'var(--text-secondary)' }}>
                {scoreResult.score >= 85
                  ? (isEn ? 'Excellent English pronunciation! Your speech matches native-like speech templates.' : 'Phát âm tuyệt vời! Giọng đọc của bạn rất chuẩn và khớp với mẫu bản xứ.')
                  : (isEn ? 'Good try! Pay attention to the highlighted red words. Focus on matching vowel syllable stresses.' : 'Hãy thử lại! Chú ý đến các từ được bôi đỏ. Tập trung phát âm đúng nguyên âm và trọng âm.')
                }
              </p>
            </div>
          </div>

          {/* Action button */}
          <div className="flex justify-end" style={{ marginTop: 'var(--spacing-xs)' }}>
            <button className="btn btn-primary btn-sm flex align-center gap-xs" onClick={handleNextChallenge}>
              <span>{isEn ? 'Next Sentence' : 'Câu tiếp theo'}</span>
              <Volume2 size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Transcript text feedback */}
      {transcript && !scoreResult && (
        <div className="card text-center animate-fade-in" style={{ marginTop: 'var(--spacing-md)' }}>
          <span className="body-xs text-tertiary uppercase block" style={{ marginBottom: '4px' }}>{t('speaking.transcribedSpeech')}</span>
          <p className="body-md font-medium" style={{ color: 'var(--text-primary)' }}>"{transcript}"</p>
        </div>
      )}
    </div>
  );
};
