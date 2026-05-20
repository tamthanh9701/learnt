/**
 * AI Config Service — CRUD for AI configuration.
 * Stores on Supabase when connected, falls back to localStorage in mock mode.
 */

import { supabase } from './supabase';
import type { AIConfig, AIProvider } from './aiClient';

const LOCAL_STORAGE_KEY = 'learnt_ai_config';

export interface AIConfigRow {
  id?: string;
  user_id: string;
  provider: AIProvider;
  api_key: string;
  model: string;
  ollama_base_url: string | null;
  created_at?: string;
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// localStorage helpers (mock mode)
// ---------------------------------------------------------------------------

function getLocalConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { provider: 'none', apiKey: '', model: '' };
}

function setLocalConfig(config: AIConfig): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function rowToConfig(row: AIConfigRow): AIConfig {
  return {
    provider: row.provider,
    apiKey: row.api_key,
    model: row.model,
    ollamaBaseUrl: row.ollama_base_url || undefined,
  };
}

function configToRow(userId: string, config: AIConfig): Omit<AIConfigRow, 'id' | 'created_at' | 'updated_at'> {
  return {
    user_id: userId,
    provider: config.provider,
    api_key: config.apiKey,
    model: config.model,
    ollama_base_url: config.ollamaBaseUrl || null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load AI config for the given user.
 */
export async function loadAIConfig(userId: string, isMock: boolean): Promise<AIConfig> {
  if (isMock) {
    return getLocalConfig();
  }

  try {
    const { data, error } = await supabase
      .from('ai_configs')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      // No row yet — return default
      if (error.code === 'PGRST116') {
        return { provider: 'none', apiKey: '', model: '' };
      }
      console.warn('Error loading AI config from Supabase:', error);
      return getLocalConfig(); // fallback
    }

    return rowToConfig(data as AIConfigRow);
  } catch (err) {
    console.warn('Failed to load AI config from Supabase, using local fallback:', err);
    return getLocalConfig();
  }
}

/**
 * Save AI config for the given user.
 */
export async function saveAIConfig(userId: string, config: AIConfig, isMock: boolean): Promise<void> {
  // Always save locally as a cache
  setLocalConfig(config);

  if (isMock) return;

  try {
    const row = configToRow(userId, config);

    // Upsert: try update first, then insert
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      await supabase
        .from('ai_configs')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    } else {
      await supabase
        .from('ai_configs')
        .insert(row);
    }
  } catch (err) {
    console.warn('Failed to save AI config to Supabase:', err);
  }
}
