import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { loadAIConfig, saveAIConfig } from '../lib/aiConfigService';
import type { CloudResult } from '../lib/aiConfigService';
import { callAIProvider, testAIConnection } from '../lib/aiClient';
import type { AIConfig, AIProvider as AIProviderType, ChatMessage } from '../lib/aiClient';

interface AIContextType {
  /** Current AI configuration */
  config: AIConfig;
  /** Whether a real AI provider is configured (not 'none') */
  isConfigured: boolean;
  /** Whether config is still loading from storage */
  loading: boolean;
  /** Update and persist the AI configuration. Returns CloudResult
   *  (cloudOk=false means cloud sync failed but local cache is written). */
  updateConfig: (newConfig: AIConfig) => Promise<CloudResult>;
  /** Call the configured AI provider with messages. Returns AI reply text. */
  callAI: (messages: ChatMessage[]) => Promise<string>;
  /** Test the current AI connection. Returns reply or throws. */
  testConnection: () => Promise<string>;
}

const defaultConfig: AIConfig = {
  provider: 'none' as AIProviderType,
  apiKey: '',
  model: '',
};

const AIContext = createContext<AIContextType | undefined>(undefined);

export const AIConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isMock } = useAuth();
  const [config, setConfig] = useState<AIConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  // Load config when user changes
  useEffect(() => {
    const load = async () => {
      if (!user) {
        setConfig(defaultConfig);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const loaded = await loadAIConfig(user.id, isMock);
        setConfig(loaded);
      } catch (err) {
        console.error('Error loading AI config:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, isMock]);

  const isConfigured = config.provider !== 'none' && !!config.apiKey && !!config.model;

  const updateConfig = useCallback(async (newConfig: AIConfig): Promise<CloudResult> => {
    setConfig(newConfig);
    if (user) {
      return saveAIConfig(user.id, newConfig, isMock);
    }
    return { cloudOk: true };
  }, [user, isMock]);

  const callAI = useCallback(async (messages: ChatMessage[]): Promise<string> => {
    if (!isConfigured) {
      throw new Error('AI not configured');
    }
    return callAIProvider(config, messages);
  }, [config, isConfigured]);

  const testConnection = useCallback(async (): Promise<string> => {
    return testAIConnection(config);
  }, [config]);

  return (
    <AIContext.Provider value={{
      config,
      isConfigured,
      loading,
      updateConfig,
      callAI,
      testConnection,
    }}>
      {children}
    </AIContext.Provider>
  );
};

export const useAI = () => {
  const context = useContext(AIContext);
  if (!context) {
    throw new Error('useAI must be used within an AIProvider');
  }
  return context;
};
