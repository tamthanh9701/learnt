import React, { createContext, useContext, useState } from 'react';
import en from '../i18n/en.json';
import vi from '../i18n/vi.json';

type Locale = 'en' | 'vi';

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<Locale, any> = { en, vi };

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load initial locale from localStorage or browser settings
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('learnt_locale') as Locale;
    if (saved === 'en' || saved === 'vi') return saved;
    return navigator.language.startsWith('vi') ? 'vi' : 'en';
  });

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('learnt_locale', newLocale);
  };

  // Helper to translate dot-notation key (e.g. 'dashboard.streak')
  const t = (key: string, replacements?: Record<string, string | number>): string => {
    const parts = key.split('.');
    let current = translations[locale];
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        // Return key name if translation not found
        return key;
      }
    }

    if (typeof current !== 'string') {
      return key;
    }

    let text = current;
    if (replacements) {
      Object.entries(replacements).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }

    return text;
  };

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
