import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Flame, BookOpen, Mic, PenTool, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { withTimeout, TimeoutError } from '../lib/timeout';
import { displayStreak, dayKey } from '../lib/streak';

export const DashboardPage: React.FC = () => {
  const { user, profile, isMock } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const shownStreak = displayStreak(profile?.current_streak, profile?.last_activity_date, dayKey(new Date()));

  const [dueCount, setDueCount] = useState(0);
  const [reviewedToday, setReviewedToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  const fetchDashboardStats = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setStatsError(false);
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
        // Fetch from Supabase — each query gets its own 8 s AbortController
        // timeout so a slow / hung backend cannot leave setLoading(false)
        // un-called and the user staring at the spinner forever.
        const now = new Date().toISOString();
        const today = dayKey(new Date());

        // 1. Count due cards.
        const cardRes = await withTimeout(
          async (signal) => {
            const { count, error } = await supabase
              .from('learner_cards')
              .select('*', { count: 'exact', head: true })
              .eq('learner_id', user.id)
              .lte('due', now)
              .abortSignal(signal);
            if (error) throw error;
            return count;
          },
          8_000,
          'DashboardPage: due cards count',
        );
        if (typeof cardRes === 'number') setDueCount(cardRes);

        // 2. Fetch today's progress.
        const progRes = await withTimeout(
          async (signal) => {
            const { data, error } = await supabase
              .from('daily_progress')
              .select('cards_reviewed')
              .eq('learner_id', user.id)
              .eq('activity_date', today)
              .abortSignal(signal)
              .maybeSingle();
            // PGRST116 = row not found, perfectly fine here.
            if (error && error.code !== 'PGRST116') throw error;
            return data;
          },
          8_000,
          'DashboardPage: daily progress',
        );
        if (progRes) {
          setReviewedToday(progRes.cards_reviewed);
        }
      }
    } catch (err) {
      // A TimeoutError here just means the cloud was slow / unreachable;
      // we degrade gracefully to "0" rather than spinning forever.
      if (err instanceof TimeoutError) {
        console.warn('Dashboard stats timed out — showing zeros:', err.message);
        setDueCount(0);
        setReviewedToday(0);
      } else {
        console.error('Error fetching dashboard stats:', err);
        setStatsError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [user, isMock]);

  useEffect(() => {
    fetchDashboardStats();
  }, [fetchDashboardStats]);

  const dailyGoal = profile?.daily_goal || 20;
  const progressPercent = Math.min(100, Math.round((reviewedToday / dailyGoal) * 100));

  const handleStartReview = () => {
    navigate('/vocabulary/review');
  };

  if (loading) {
    return (
      <div className="flex justify-center align-center animate-fade-in" style={{ minHeight: '50vh', gap: 'var(--spacing-md)' }}>
        <div className="spinner" />
        <span className="body-md">{t('dashboard.loadingStats')}</span>
      </div>
    );
  }

  return (
    <div className="dashboard-container">

      {/* Welcome Banner */}
      <section className="welcome-section">
        <h1 className="title-xl">
          {t('dashboard.greeting', { name: profile?.display_name || user?.email?.split('@')[0] || '' })}
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
              {shownStreak
                ? t('dashboard.streakActive', { count: shownStreak })
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
      {statsError ? (
        <div className="card due-alert-card flex align-center justify-between" role="alert">
          <div className="flex align-center gap-md">
            <AlertCircle size={24} style={{ color: 'var(--warning)' }} />
            <div>
              <h3 className="title-sm" style={{ margin: 0 }}>{t('common.error')}</h3>
              <p className="body-xs" style={{ margin: 0 }}>{t('dashboard.statsError')}</p>
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={fetchDashboardStats}>
            {t('common.tryAgain')}
          </button>
        </div>
      ) : dueCount > 0 ? (
        <div className="card due-alert-card flex align-center justify-between">
          <div className="flex align-center gap-md">
            <div className="alert-badge">{dueCount}</div>
            <div>
              <h3 className="title-sm" style={{ marginBottom: '2px' }}>
                {t('dashboard.quickReview')}
              </h3>
              <p className="body-xs" style={{ margin: 0 }}>
                {t('dashboard.dueAlertDesc')}
              </p>
            </div>
          </div>
          <button className="btn btn-primary btn-sm flex align-center gap-xs" onClick={handleStartReview}>
            <span>{t('dashboard.reviewNow')}</span>
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
              {t('dashboard.noDueDesc')}
            </p>
          </div>
        </div>
      )}

      {/* Learning Modules Section */}
      <section className="learning-modules-section">
        <h2 className="title-md" style={{ marginBottom: 'var(--spacing-md)' }}>
          {t('dashboard.startPracticing')}
        </h2>
        <div className="modules-list flex flex-col gap-md">
          {/* Vocabulary Module Card */}
          <div
            className="card card-interactive module-card flex justify-between align-center"
            onClick={() => navigate('/vocabulary')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/vocabulary'); } }}
          >
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
          <div
            className="card card-interactive module-card flex justify-between align-center"
            onClick={() => navigate('/speaking')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/speaking'); } }}
          >
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
          <div
            className="card card-interactive module-card flex justify-between align-center"
            onClick={() => navigate('/writing')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/writing'); } }}
          >
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
