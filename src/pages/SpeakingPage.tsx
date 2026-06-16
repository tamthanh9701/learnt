import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { fetchSpeakingSessionsHistory } from '../lib/conversationService';
import type { ConversationSession } from '../lib/conversationService';
import { Mic, MessageSquare, Calendar, History, Sparkles } from 'lucide-react';

export const SpeakingPage: React.FC = () => {
  const { user, isMock } = useAuth();
  const { locale, t } = useLanguage();
  const navigate = useNavigate();

  const [history, setHistory] = useState<ConversationSession[]>([]);
  const [loading, setLoading] = useState(true);

  const isEn = locale === 'en';

  useEffect(() => {
    const loadHistory = async () => {
      if (!user) return;
      try {
        setLoading(true);
        const data = await fetchSpeakingSessionsHistory(user.id, isMock);
        setHistory(data);
      } catch (err) {
        console.error('Error fetching speaking sessions:', err);
      } finally {
        setLoading(false);
      }
    };
    loadHistory();
  }, [user, isMock]);

  return (
    <div className="speaking-container animate-fade-in">
      <div className="speaking-header-section">
        <h1 className="title-lg">{t('nav.speaking')}</h1>
        <p className="body-md">
          {isEn
            ? 'Practice English speaking and listening skills with AI. Speak directly into your microphone.'
            : 'Luyện kỹ năng nghe và nói tiếng Anh cùng AI. Nói trực tiếp qua micro của bạn.'}
        </p>
      </div>

      {/* Two main Modes */}
      <div className="grid grid-cols-2 gap-lg" style={{ marginTop: 'var(--spacing-lg)' }}>
        {/* Card 1: Conversation Partner */}
        <div className="card speaking-mode-card flex flex-col justify-between hover-grow">
          <div>
            <div className="mode-icon-box bg-primary-subtle" style={{ color: 'var(--primary)', marginBottom: 'var(--spacing-md)' }}>
              <MessageSquare size={28} />
            </div>
            <h2 className="title-md" style={{ marginBottom: 'var(--spacing-xs)' }}>
              {isEn ? 'AI Conversation Partner' : 'Đối tác trò chuyện AI'}
            </h2>
            <p className="body-sm" style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
              {isEn
                ? 'Engage in fluid dialogue with an interactive AI tutor. Practice active listening, response composition, and general speaking fluency.'
                : 'Tham gia đối thoại trôi chảy với gia sư AI tương tác. Thực hành nghe chủ động, phản xạ và nói lưu loát.'}
            </p>
          </div>
          <button 
            className="btn btn-primary btn-sm flex align-center justify-center gap-xs"
            onClick={() => navigate('/speaking/conversation')}
            style={{ width: '100%' }}
          >
            <Mic size={16} />
            <span>{isEn ? 'Start Conversation' : 'Bắt đầu trò chuyện'}</span>
          </button>
        </div>

        {/* Card 2: Pronunciation Drill */}
        <div className="card speaking-mode-card flex flex-col justify-between hover-grow">
          <div>
            <div className="mode-icon-box bg-secondary-subtle" style={{ color: 'var(--secondary)', marginBottom: 'var(--spacing-md)' }}>
              <Mic size={28} />
            </div>
            <h2 className="title-md" style={{ marginBottom: 'var(--spacing-xs)' }}>
              {isEn ? 'Pronunciation Drilling' : 'Luyện phát âm chuẩn'}
            </h2>
            <p className="body-sm" style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
              {isEn
                ? 'Read sentences aloud and receive immediate phonetic accuracy scores. Learn which specific syllables or words need correction.'
                : 'Đọc to các câu và nhận điểm số chính xác ngữ âm tức thì. Tìm hiểu từ hoặc âm tiết cụ thể nào cần sửa đổi.'}
            </p>
          </div>
          <button 
            className="btn btn-secondary btn-sm flex align-center justify-center gap-xs"
            onClick={() => navigate('/speaking/pronunciation')}
            style={{ width: '100%' }}
          >
            <Mic size={16} style={{ color: 'var(--primary)' }} />
            <span>{isEn ? 'Practice Pronunciation' : 'Luyện tập phát âm'}</span>
          </button>
        </div>
      </div>

      {/* History Area */}
      <div className="card history-card" style={{ marginTop: 'var(--spacing-xl)' }}>
        <div className="flex align-center gap-xs" style={{ marginBottom: 'var(--spacing-md)' }}>
          <History size={18} className="text-secondary" />
          <span className="title-sm">{isEn ? 'Recent Conversations' : 'Cuộc trò chuyện gần đây'}</span>
        </div>

        {loading ? (
          <div className="flex justify-center align-center" style={{ minHeight: '120px' }}>
            <div className="spinner" />
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col align-center justify-center text-center" style={{ padding: 'var(--spacing-lg)', color: 'var(--text-tertiary)' }}>
            <MessageSquare size={32} style={{ marginBottom: 'var(--spacing-xs)', opacity: 0.5 }} />
            <p className="body-sm">{isEn ? 'No conversation sessions yet.' : 'Chưa có cuộc trò chuyện nào.'}</p>
          </div>
        ) : (
          <div className="speaking-history-list flex flex-col gap-sm">
            {history.slice(0, 4).map(session => (
              <div 
                key={session.id} 
                className="history-item flex justify-between align-center"
                onClick={() => navigate(`/speaking/conversation?session=${session.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/speaking/conversation?session=${session.id}`); } }}
              >
                <div className="flex align-center gap-md">
                  <div className="success-badge-sm flex align-center justify-center bg-primary-subtle" style={{ color: 'var(--primary)' }}>
                    <MessageSquare size={16} />
                  </div>
                  <div className="flex flex-col">
                    <span className="body-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{session.topic}</span>
                    <span className="body-xs text-secondary flex align-center gap-xs" style={{ marginTop: '2px' }}>
                      <Calendar size={12} />
                      {new Date(session.created_at).toLocaleDateString(isEn ? 'en-US' : 'vi-VN')} • {session.messages.length} {isEn ? 'messages' : 'tin nhắn'}
                    </span>
                  </div>
                </div>
                <div className="history-score flex align-center gap-xs">
                  <Sparkles size={14} className="text-primary" />
                  <span className="body-xs font-semibold">{isEn ? 'View Chat' : 'Xem lại'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
