/**
 * AI Config Service — CRUD for AI configuration.
 * Stores on Supabase when connected, falls back to localStorage in mock mode.
 *
 * Every Supabase call is wrapped with an AbortController + 5 s timeout so a
 * slow / hung backend or a missing table cannot leave the UI in an infinite
 * loading state. Cloud-sync failures are non-fatal: the local cache is
 * always written first and we return a structured result so callers can
 * surface cloud-sync errors to the user without breaking the save flow.
 */

import { supabase } from './supabase';
import { withTimeout, TimeoutError } from './timeout';
import type { AIConfig, AIProvider } from './aiClient';

const LOCAL_STORAGE_KEY = 'learnt_ai_config';
const SUPABASE_TIMEOUT_MS = 5_000;

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

/** Result of a save/load call. `cloudOk=false` means the cloud sync failed
 *  but the local cache is still valid. Callers should warn the user. */
export interface CloudResult<T = void> {
  cloudOk: boolean;
  reason?: string;
  data?: T;
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
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
  } catch { /* quota or private mode — non-fatal */ }
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
 * Cloud is preferred; falls back to local cache if the table is missing,
 * the row is absent, the call times out, or any other cloud error occurs.
 */
export async function loadAIConfig(userId: string, isMock: boolean): Promise<AIConfig> {
  if (isMock) {
    return getLocalConfig();
  }

  try {
    const data = await withTimeout(
      async (signal) => {
        const res = await supabase
          .from('ai_configs')
          .select('*')
          .eq('user_id', userId)
          .abortSignal(signal)
          .maybeSingle();
        if (res.error) throw res.error;
        return res.data as AIConfigRow | null;
      },
      SUPABASE_TIMEOUT_MS,
      'loadAIConfig',
    );

    if (!data) {
      return getLocalConfig();
    }
    return rowToConfig(data);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'PGRST116') {
      return getLocalConfig();
    }
    console.warn('Failed to load AI config from Supabase, using local fallback:', err);
    return getLocalConfig();
  }
}

/**
 * Save AI config for the given user. Always writes the local cache first.
 * Returns a CloudResult so the UI can show a warning if cloud sync failed.
 */
export async function saveAIConfig(
  userId: string,
  config: AIConfig,
  isMock: boolean,
): Promise<CloudResult> {
  setLocalConfig(config);

  if (isMock) {
    return { cloudOk: true };
  }

  try {
    await withTimeout(
      async (signal) => {
        const row = configToRow(userId, config);

        const existing = await supabase
          .from('ai_configs')
          .select('id')
          .eq('user_id', userId)
          .abortSignal(signal)
          .maybeSingle();

        if (existing.error) throw existing.error;

        if (existing.data) {
          const upd = await supabase
            .from('ai_configs')
            .update({ ...row, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .abortSignal(signal);
          if (upd.error) throw upd.error;
        } else {
          const ins = await supabase
            .from('ai_configs')
            .insert(row)
            .abortSignal(signal);
          if (ins.error) throw ins.error;
        }
      },
      SUPABASE_TIMEOUT_MS,
      'saveAIConfig',
    );

    return { cloudOk: true };
  } catch (err: unknown) {
    let message: string;
    if (err instanceof TimeoutError) {
      message = err.message;
    } else if (err instanceof Error) {
      message = err.message;
    } else if (err && typeof err === 'object' && 'message' in err) {
      message = String((err as { message: unknown }).message);
    } else {
      message = String(err);
    }
    console.warn('Failed to save AI config to Supabase:', err);
    return { cloudOk: false, reason: message };
  }
}
