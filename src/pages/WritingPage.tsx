import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAI } from '../contexts/AIContext';
import {
  submitWritingContent,
  fetchWritingSubmissions,
  seedWritingPrompts
} from '../lib/writingService';
import type { WritingPrompt, WritingSubmission } from '../lib/writingService';
import { PenTool, CheckCircle, ChevronRight, History, Sparkles, MessageSquare, AlertCircle } from 'lucide-react';

export const WritingPage: React.FC = () => {
  const { user, isMock } = useAuth();
  const { locale, t } = useLanguage();
  const { config: aiConfig } = useAI();

  const [prompts] = useState<WritingPrompt[]>(seedWritingPrompts);
  const [selectedPrompt, setSelectedPrompt] = useState<WritingPrompt>(seedWritingPrompts[0]);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Results & History
  const [currentFeedback, setCurrentFeedback] = useState<WritingSubmission | null>(null);
  const [history, setHistory] = useState<WritingSubmission[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Stats
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const charCount = content.length;

  const loadHistory = async () => {
    if (!user) return;
    try {
      setLoadingHistory(true);
      const data = await fetchWritingSubmissions(user.id, isMock);
      setHistory(data);
    } catch (err) {
      console.error('Error fetching writing history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [user, isMock]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !content.trim() || submitting) return;

    try {
      setSubmitting(true);
      const promptTitle = locale === 'en' ? selectedPrompt.title_en : selectedPrompt.title_vi;
      const submission = await submitWritingContent(user.id, promptTitle, content, isMock, aiConfig);
      setCurrentFeedback(submission);
      
      // Add to list history
      setHistory(prev => [submission, ...prev]);
    } catch (err) {
      console.error('Error submitting essay:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyRevision = () => {
    if (currentFeedback) {
      setContent(currentFeedback.ai_feedback.revised_text);
    }
  };

  const handleSelectHistoryItem = (item: WritingSubmission) => {
    setCurrentFeedback(item);
    setContent(item.content);
    // Find prompt in prompts that matches item.prompt title or construct a temporary prompt
    const matchedPrompt = prompts.find(p => p.title_en === item.prompt || p.title_vi === item.prompt);
    if (matchedPrompt) {
      setSelectedPrompt(matchedPrompt);
    } else {
      setSelectedPrompt({
        id: 'custom',
        title_en: item.prompt,
        title_vi: item.prompt,
        description_en: 'Previous submission topic',
        description_vi: 'Chủ đề của bài nộp trước',
        suggested_words: 100
      });
    }
  };

  const handleStartNew = () => {
    setCurrentFeedback(null);
    setContent('');
  };

  const isEn = locale === 'en';

  return (
    <div className="writing-container animate-fade-in">
      <div className="writing-header">
        <h1 className="title-lg">{t('writing.title')}</h1>
        <p className="body-md">
          {isEn
            ? 'Practice English essay writing and get instant grammatical proofreading and corrections powered by AI.'
            : 'Luyện viết luận tiếng Anh và nhận đánh giá, sửa lỗi ngữ pháp tức thì từ AI.'}
        </p>
      </div>

      <div className="grid grid-cols-12 gap-lg" style={{ marginTop: 'var(--spacing-lg)' }}>
        {/* Editor & Prompt panel */}
        <div className="col-span-7 flex flex-col gap-lg">
          <div className="card prompt-picker-card">
            <h2 className="title-xs" style={{ marginBottom: 'var(--spacing-sm)' }}>
              {isEn ? 'Choose a Writing Topic' : 'Chọn chủ đề bài viết'}
            </h2>
            <div className="prompt-selector-tabs flex gap-xs flex-wrap" style={{ marginBottom: 'var(--spacing-md)' }}>
              {prompts.map(p => {
                const title = isEn ? p.title_en : p.title_vi;
                const isSelected = selectedPrompt.id === p.id;
                return (
                  <button
                    key={p.id}
                    className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => {
                      setSelectedPrompt(p);
                      handleStartNew();
                    }}
                  >
                    {title}
                  </button>
                );
              })}
            </div>
            
            <div className="prompt-details-box">
              <p className="body-sm font-medium" style={{ color: 'var(--text-primary)', marginBottom: '4px' }}>
                {isEn ? selectedPrompt.description_en : selectedPrompt.description_vi}
              </p>
              <span className="body-xs" style={{ color: 'var(--text-tertiary)' }}>
                {isEn ? `Suggested length: ${selectedPrompt.suggested_words} words` : `Độ dài gợi ý: ${selectedPrompt.suggested_words} từ`}
              </span>
            </div>
          </div>

          <div className="card editor-card flex-1 flex flex-col">
            <div className="flex justify-between align-center" style={{ marginBottom: 'var(--spacing-sm)' }}>
              <div className="flex align-center gap-xs">
                <PenTool size={16} className="text-secondary" />
                <span className="title-xs">{isEn ? 'Draft Editor' : 'Soạn thảo văn bản'}</span>
              </div>
              <button 
                className="btn btn-outline btn-xs" 
                onClick={handleStartNew}
                style={{ fontSize: 'var(--font-xs)', padding: '4px 8px' }}
              >
                {isEn ? 'Clear / New' : 'Làm mới'}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-md">
              <textarea
                className="input flex-1"
                placeholder={isEn ? "Write your essay here... (minimum 10 words)" : "Viết bài luận của bạn tại đây... (tối thiểu 10 từ)"}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={submitting}
                style={{ minHeight: '300px' }}
              />

              <div className="flex justify-between align-center flex-wrap gap-sm">
                <div className="editor-stats flex gap-md">
                  <span className="stat-item body-xs">
                    <strong>{wordCount}</strong> {isEn ? 'words' : 'từ'}
                  </span>
                  <span className="stat-item body-xs">
                    <strong>{charCount}</strong> {isEn ? 'chars' : 'ký tự'}
                  </span>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-sm flex align-center gap-xs"
                  disabled={submitting || wordCount < 10}
                >
                  <Sparkles size={16} />
                  <span>{submitting ? (isEn ? 'Analyzing...' : 'Đang phân tích...') : (isEn ? 'Get AI Feedback' : 'Nhận nhận xét AI')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* AI Feedback / Submissions panel */}
        <div className="col-span-5 flex flex-col gap-lg" style={{ minHeight: '100%' }}>
          {currentFeedback ? (
            <div className="card feedback-card animate-fade-in flex flex-col" style={{ height: '100%' }}>
              <div className="flex justify-between align-center" style={{ marginBottom: 'var(--spacing-md)' }}>
                <div className="flex align-center gap-xs">
                  <Sparkles size={18} className="text-primary" />
                  <span className="title-sm">{isEn ? 'AI Analysis Report' : 'Báo cáo Phân tích AI'}</span>
                </div>
                <div className="score-badge flex align-center justify-center">
                  <span className="score-val">{currentFeedback.ai_feedback.overall_score}</span>
                  <span className="score-max">/100</span>
                </div>
              </div>

              {/* Strengths */}
              <div className="feedback-section" style={{ marginBottom: 'var(--spacing-md)' }}>
                <h3 className="title-xs flex align-center gap-xs text-success" style={{ marginBottom: '6px' }}>
                  <CheckCircle size={14} />
                  <span>{isEn ? 'Strengths' : 'Điểm mạnh'}</span>
                </h3>
                <ul className="strength-list flex flex-col gap-xs">
                  {currentFeedback.ai_feedback.strengths.map((str, idx) => (
                    <li key={idx} className="body-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      • {str}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Grammar Corrections */}
              <div className="feedback-section flex-1" style={{ marginBottom: 'var(--spacing-md)' }}>
                <h3 className="title-xs flex align-center gap-xs text-warning" style={{ marginBottom: '8px' }}>
                  <AlertCircle size={14} />
                  <span>{isEn ? 'Grammar & spelling corrections' : 'Lỗi chính tả & Ngữ pháp'}</span>
                </h3>
                
                {currentFeedback.ai_feedback.errors.length === 0 ? (
                  <div className="no-errors-box flex align-center gap-xs">
                    <CheckCircle size={16} className="text-success" />
                    <span className="body-xs" style={{ color: 'var(--text-secondary)' }}>
                      {isEn ? 'Fantastic grammar! No obvious errors found.' : 'Ngữ pháp tuyệt vời! Không phát hiện lỗi sai.'}
                    </span>
                  </div>
                ) : (
                  <div className="error-scroll-container flex flex-col gap-sm" style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                    {currentFeedback.ai_feedback.errors.map((err, idx) => (
                      <div key={idx} className="error-item">
                        <div className="flex align-center gap-xs" style={{ marginBottom: '2px' }}>
                          <span className="badge-wrong body-xs">{err.original}</span>
                          <ChevronRight size={12} style={{ color: 'var(--text-tertiary)' }} />
                          <span className="badge-correct body-xs">{err.corrected}</span>
                        </div>
                        <p className="body-xs error-explanation">{err.explanation}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI suggestions */}
              <div className="feedback-section" style={{ marginBottom: 'var(--spacing-lg)' }}>
                <h3 className="title-xs flex align-center gap-xs text-secondary" style={{ marginBottom: '6px' }}>
                  <MessageSquare size={14} />
                  <span>{isEn ? 'Recommendations' : 'Gợi ý cải thiện'}</span>
                </h3>
                <ul className="suggestion-list flex flex-col gap-xs">
                  {currentFeedback.ai_feedback.suggestions.map((sug, idx) => (
                    <li key={idx} className="body-xs" style={{ color: 'var(--text-secondary)' }}>
                      - {sug}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action */}
              <button 
                type="button" 
                className="btn btn-secondary btn-sm flex align-center justify-center gap-xs"
                onClick={handleApplyRevision}
                style={{ width: '100%' }}
              >
                <Sparkles size={16} style={{ color: 'var(--primary)' }} />
                <span>{isEn ? 'Apply AI Suggested Rewrite' : 'Áp dụng bản sửa đổi AI'}</span>
              </button>
            </div>
          ) : (
            <div className="card history-card flex flex-col" style={{ height: '100%' }}>
              <div className="flex align-center gap-xs" style={{ marginBottom: 'var(--spacing-md)' }}>
                <History size={18} className="text-secondary" />
                <span className="title-sm">{isEn ? 'Writing Submissions History' : 'Lịch sử nộp bài'}</span>
              </div>

              {loadingHistory ? (
                <div className="flex justify-center align-center flex-1">
                  <div className="spinner" />
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col align-center justify-center text-center flex-1" style={{ color: 'var(--text-tertiary)', padding: 'var(--spacing-lg)' }}>
                  <PenTool size={32} style={{ marginBottom: 'var(--spacing-xs)', opacity: 0.5 }} />
                  <p className="body-sm">{isEn ? 'No submissions yet.' : 'Chưa có bài nộp nào.'}</p>
                  <p className="body-xs" style={{ marginTop: '4px' }}>
                    {isEn ? 'Submit an essay to view analytics history.' : 'Nộp bài luận đầu tiên để lưu vào lịch sử.'}
                  </p>
                </div>
              ) : (
                <div className="submissions-list flex flex-col gap-sm" style={{ overflowY: 'auto', flex: 1, maxHeight: '420px' }}>
                  {history.map(item => (
                    <div 
                      key={item.id} 
                      className="history-item flex justify-between align-center"
                      onClick={() => handleSelectHistoryItem(item)}
                    >
                      <div className="flex flex-col" style={{ overflow: 'hidden', paddingRight: '8px' }}>
                        <span className="body-xs font-semibold text-truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.prompt}
                        </span>
                        <span className="body-xs text-secondary">
                          {item.word_count} {isEn ? 'words' : 'từ'} • {new Date(item.created_at).toLocaleDateString(isEn ? 'en-US' : 'vi-VN')}
                        </span>
                      </div>
                      <div className="history-score flex align-center justify-center">
                        <strong>{item.ai_feedback.overall_score}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
