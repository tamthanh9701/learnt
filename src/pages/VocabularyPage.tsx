import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { fetchTopicsAndProgress } from '../lib/vocabularyService';
import type { TopicProgress } from '../lib/vocabularyService';
import { BookOpen, AlertCircle, Sparkles, CheckCircle } from 'lucide-react';

export const VocabularyPage: React.FC = () => {
  const { user, isMock } = useAuth();
  const { locale, t } = useLanguage();
  const navigate = useNavigate();

  const [topics, setTopics] = useState<TopicProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await fetchTopicsAndProgress(user.id, isMock);
      setTopics(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching vocabulary progress:', err);
      setError('Could not load vocabulary topics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user, isMock]);

  const handleAction = (topicId: string, mode: 'learn' | 'review') => {
    navigate(`/vocabulary/review?topic=${topicId}&mode=${mode}`);
  };

  if (loading) {
    return (
      <div className="flex justify-center align-center animate-fade-in" style={{ minHeight: '50vh', gap: 'var(--spacing-md)' }}>
        <div className="spinner" />
        <span className="body-md">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="vocabulary-container animate-fade-in">
      <div className="vocab-header-section">
        <h1 className="title-lg">{t('vocabulary.topics')}</h1>
        <p className="body-md">
          Master vocabulary topics using the Free Spaced Repetition Scheduler (FSRS).
        </p>
      </div>

      {error && (
        <div className="error-banner flex align-center gap-sm">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      <div className="topics-grid grid grid-cols-2 gap-lg">
        {topics.map(topic => {
          const isEn = locale === 'en';
          const name = isEn ? topic.name_en : topic.name_vi;
          const description = isEn ? topic.description_en : topic.description_vi;
          
          const progressPercent = topic.totalCards > 0 
            ? Math.round((topic.learnedCards / topic.totalCards) * 100) 
            : 0;

          return (
            <div key={topic.id} className="card vocab-topic-card flex flex-col justify-between">
              <div>
                <div className="flex justify-between align-center" style={{ marginBottom: 'var(--spacing-sm)' }}>
                  <span className="topic-badge">
                    <BookOpen size={14} style={{ marginRight: '4px' }} />
                    {topic.totalCards} {t('vocabulary.words')}
                  </span>
                  {progressPercent === 100 && (
                    <span className="topic-complete-badge flex align-center gap-xs">
                      <CheckCircle size={14} />
                      <span>Completed</span>
                    </span>
                  )}
                </div>

                <h2 className="title-sm topic-name">{name}</h2>
                <p className="body-sm topic-desc">{description}</p>
              </div>

              <div className="topic-footer-section">
                {/* Progress bar */}
                <div className="topic-progress-wrapper">
                  <div className="flex justify-between body-xs" style={{ marginBottom: '4px' }}>
                    <span>{t('vocabulary.learned', { learned: topic.learnedCards, total: topic.totalCards })}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="progress-bar-container">
                    <div 
                      className="progress-bar-fill" 
                      style={{ width: `${progressPercent}%` }} 
                    />
                  </div>
                </div>

                 {/* Actions */}
                <div className="topic-actions flex gap-sm" style={{ flexWrap: 'wrap' }}>
                  {topic.dueCards > 0 ? (
                    <button 
                      className="btn btn-primary btn-sm flex-1 flex align-center justify-center gap-xs"
                      onClick={() => handleAction(topic.id, 'review')}
                      style={{ minWidth: '100px' }}
                    >
                      <span>{t('vocabulary.startReview', { count: topic.dueCards })}</span>
                    </button>
                  ) : (
                    <button 
                      className="btn btn-outline btn-sm flex-1"
                      style={{ minWidth: '100px' }}
                      disabled
                    >
                      <span>0 due</span>
                    </button>
                  )}

                  {topic.learnedCards < topic.totalCards ? (
                    <button 
                      className="btn btn-secondary btn-sm flex-1 flex align-center justify-center gap-xs"
                      onClick={() => handleAction(topic.id, 'learn')}
                      style={{ minWidth: '100px' }}
                    >
                      <Sparkles size={14} style={{ color: 'var(--primary)' }} />
                      <span>{t('vocabulary.startLearn')}</span>
                    </button>
                  ) : (
                    <button 
                      className="btn btn-secondary btn-sm flex-1"
                      style={{ minWidth: '100px' }}
                      disabled
                    >
                      <span>All learned</span>
                    </button>
                  )}

                  <button 
                    className="btn btn-outline btn-sm flex-1"
                    onClick={() => navigate(`/writing/exercise?topic=${topic.id}`)}
                    style={{ minWidth: '80px' }}
                  >
                    <span>Quiz</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
