import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { fetchTopicsAndProgress, VocabError } from '../lib/vocabularyService';
import type { TopicProgress, VocabErrorKind } from '../lib/vocabularyService';
import { BookOpen, AlertCircle, Sparkles, CheckCircle, RefreshCw } from 'lucide-react';

export const VocabularyPage: React.FC = () => {
  const { user, isMock } = useAuth();
  const { locale, t } = useLanguage();
  const navigate = useNavigate();

  const [topics, setTopics] = useState<TopicProgress[]>([]);
  const [loading, setLoading] = useState(true);
  // CH4: keep both the error KIND (for branching the message) and
  // the raw message (for diagnostics). Pre-fix this was a single
  // opaque "Could not load vocabulary topics" string and the
  // user had no way to know whether RLS, network, or empty data
  // was the cause.
  const [error, setError] = useState<{ kind: VocabErrorKind; message: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchTopicsAndProgress(user.id, isMock);
      setTopics(data);
    } catch (err) {
      console.error('Error fetching vocabulary progress:', err);
      if (err instanceof VocabError) {
        setError({ kind: err.kind, message: err.message });
      } else if (err instanceof Error) {
        // Unknown error shape (not from our service). Best-guess:
        // it's a fetch failure.
        setError({ kind: 'fetch_failed', message: err.message });
      } else {
        setError({ kind: 'fetch_failed', message: String(err) });
      }
    } finally {
      setLoading(false);
    }
  }, [user, isMock]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

  if (error) {
    // CH4: branch the user-facing copy on error.kind.
    // seed_failed -> RLS / DB-permissions issue, suggest checking policies
    // fetch_failed -> network / auth, suggest retry or sign-in
    // empty       -> database is reachable but empty, suggest Reset
    const isEn = locale === 'en';
    const titleByKind: Record<VocabErrorKind, { en: string; vi: string }> = {
      seed_failed: {
        en: 'Could not load vocabulary topics (database permission error).',
        vi: 'Không tải được chủ đề từ vựng (lỗi quyền cơ sở dữ liệu).',
      },
      fetch_failed: {
        en: 'Could not reach the database.',
        vi: 'Không kết nối được với cơ sở dữ liệu.',
      },
      empty: {
        en: 'The topics table is empty.',
        vi: 'Bảng chủ đề đang trống.',
      },
    };
    const hintByKind: Record<VocabErrorKind, { en: string; vi: string }> = {
      seed_failed: {
        en: 'Most often this is a Supabase RLS policy blocking the authenticated user from writing to the topics / flashcards tables. The seed insert was rejected. If you are the project owner, add an INSERT policy for authenticated users, or run a service_role migration.',
        vi: 'Thường là do chính sách RLS của Supabase chặn người dùng đã đăng nhập ghi vào bảng topics / flashcards. Nếu bạn là chủ dự án, hãy thêm chính sách INSERT cho người dùng đã xác thực, hoặc chạy migration với service_role.',
      },
      fetch_failed: {
        en: 'Check your network connection and that you are still signed in. Tap Retry below to try again.',
        vi: 'Kiểm tra kết nối mạng và xác nhận bạn vẫn đang đăng nhập. Nhấn "Thử lại" bên dưới.',
      },
      empty: {
        en: 'The topics table is reachable but has no rows. The auto-seed step may have failed silently. Try the "Reset Progress" action in Settings to re-trigger the seed.',
        vi: 'Bảng topics có thể truy cập nhưng không có dòng nào. Bước tự động seed có thể đã lỗi. Hãy thử "Đặt lại dữ liệu" trong phần Cài đặt để seed lại.',
      },
    };
    const title = titleByKind[error.kind][isEn ? 'en' : 'vi'];
    const hint = hintByKind[error.kind][isEn ? 'en' : 'vi'];
    return (
      <div className="vocabulary-container animate-fade-in">
        <div className="vocab-header-section">
          <h1 className="title-lg">{t('vocabulary.topics')}</h1>
        </div>
        <div className="card error-card flex flex-col gap-sm" role="alert" aria-live="assertive">
          <div className="flex align-center gap-xs">
            <AlertCircle size={20} style={{ color: 'var(--error)', flexShrink: 0 }} aria-hidden="true" />
            <span className="title-xs" style={{ color: 'var(--error)' }}>{title}</span>
          </div>
          <p className="body-sm" style={{ color: 'var(--text-secondary)' }}>{hint}</p>
          {error.message && (
            <details>
              <summary className="body-xs" style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                {isEn ? 'Show technical details' : 'Xem chi tiết kỹ thuật'}
              </summary>
              <pre className="body-xs" style={{
                marginTop: '6px',
                padding: '8px',
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-sm)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--text-secondary)',
              }}>{error.message}</pre>
            </details>
          )}
          <div className="flex gap-sm" style={{ marginTop: 'var(--spacing-xs)' }}>
            <button
              className="btn btn-primary btn-sm flex align-center gap-xs"
              onClick={() => void loadData()}
              aria-label={isEn ? 'Retry loading vocabulary topics' : 'Thử lại tải chủ đề từ vựng'}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>{isEn ? 'Retry' : 'Thử lại'}</span>
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => navigate('/settings')}
            >
              <span>{isEn ? 'Open Settings' : 'Mở Cài đặt'}</span>
            </button>
          </div>
        </div>
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
