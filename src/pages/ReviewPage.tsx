import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { fetchCardsForSession, submitCardReview } from '../lib/vocabularyService';
import type { ReviewSessionCard } from '../lib/vocabularyService';
import { fsrs, createEmptyCard, Rating } from 'ts-fsrs';
import type { Grade, Card as FSRSCard } from 'ts-fsrs';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { Volume2, ChevronLeft, Award, HelpCircle } from 'lucide-react';

export const ReviewPage: React.FC = () => {
  const { user, isMock, refreshProfile } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { speak } = useSpeechSynthesis();

  const topicId = searchParams.get('topic') || '';
  const mode = (searchParams.get('mode') as 'learn' | 'review') || 'learn';

  const [cards, setCards] = useState<ReviewSessionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // FSRS scheduling preview intervals
  const [intervalPreviews, setIntervalPreviews] = useState<Record<number, string>>({});

  const fsrsInstance = fsrs();

  const loadSessionCards = async () => {
    if (!user || !topicId) return;
    try {
      setLoading(true);
      const sessionCards = await fetchCardsForSession(user.id, topicId, isMock, mode);
      
      // Shuffle cards to mix them up
      const shuffled = [...sessionCards].sort(() => Math.random() - 0.5);
      setCards(shuffled);
      setCurrentIndex(0);
      setShowAnswer(false);
      setSessionCompleted(false);
    } catch (err) {
      console.error('Error loading session cards:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessionCards();
  }, [user, topicId, mode, isMock]);

  // Compute FSRS interval previews when a card is loaded
  useEffect(() => {
    if (cards.length > 0 && currentIndex < cards.length) {
      const activeCard = cards[currentIndex];
      const now = new Date();
      // If card has never been reviewed, create a default empty card
      const baseCard = activeCard.fsrsCard || (createEmptyCard(now) as FSRSCard);
      
      const schedulingInfo = fsrsInstance.repeat(baseCard, now);
      
      // Format intervals for 1: Again, 2: Hard, 3: Good, 4: Easy
      const previews: Record<number, string> = {};
      [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].forEach(r => {
        const nextDue = schedulingInfo[r as Grade].card.due;
        const diffMs = nextDue.getTime() - now.getTime();
        const diffMin = Math.round(diffMs / (60 * 1000));
        
        if (diffMin < 60) {
          previews[r] = `${diffMin}m`;
        } else {
          const diffHrs = Math.round(diffMs / (60 * 60 * 1000));
          if (diffHrs < 24) {
            previews[r] = `${diffHrs}h`;
          } else {
            const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
            previews[r] = `${diffDays}d`;
          }
        }
      });
      setIntervalPreviews(previews);
    }
  }, [currentIndex, cards]);


  const activeCard = cards[currentIndex];

  // Browser Text-To-Speech Pronunciation
  const handleSpeak = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!activeCard) return;
    speak(activeCard.word);
  };

  // Automatically speak when a new card is shown
  useEffect(() => {
    if (activeCard && !showAnswer) {
      handleSpeak();
    }
  }, [currentIndex, activeCard]);

  const handleRate = async (rating: Rating) => {
    if (!user || !activeCard || submitting) return;
    setSubmitting(true);
    try {
      await submitCardReview(user.id, activeCard.id, topicId, rating, isMock);
      
      if (currentIndex + 1 < cards.length) {
        setCurrentIndex(prev => prev + 1);
        setShowAnswer(false);
      } else {
        setSessionCompleted(true);
        // Refresh streak and daily goals on the dashboard/sidebar
        await refreshProfile();
      }
    } catch (err) {
      console.error('Error submitting card review:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center align-center animate-fade-in" style={{ minHeight: '50vh', gap: 'var(--spacing-md)' }}>
        <div className="spinner" />
        <span className="body-md">{t('common.loading')}</span>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="card no-cards-card flex flex-col align-center justify-center text-center animate-fade-in" style={{ maxWidth: '500px', margin: '40px auto' }}>
        <HelpCircle size={48} className="icon" style={{ color: 'var(--primary)', marginBottom: 'var(--spacing-md)' }} />
        <h2 className="title-md" style={{ marginBottom: 'var(--spacing-xs)' }}>{t('review.noCardsTitle')}</h2>
        <p className="body-sm" style={{ marginBottom: 'var(--spacing-lg)' }}>
          {mode === 'review' 
            ? t('vocabulary.allReviewed')
            : t('review.allLearned')
          }
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/vocabulary')}>
          {t('common.back')}
        </button>
      </div>
    );
  }

  if (sessionCompleted) {
    return (
      <div className="card completion-card flex flex-col align-center justify-center text-center animate-fade-in" style={{ maxWidth: '500px', margin: '40px auto' }}>
        <div className="success-badge">
          <Award size={40} />
        </div>
        <h2 className="title-lg" style={{ marginTop: 'var(--spacing-md)', marginBottom: 'var(--spacing-xs)' }}>
          {t('review.completedTitle')}
        </h2>
        <p className="body-sm" style={{ marginBottom: 'var(--spacing-lg)' }}>
          {t('review.completedDesc')}
        </p>
        <div className="completion-stats flex gap-md justify-center" style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div className="stat-pill">
            <span className="stat-label">{t('review.reviewedLabel')}</span>
            <span className="stat-val">{cards.length} {t('vocabulary.words').toLowerCase()}</span>
          </div>
        </div>
        <div className="flex gap-sm" style={{ width: '100%', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm flex-1" onClick={loadSessionCards}>
            {t('common.tryAgain')}
          </button>
          <button className="btn btn-secondary btn-sm flex-1 flex align-center justify-center gap-xs" onClick={() => navigate(`/writing/exercise?topic=${topicId}`)}>
            <span>{t('review.practiceQuiz')}</span>
          </button>
          <button className="btn btn-primary btn-sm flex-1" onClick={() => navigate('/vocabulary')}>
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-session-container animate-fade-in">
      {/* Session Header */}
      <div className="session-header flex align-center justify-between">
        <button className="btn-back flex align-center gap-xs" onClick={() => navigate('/vocabulary')}>
          <ChevronLeft size={16} />
          <span>{t('common.back')}</span>
        </button>
        <span className="session-progress-label">
          {currentIndex + 1} / {cards.length}
        </span>
      </div>

      {/* Main Flashcard Display */}
      <div
        className={`flashcard ${showAnswer ? 'flipped' : ''}`}
        onClick={() => !showAnswer && setShowAnswer(true)}
        role="button"
        tabIndex={0}
        aria-label={t('vocabulary.showAnswer')}
        onKeyDown={(e) => {
          if (!showAnswer && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setShowAnswer(true);
          }
        }}
      >
        <div className="card-face card-front flex flex-col justify-between">
          <div className="card-top-info">
            <span className="badge-pos">{activeCard.part_of_speech}</span>
          </div>

          <div className="card-center-word flex flex-col align-center justify-center">
            <h1 className="flash-word">{activeCard.word}</h1>
            <button className="speak-btn flex align-center justify-center" onClick={handleSpeak} aria-label={t('a11y.speakWord')}>
              <Volume2 size={24} />
            </button>
          </div>

          <div className="card-prompt text-center">
            <span className="body-xs font-500">{t('vocabulary.showAnswer')}</span>
          </div>
        </div>

        <div className="card-face card-back flex flex-col justify-between">
          <div className="card-top-info flex justify-between align-center">
            <span className="badge-pos">{activeCard.part_of_speech}</span>
            <span className="phonetics-txt">{activeCard.phonetic}</span>
            <button className="speak-btn-sm" onClick={handleSpeak} aria-label={t('a11y.speakWord')}>
              <Volume2 size={16} />
            </button>
          </div>

          <div className="card-back-body flex flex-col gap-md">
            <div>
              <span className="body-xs text-uppercase">{t('common.vietnamese')}</span>
              <p className="vi-meaning">{activeCard.definition_vi}</p>
            </div>

            <div>
              <span className="body-xs text-uppercase">{t('common.definition')}</span>
              <p className="en-definition">{activeCard.definition_en}</p>
            </div>

            <div>
              <span className="body-xs text-uppercase">{t('vocabulary.example')}</span>
              <blockquote className="example-block">
                <p className="ex-en">“{activeCard.example_en}”</p>
                <p className="ex-vi">{activeCard.example_vi}</p>
              </blockquote>
            </div>
          </div>

          {/* Spacer */}
          <div style={{ height: '10px' }} />
        </div>
      </div>

      {/* Answer rating buttons or show answer button */}
      <div className="action-panel">
        {!showAnswer ? (
          <button 
            className="btn btn-primary btn-lg btn-reveal" 
            onClick={() => setShowAnswer(true)}
          >
            {t('vocabulary.showAnswer')}
          </button>
        ) : (
          <div className="rating-options-container flex gap-sm">
            {/* Again Button */}
            <button 
              className="btn btn-danger btn-rating flex-1 flex flex-col"
              onClick={() => handleRate(Rating.Again)}
              disabled={submitting}
            >
              <span className="btn-rating-lbl">{t('vocabulary.again')}</span>
              <span className="btn-rating-interval">{intervalPreviews[Rating.Again]}</span>
            </button>

            {/* Hard Button */}
            <button 
              className="btn btn-secondary btn-rating flex-1 flex flex-col"
              style={{ borderColor: 'var(--warning)', color: 'var(--warning-hover)' }}
              onClick={() => handleRate(Rating.Hard)}
              disabled={submitting}
            >
              <span className="btn-rating-lbl">{t('vocabulary.hard')}</span>
              <span className="btn-rating-interval">{intervalPreviews[Rating.Hard]}</span>
            </button>

            {/* Good Button */}
            <button 
              className="btn btn-primary btn-rating flex-1 flex flex-col"
              onClick={() => handleRate(Rating.Good)}
              disabled={submitting}
            >
              <span className="btn-rating-lbl">{t('vocabulary.good')}</span>
              <span className="btn-rating-interval">{intervalPreviews[Rating.Good]}</span>
            </button>

            {/* Easy Button */}
            <button 
              className="btn btn-success btn-rating flex-1 flex flex-col"
              onClick={() => handleRate(Rating.Easy)}
              disabled={submitting}
            >
              <span className="btn-rating-lbl">{t('vocabulary.easy')}</span>
              <span className="btn-rating-interval">{intervalPreviews[Rating.Easy]}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
