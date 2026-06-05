import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAI } from '../contexts/AIContext';
import { fetchExercisesForTopic, recordExerciseCompletion } from '../lib/exerciseService';
import type { ExerciseQuestion } from '../lib/exerciseService';
import type { AIDiagnostic } from '../lib/aiClient';
import { formatAIDiagnostic } from '../lib/aiDiagnosticMessage';
import { ChevronLeft, Check, X, AlertCircle, HelpCircle, Award, RefreshCw, ArrowRight } from 'lucide-react';

export const ExercisePage: React.FC = () => {
  const { user, isMock } = useAuth();
  const { locale, t } = useLanguage();
  const { config: aiConfig } = useAI();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const topicId = searchParams.get('topic') || '';

  const [questions, setQuestions] = useState<ExerciseQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  // G3 (diagnosis 2026-06-05): surface why exercises fell back to seed/mock
  // (e.g. quota exhausted) instead of silently swapping in generic content.
  const [aiDiagnostic, setAiDiagnostic] = useState<AIDiagnostic | null>(null);

  // Interaction State
  const [selectedOption, setSelectedOption] = useState<string | null>(null); // MCQ
  const [clozeAnswer, setClozeAnswer] = useState(''); // Cloze
  const [reorderedWords, setReorderedWords] = useState<string[]>([]); // Reorder

  const [checked, setChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [correctAnswersCount, setCorrectAnswersCount] = useState(0);
  const [sessionCompleted, setSessionCompleted] = useState(false);

  const isEn = locale === 'en';

  const loadExercises = async () => {
    if (!topicId) return;
    try {
      setLoading(true);
      setLoadError(false);
      setAiDiagnostic(null);
      const data = await fetchExercisesForTopic(topicId, isMock, aiConfig, (d) => setAiDiagnostic(d));
      setQuestions(data);
      setCurrentIndex(0);
      setCorrectAnswersCount(0);
      setSessionCompleted(false);
      resetInteraction();
    } catch (err) {
      console.error('Error fetching exercises:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExercises();
  }, [topicId, isMock]);

  const resetInteraction = () => {
    setSelectedOption(null);
    setClozeAnswer('');
    setReorderedWords([]);
    setChecked(false);
    setIsCorrect(false);
  };

  const handleWordClick = (word: string, source: 'scrambled' | 'reordered') => {
    if (checked) return;
    if (source === 'scrambled') {
      setReorderedWords(prev => [...prev, word]);
    } else {
      // Remove word
      setReorderedWords(prev => {
        const idx = prev.indexOf(word);
        if (idx > -1) {
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        }
        return prev;
      });
    }
  };

  const handleCheck = () => {
    if (checked) return;
    
    const activeQ = questions[currentIndex];
    let correct = false;

    if (activeQ.type === 'mcq') {
      correct = selectedOption === activeQ.correct_option;
    } else if (activeQ.type === 'cloze') {
      correct = clozeAnswer.trim().toLowerCase() === activeQ.correct_answer?.trim().toLowerCase();
    } else if (activeQ.type === 'reorder') {
      const userSentence = reorderedWords.join(' ').toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").trim();
      const correctSentence = activeQ.correct_sentence?.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").trim() || '';
      correct = userSentence === correctSentence;
    }

    setIsCorrect(correct);
    setChecked(true);
    if (correct) {
      setCorrectAnswersCount(prev => prev + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex(prev => prev + 1);
      resetInteraction();
    } else {
      if (user) {
        recordExerciseCompletion(user.id, isMock);
      }
      setSessionCompleted(true);
    }
  };

  const handleRetry = () => {
    loadExercises();
  };

  if (loading) {
    return (
      <div className="flex justify-center align-center animate-fade-in" style={{ minHeight: '50vh', gap: 'var(--spacing-md)' }}>
        <div className="spinner" />
        <span className="body-md">{t('common.loading')}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card no-cards-card flex flex-col align-center justify-center text-center animate-fade-in" style={{ maxWidth: '500px', margin: '40px auto' }} role="alert">
        <AlertCircle size={48} className="icon" style={{ color: 'var(--warning)', marginBottom: 'var(--spacing-md)' }} />
        <h2 className="title-md" style={{ marginBottom: 'var(--spacing-xs)' }}>{t('common.error')}</h2>
        <p className="body-sm" style={{ marginBottom: 'var(--spacing-lg)' }}>
          {t('errors.exerciseFailed')}
        </p>
        <button className="btn btn-primary btn-sm" onClick={loadExercises}>
          {t('common.tryAgain')}
        </button>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="card no-cards-card flex flex-col align-center justify-center text-center animate-fade-in" style={{ maxWidth: '500px', margin: '40px auto' }}>
        <HelpCircle size={48} className="icon" style={{ color: 'var(--primary)', marginBottom: 'var(--spacing-md)' }} />
        <h2 className="title-md" style={{ marginBottom: 'var(--spacing-xs)' }}>{t('speaking.noChallengesTitle')}</h2>
        <p className="body-sm" style={{ marginBottom: 'var(--spacing-lg)' }}>
          {t('speaking.noChallengesDesc')}
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/vocabulary')}>
          {t('common.back')}
        </button>
      </div>
    );
  }

  if (sessionCompleted) {
    const scorePercent = Math.round((correctAnswersCount / questions.length) * 100);
    return (
      <div className="card completion-card flex flex-col align-center justify-center text-center animate-fade-in" style={{ maxWidth: '500px', margin: '40px auto' }}>
        <div className="success-badge">
          <Award size={40} />
        </div>
        <h2 className="title-lg" style={{ marginTop: 'var(--spacing-md)', marginBottom: 'var(--spacing-xs)' }}>
          {isEn ? 'Exercises Complete!' : 'Hoàn thành bài tập!'}
        </h2>
        <p className="body-sm" style={{ marginBottom: 'var(--spacing-lg)' }}>
          {isEn 
            ? `You completed the practice quiz with a score of ${scorePercent}%.`
            : `Bạn đã hoàn thành bài thực hành với điểm số ${scorePercent}%.`}
        </p>

        <div className="completion-stats flex gap-md justify-center" style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div className="stat-pill">
            <span className="stat-label">{isEn ? 'Correct Answers' : 'Đáp án đúng'}</span>
            <span className="stat-val" style={{ color: 'var(--success)' }}>{correctAnswersCount} / {questions.length}</span>
          </div>
        </div>

        <div className="flex gap-sm" style={{ width: '100%' }}>
          <button className="btn btn-outline btn-sm flex-1 flex align-center justify-center gap-xs" onClick={handleRetry}>
            <RefreshCw size={14} />
            <span>{isEn ? 'Retry' : 'Làm lại'}</span>
          </button>
          <button className="btn btn-primary btn-sm flex-1" onClick={() => navigate('/vocabulary')}>
            <span>{t('common.back')}</span>
          </button>
        </div>
      </div>
    );
  }

  const activeQ = questions[currentIndex];
  const promptText = isEn ? activeQ.prompt_en : activeQ.prompt_vi;

  return (
    <div className="exercise-container animate-fade-in" style={{ maxWidth: '680px', margin: '0 auto' }}>
      {/* Top navbar */}
      <div className="flex justify-between align-center" style={{ marginBottom: 'var(--spacing-md)' }}>
        <button 
          className="back-btn flex align-center gap-xs body-sm"
          onClick={() => navigate('/vocabulary')}
        >
          <ChevronLeft size={16} />
          <span>{t('common.back')}</span>
        </button>
        <span className="body-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {isEn ? 'Question' : 'Câu hỏi'} {currentIndex + 1} / {questions.length}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="progress-bar-container" style={{ height: '6px', marginBottom: 'var(--spacing-lg)' }}>
        <div 
          className="progress-bar-fill"
          style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* G3 (diagnosis 2026-06-05): AI fallback diagnostic banner — tells the
          Learner why these exercises are basic/seed instead of AI-generated. */}
      {aiDiagnostic && (
        <div
          className="flex align-center gap-xs"
          role="status"
          style={{
            background: 'var(--warning-subtle, #fff7ed)',
            color: 'var(--warning-text, #9a3412)',
            border: '1px solid var(--warning, #fdba74)',
            borderRadius: 'var(--radius-md, 8px)',
            padding: '8px 12px',
            marginBottom: 'var(--spacing-lg)',
            fontSize: '13px',
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{formatAIDiagnostic(aiDiagnostic, isEn)}</span>
          <button
            type="button"
            onClick={() => setAiDiagnostic(null)}
            aria-label={isEn ? 'Dismiss' : 'Đóng'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main card */}
      <div className="card exercise-card">
        {/* Type label */}
        <span className="exercise-type-tag mb-sm">
          {activeQ.type === 'mcq' && (isEn ? 'Multiple Choice' : 'Trắc nghiệm')}
          {activeQ.type === 'cloze' && (isEn ? 'Fill in the Blank' : 'Điền vào chỗ trống')}
          {activeQ.type === 'reorder' && (isEn ? 'Sentence Builder' : 'Sắp xếp câu')}
        </span>

        {/* Prompt */}
        <h2 className="title-sm" style={{ marginBottom: 'var(--spacing-md)' }}>{promptText}</h2>

        {/* Dynamic Exercise UI */}
        <div className="exercise-playground" style={{ margin: 'var(--spacing-md) 0' }}>
          
          {/* MCQ Option selection */}
          {activeQ.type === 'mcq' && (
            <div className="mcq-options-grid grid grid-cols-2 gap-sm">
              {activeQ.options?.map((option, idx) => {
                const isSelected = selectedOption === option;
                let optionClass = 'mcq-option-btn';
                if (isSelected) optionClass += ' selected';
                if (checked) {
                  if (option === activeQ.correct_option) optionClass += ' correct';
                  else if (isSelected) optionClass += ' incorrect';
                }

                return (
                  <button
                    key={idx}
                    className={optionClass}
                    onClick={() => !checked && setSelectedOption(option)}
                    disabled={checked}
                  >
                    <span>{option}</span>
                    {checked && option === activeQ.correct_option && <Check size={16} className="text-success" />}
                    {checked && isSelected && option !== activeQ.correct_option && <X size={16} className="text-error" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Cloze test typing */}
          {activeQ.type === 'cloze' && (
            <div className="cloze-wrapper flex flex-col gap-sm">
              <div className="cloze-sentence-display">
                {activeQ.sentence_with_blank?.split('[blank]').map((part, i, arr) => (
                  <React.Fragment key={i}>
                    <span className="body-md font-medium" style={{ color: 'var(--text-primary)' }}>{part}</span>
                    {i < arr.length - 1 && (
                      <input
                        type="text"
                        className={`cloze-inline-input ${checked ? (isCorrect ? 'correct' : 'incorrect') : ''}`}
                        placeholder="..."
                        value={clozeAnswer}
                        onChange={(e) => !checked && setClozeAnswer(e.target.value)}
                        disabled={checked}
                        style={{ width: `${Math.max(80, (activeQ.correct_answer?.length || 4) * 14)}px` }}
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>
              
              {checked && !isCorrect && (
                <span className="body-xs" style={{ color: 'var(--success)', fontWeight: 600, marginTop: '4px' }}>
                  {isEn ? 'Correct answer:' : 'Đáp án đúng:'} {activeQ.correct_answer}
                </span>
              )}
            </div>
          )}

          {/* Reordering tiles */}
          {activeQ.type === 'reorder' && (
            <div className="reorder-wrapper flex flex-col gap-lg">
              {/* Target Line Area */}
              <div className={`reorder-sentence-line flex gap-xs flex-wrap align-center ${checked ? (isCorrect ? 'correct' : 'incorrect') : ''}`}>
                {reorderedWords.length === 0 ? (
                  <span className="body-xs" style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '6px 0' }}>
                    {isEn ? 'Click word cards below to build the sentence...' : 'Click các thẻ từ bên dưới để ghép câu...'}
                  </span>
                ) : (
                  reorderedWords.map((word, idx) => (
                    <button
                      key={idx}
                      className="word-card active-word"
                      onClick={() => handleWordClick(word, 'reordered')}
                      disabled={checked}
                    >
                      {word}
                    </button>
                  ))
                )}
              </div>

              {/* Scrambled Pool Area */}
              <div className="scrambled-words-pool flex gap-xs flex-wrap justify-center">
                {activeQ.scrambled_words?.map((word, idx) => {
                  // Hide card if it's already selected
                  const countInReordered = reorderedWords.filter(w => w === word).length;
                  const countInScrambled = activeQ.scrambled_words?.filter(w => w === word).length || 0;
                  const isUsed = countInReordered >= countInScrambled;

                  return (
                    <button
                      key={idx}
                      className={`word-card scrambled-word ${isUsed ? 'used' : ''}`}
                      onClick={() => !isUsed && handleWordClick(word, 'scrambled')}
                      disabled={checked || isUsed}
                    >
                      {word}
                    </button>
                  );
                })}
              </div>

              {checked && !isCorrect && (
                <div className="correct-reorder-sentence">
                  <span className="body-xs font-semibold text-success block" style={{ marginBottom: '2px' }}>
                    {isEn ? 'Correct sentence structure:' : 'Cấu trúc câu chính xác:'}
                  </span>
                  <span className="body-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    "{activeQ.correct_sentence}"
                  </span>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Action Check/Next buttons */}
        <div className="flex justify-end" style={{ marginTop: 'var(--spacing-lg)' }}>
          {!checked ? (
            <button
              className="btn btn-primary btn-sm flex align-center gap-xs"
              onClick={handleCheck}
              disabled={
                (activeQ.type === 'mcq' && !selectedOption) ||
                (activeQ.type === 'cloze' && !clozeAnswer.trim()) ||
                (activeQ.type === 'reorder' && reorderedWords.length === 0)
              }
            >
              <span>{isEn ? 'Check Answer' : 'Kiểm tra đáp án'}</span>
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm flex align-center gap-xs animate-pulse"
              onClick={handleNext}
            >
              <span>{isEn ? 'Continue' : 'Tiếp tục'}</span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>

      {/* AI Explanation block */}
      {checked && (
        <div className="card explanation-box animate-fade-in flex gap-sm" style={{ marginTop: 'var(--spacing-md)' }}>
          <AlertCircle size={20} className={isCorrect ? 'text-success' : 'text-error'} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 className="title-xs" style={{ marginBottom: '4px' }}>
              {isCorrect 
                ? (isEn ? 'Correct!' : 'Chính xác!') 
                : (isEn ? 'Incorrect Explanation' : 'Giải thích đáp án')}
            </h3>
            <p className="body-xs" style={{ color: 'var(--text-secondary)' }}>
              {isEn ? activeQ.explanation_en : activeQ.explanation_vi}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
