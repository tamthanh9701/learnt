import React, { useEffect, useRef, lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AIConfigProvider } from './contexts/AIContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/layout/Sidebar';
import { LoginPage } from './pages/LoginPage';

// Route-level code splitting keeps the initial bundle small; the heavy
// Pronunciation phoneme/TTS path only loads when a Learner opens that screen.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const VocabularyPage = lazy(() => import('./pages/VocabularyPage').then(m => ({ default: m.VocabularyPage })));
const ReviewPage = lazy(() => import('./pages/ReviewPage').then(m => ({ default: m.ReviewPage })));
const SpeakingPage = lazy(() => import('./pages/SpeakingPage').then(m => ({ default: m.SpeakingPage })));
const ConversationPage = lazy(() => import('./pages/ConversationPage').then(m => ({ default: m.ConversationPage })));
const PronunciationPage = lazy(() => import('./pages/PronunciationPage').then(m => ({ default: m.PronunciationPage })));
const WritingPage = lazy(() => import('./pages/WritingPage').then(m => ({ default: m.WritingPage })));
const ExercisePage = lazy(() => import('./pages/ExercisePage').then(m => ({ default: m.ExercisePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

// Inner app that handles Auth routing
const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the main region on route change so keyboard/SR users are not
  // stranded at the top of the page.
  useEffect(() => {
    mainRef.current?.focus();
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="flex justify-center align-center" style={{ minHeight: '100vh', gap: 'var(--spacing-md)' }}>
        <div className="spinner" />
        <span className="body-md">{t('common.loadingApp')}</span>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="app-layout">
      <button className="skip-link" onClick={() => mainRef.current?.focus()}>
        {t('a11y.skipToMain')}
      </button>
      <Sidebar />
      <main id="main-content" className="main-content-layout" tabIndex={-1} ref={mainRef}>
        <Suspense fallback={<div className="flex justify-center align-center" style={{ minHeight: '50vh' }}><div className="spinner" /></div>}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/vocabulary" element={<VocabularyPage />} />
            <Route path="/vocabulary/review" element={<ReviewPage />} />
            <Route path="/speaking" element={<SpeakingPage />} />
            <Route path="/speaking/conversation" element={<ConversationPage />} />
            <Route path="/speaking/pronunciation" element={<PronunciationPage />} />
            <Route path="/writing" element={<WritingPage />} />
            <Route path="/writing/exercise" element={<ExercisePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* Fallback to Dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <AIConfigProvider>
            <Router>
              <ErrorBoundary>
                <AppContent />
              </ErrorBoundary>
            </Router>
          </AIConfigProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
