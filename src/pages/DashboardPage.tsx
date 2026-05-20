import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Flame, BookOpen, Mic, PenTool, ArrowRight, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const DashboardPage: React.FC = () => {
  const { user, profile, isMock } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [dueCount, setDueCount] = useState(0);
  const [reviewedToday, setReviewedToday] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchDashboardStats = async () => {
      setLoading(true);
      try {
        if (isMock) {
          // Simulate loading mock data from localStorage
          const savedCards = localStorage.getItem(`learnt_learner_cards_${user.id}`);
          let due = 0;
          if (savedCards) {
            const cards = JSON.parse(savedCards);
            const now = new Date();
            due = cards.filter((c: any) => new Date(c.due) <= now).length;
          } else {
            // Set 5 default due cards for first-time use
            due = 5;
          }
          setDueCount(due);

          // Get daily progress
          const today = new Date().toISOString().split('T')[0];
          const savedProgress = localStorage.getItem(`learnt_progress_${user.id}_${today}`);
          if (savedProgress) {
            const p = JSON.parse(savedProgress);
            setReviewedToday(p.cards_reviewed || 0);
          } else {
            setReviewedToday(0);
          }
        } else {
          // Fetch from Supabase
          // 1. Count due cards
          const now = new Date().toISOString();
          const { count, error: cardError } = await supabase
            .from('learner_cards')
            .select('*', { count: 'exact', head: true })
            .eq('learner_id', user.id)
            .lte('due', now);

          if (!cardError && count !== null) {
            setDueCount(count);
          }

          // 2. Fetch today's progress
          const today = new Date().toISOString().split('T')[0];
          const { data, error: progError } = await supabase
            .from('daily_progress')
            .select('cards_reviewed')
            .eq('learner_id', user.id)
            .eq('activity_date', today)
            .single();

          if (!progError && data) {
            setReviewedToday(data.cards_reviewed);
          }
        }
      } catch (err) {
        console.error('Error fetching dashboard stats:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardStats();
  }, [user, isMock]);

  const dailyGoal = profile?.daily_goal || 20;
  const progressPercent = Math.min(100, Math.round((reviewedToday / dailyGoal) * 100));

  const handleStartReview = () => {
    navigate('/vocabulary/review');
  };

  if (loading) {
    return (
      <div className="flex justify-center align-center animate-fade-in" style={{ minHeight: '50vh', gap: 'var(--spacing-md)' }}>
        <div className="spinner" />
        <span className="body-md">Loading stats...</span>
      </div>
    );
  }

  return (
    <div className="dashboard-container">

      {/* Welcome Banner */}
      <section className="welcome-section">
        <h1 className="title-xl">
          Hi, {profile?.display_name || user?.email?.split('@')[0]}!
        </h1>
        <p className="body-md">
          {t('dashboard.streakInactive')}
        </p>
      </section>

      {/* Stats Cards Section */}
      <section className="stats-grid grid grid-cols-2 gap-md">
        {/* Streak Card */}
        <div className="card streak-card flex align-center gap-md">
          <div className="streak-icon-container">
            <Flame className="streak-icon-active" size={32} />
          </div>
          <div>
            <h2 className="title-sm">{t('dashboard.streak')}</h2>
            <p className="title-md">
              {profile?.current_streak 
                ? t('dashboard.streakActive', { count: profile.current_streak })
                : '0 ' + t('dashboard.streak').toLowerCase()
              }
            </p>
          </div>
        </div>

        {/* Daily Goal Card */}
        <div className="card goal-card flex flex-col justify-between">
          <div className="flex justify-between align-center">
            <h2 className="title-sm">{t('dashboard.dailyGoal')}</h2>
            {progressPercent >= 100 && (
              <span className="goal-complete-badge">
                <CheckCircle2 size={16} />
              </span>
            )}
          </div>
          <div className="goal-progress-wrapper">
            <div className="progress-bar-container">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${progressPercent}%` }} 
              />
            </div>
            <div className="goal-stats flex justify-between align-center">
              <span className="body-xs">
                {t('dashboard.goalStatus', { reviewed: reviewedToday, total: dailyGoal })}
              </span>
              <span className="title-sm">{progressPercent}%</span>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Action / Due Card Alert Banner */}
      {dueCount > 0 ? (
        <div className="card due-alert-card flex align-center justify-between">
          <div className="flex align-center gap-md">
            <div className="alert-badge">{dueCount}</div>
            <div>
              <h3 className="title-sm" style={{ marginBottom: '2px' }}>
                {t('dashboard.quickReview')}
              </h3>
              <p className="body-xs" style={{ margin: 0 }}>
                You have cards waiting to be reviewed in your FSRS schedule
              </p>
            </div>
          </div>
          <button className="btn btn-primary btn-sm flex align-center gap-xs" onClick={handleStartReview}>
            <span>Review Now</span>
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="card no-due-card flex align-center gap-md">
          <CheckCircle2 size={24} className="success-icon" style={{ color: 'var(--success)' }} />
          <div>
            <h3 className="title-sm" style={{ margin: 0 }}>
              {t('dashboard.noDueCards')}
            </h3>
            <p className="body-xs" style={{ margin: 0 }}>
              Check back later or learn some new words!
            </p>
          </div>
        </div>
      )}

      {/* Learning Modules Section */}
      <section className="learning-modules-section">
        <h2 className="title-md" style={{ marginBottom: 'var(--spacing-md)' }}>
          Start Practicing
        </h2>
        <div className="modules-list flex flex-col gap-md">
          {/* Vocabulary Module Card */}
          <div className="card card-interactive module-card flex justify-between align-center" onClick={() => navigate('/vocabulary')}>
            <div className="flex align-center gap-md">
              <div className="module-icon-container vocab-theme">
                <BookOpen size={24} />
              </div>
              <div>
                <h3 className="title-sm">{t('dashboard.modules.vocabTitle')}</h3>
                <p className="body-sm">{t('dashboard.modules.vocabDesc')}</p>
              </div>
            </div>
            <ArrowRight size={20} className="arrow-icon" />
          </div>

          {/* Speaking Module Card */}
          <div className="card card-interactive module-card flex justify-between align-center" onClick={() => navigate('/speaking')}>
            <div className="flex align-center gap-md">
              <div className="module-icon-container speaking-theme">
                <Mic size={24} />
              </div>
              <div>
                <h3 className="title-sm">{t('dashboard.modules.speakingTitle')}</h3>
                <p className="body-sm">{t('dashboard.modules.speakingDesc')}</p>
              </div>
            </div>
            <ArrowRight size={20} className="arrow-icon" />
          </div>

          {/* Writing Module Card */}
          <div className="card card-interactive module-card flex justify-between align-center" onClick={() => navigate('/writing')}>
            <div className="flex align-center gap-md">
              <div className="module-icon-container writing-theme">
                <PenTool size={24} />
              </div>
              <div>
                <h3 className="title-sm">{t('dashboard.modules.writingTitle')}</h3>
                <p className="body-sm">{t('dashboard.modules.writingDesc')}</p>
              </div>
            </div>
            <ArrowRight size={20} className="arrow-icon" />
          </div>
        </div>
      </section>
    </div>
  );
};
