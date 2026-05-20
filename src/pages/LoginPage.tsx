import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { BookOpen, Moon, Sun, Languages } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { signIn, signUp, isMock } = useAuth();
  const { locale, setLocale, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'vi' : 'en');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      if (isSignUp) {
        if (!displayName.trim()) {
          setErrorMsg('Display name is required');
          setLoading(false);
          return;
        }
        const { error } = await signUp(email, password, displayName);
        if (error) setErrorMsg(error.message || 'Error signing up');
      } else {
        const { error } = await signIn(email, password);
        if (error) setErrorMsg(error.message || 'Invalid email or password');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      {/* Top Header toolbar */}
      <div className="login-toolbar">
        <button className="toolbar-btn" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="toolbar-btn" onClick={toggleLanguage}>
          <Languages size={18} />
          <span style={{ marginLeft: '4px', fontSize: '0.85rem' }}>
            {locale === 'en' ? 'VI' : 'EN'}
          </span>
        </button>
      </div>

      <div className="login-card-wrapper animate-fade-in">
        <div className="login-brand">
          <div className="brand-icon-container">
            <BookOpen size={32} className="brand-icon" />
          </div>
          <h1 className="login-title">{t('auth.title')}</h1>
          <p className="login-subtitle">{t('auth.subtitle')}</p>
        </div>

        {isMock && (
          <div className="demo-banner">
            <strong>ℹ️ Demo Mode:</strong> You can sign in or sign up with any email and password. No verification required. Data will be saved locally.
          </div>
        )}

        {errorMsg && (
          <div className="error-banner">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          {isSignUp && (
            <div className="form-group">
              <label className="label">{t('auth.displayName')}</label>
              <input
                type="text"
                className="input"
                placeholder="John Doe"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="label">{t('auth.email')}</label>
            <input
              type="email"
              className="input"
              placeholder="name@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="label">{t('auth.password')}</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading 
              ? (isSignUp ? t('auth.signingUp') : t('auth.signingIn'))
              : (isSignUp ? t('auth.signUp') : t('auth.signIn'))
            }
          </button>
        </form>

        <button 
          className="toggle-auth-btn" 
          onClick={() => {
            setIsSignUp(!isSignUp);
            setErrorMsg('');
          }}
        >
          {isSignUp ? t('auth.alreadyHaveAccount') : t('auth.dontHaveAccount')}
        </button>
      </div>
    </div>
  );
};
