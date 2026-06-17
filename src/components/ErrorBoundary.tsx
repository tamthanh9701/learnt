import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * Localized fallback UI. Kept as a separate functional component so it can use
 * the useLanguage hook (a class component cannot). The boundary is mounted
 * inside LanguageProvider, so t() resolves in the active locale.
 */
const ErrorFallback: React.FC = () => {
  const { t } = useLanguage();
  return (
    <div
      role="alert"
      className="error-boundary-fallback flex flex-col align-center justify-center"
      style={{ minHeight: '100dvh', gap: 'var(--spacing-md)', textAlign: 'center', padding: 'var(--spacing-lg)' }}
    >
      <h1 className="title-md">{t('errors.boundaryTitle')}</h1>
      <p className="body-md">{t('errors.boundaryMessage')}</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        {t('errors.reload')}
      </button>
    </div>
  );
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('ErrorBoundary caught an error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
