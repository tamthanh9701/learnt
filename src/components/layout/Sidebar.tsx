import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTheme } from '../../contexts/ThemeContext';
import { 
  LayoutDashboard, 
  BookOpen, 
  Mic, 
  PenTool, 
  Settings, 
  LogOut, 
  Sun, 
  Moon, 
  Languages, 
  Flame, 
  Menu, 
  X 
} from 'lucide-react';
import { displayStreak, dayKey } from '../../lib/streak';

export const Sidebar: React.FC = () => {
  const { user, profile, signOut, isMock } = useAuth();
  const { locale, setLocale, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const shownStreak = displayStreak(profile?.current_streak, profile?.last_activity_date, dayKey(new Date()));

  const toggleSidebar = () => setIsOpen(!isOpen);

  const toggleLanguage = () => {
    setLocale(locale === 'en' ? 'vi' : 'en');
  };

  const navItems = [
    { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/vocabulary', label: t('nav.vocabulary'), icon: BookOpen },
    { to: '/speaking', label: t('nav.speaking'), icon: Mic },
    { to: '/writing', label: t('nav.writing'), icon: PenTool },
    { to: '/settings', label: t('nav.settings'), icon: Settings },
  ];

  if (!user) return null;

  return (
    <>
      {/* Mobile Top Header */}
      <header className="mobile-header">
        <button className="mobile-menu-btn" onClick={toggleSidebar}>
          <Menu size={24} />
        </button>
        <span className="brand-title">LearnT</span>
        <div className="mobile-stats">
          <Flame className="streak-icon-active" size={18} />
            <span className="streak-count">{shownStreak}</span>
        </div>
      </header>

      {/* Sidebar Container */}
      <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <span className="brand-logo">LearnT</span>
          <span className="brand-badge">{isMock ? 'Demo' : 'Cloud'}</span>
          <button className="mobile-close-btn" onClick={toggleSidebar}>
            <X size={20} />
          </button>
        </div>

        {/* User profile brief stats */}
        <div className="sidebar-profile-card">
          <div className="profile-info">
            <span className="profile-name">{profile?.display_name || user.email?.split('@')[0]}</span>
            <span className="profile-email">{user.email}</span>
          </div>
          <div className="profile-streak-badge">
            <Flame className="streak-icon-active" />
            <div className="streak-details">
                <span className="streak-num">{shownStreak}</span>
              <span className="streak-lbl">{t('dashboard.streak')}</span>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavLink 
              key={item.to} 
              to={item.to} 
              className={({ isActive }) => `nav-link-item ${isActive ? 'active' : ''}`}
              onClick={() => setIsOpen(false)}
            >
              <item.icon size={20} className="nav-icon" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer actions: Theme toggle, Language toggle, Sign out */}
        <div className="sidebar-footer">
          <div className="quick-actions">
            <button 
              className="footer-btn" 
              onClick={toggleTheme} 
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>

            <button 
              className="footer-btn" 
              onClick={toggleLanguage} 
              title="Toggle Language"
            >
              <Languages size={18} />
              <span>{locale === 'en' ? 'Tiếng Việt' : 'English'}</span>
            </button>
          </div>

          <button className="signout-btn" onClick={() => signOut()}>
            <LogOut size={18} />
            <span>{t('auth.signOut')}</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar overlay */}
      {isOpen && <button className="sidebar-overlay" aria-label={t('a11y.closeMenu')} onClick={toggleSidebar} />}
    </>
  );
};
