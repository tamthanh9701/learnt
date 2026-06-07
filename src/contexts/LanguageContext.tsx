import React, { createContext, useContext, useState, useEffect } from 'react';
import en from '../i18n/en.json';
import vi from '../i18n/vi.json';

type Locale = 'en' | 'vi';
type TranslationLeaf = string | { [key: string]: TranslationLeaf };
type Translations = { [K in Locale]: TranslationLeaf };

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Translations = { en, vi };

// Walk a dot-notation key through a translation tree; returns the string value
// or undefined if any segment is missing or the leaf is not a string.
const lookup = (tree: TranslationLeaf, parts: string[]): string | undefined => {
  let current: TranslationLeaf = tree;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load initial locale from localStorage or browser settings
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('learnt_locale') as Locale;
    if (saved === 'en' || saved === 'vi') return saved;
    return navigator.language.startsWith('vi') ? 'vi' : 'en';
  });

  // Keep the document language in sync so assistive tech announces content
  // with the correct language profile.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('learnt_locale', newLocale);
  };

  // Translate a dot-notation key. Fallback chain: active locale -> English
  // value -> last path segment. Never returns the raw dotted key to the UI.
  const t = (key: string, replacements?: Record<string, string | number>): string => {
    const parts = key.split('.');

    let value = lookup(translations[locale], parts);
    if (value === undefined && locale !== 'en') {
      value = lookup(translations.en, parts);
    }

    let text = value ?? parts[parts.length - 1];
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
