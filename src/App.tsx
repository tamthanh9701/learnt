import React, { useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AIConfigProvider } from './contexts/AIContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/layout/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { VocabularyPage } from './pages/VocabularyPage';
import { ReviewPage } from './pages/ReviewPage';
import { SpeakingPage } from './pages/SpeakingPage';
import { ConversationPage } from './pages/ConversationPage';
import { PronunciationPage } from './pages/PronunciationPage';
import { WritingPage } from './pages/WritingPage';
import { ExercisePage } from './pages/ExercisePage';
import { SettingsPage } from './pages/SettingsPage';

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
