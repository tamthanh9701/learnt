-- AI Configuration table
-- Stores per-user AI provider settings (provider, api_key, model, etc.)

CREATE TABLE IF NOT EXISTS ai_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'none' CHECK (provider IN ('none', 'gemini', 'openai', 'anthropic', 'ollama')),
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  ollama_base_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS policies
ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ai_configs"
  ON ai_configs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ai_configs"
  ON ai_configs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ai_configs"
  ON ai_configs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own ai_configs"
  ON ai_configs FOR DELETE
  USING (auth.uid() = user_id);
