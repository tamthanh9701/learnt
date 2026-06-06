import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAI } from '../contexts/AIContext';
import { PROVIDER_MODELS, PROVIDER_LABELS, testAIConnection } from '../lib/aiClient';
import type { AIProvider as AIProviderType, AIConfig } from '../lib/aiClient';
import { Settings, User, Trash2, ShieldAlert, Check, Bot, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Wifi, Eraser } from 'lucide-react';
import { withTimeout, TimeoutError } from '../lib/timeout';

const AI_PROVIDERS: { value: AIProviderType; label: string }[] = [
  { value: 'none', label: PROVIDER_LABELS.none },
  { value: 'gemini', label: PROVIDER_LABELS.gemini },
  { value: 'openai', label: PROVIDER_LABELS.openai },
  { value: 'anthropic', label: PROVIDER_LABELS.anthropic },
  { value: 'ollama', label: PROVIDER_LABELS.ollama },
];

export const SettingsPage: React.FC = () => {
  const { user, profile, updateProfile, isMock } = useAuth();
  const { locale, t } = useLanguage();
  const { config: savedConfig, updateConfig, isConfigured } = useAI();

  const [displayName, setDisplayName] = useState(profile?.display_name || user?.email?.split('@')[0] || '');
  const [updating, setUpdating] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // AI Config local state
  const [aiProvider, setAiProvider] = useState<AIProviderType>(savedConfig.provider);
  const [aiApiKey, setAiApiKey] = useState(savedConfig.apiKey);
  const [aiModel, setAiModel] = useState(savedConfig.model);
  const [aiOllamaUrl, setAiOllamaUrl] = useState(savedConfig.ollamaBaseUrl || 'http://localhost:11434');
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  // CH1-fix (2026-06-07): busy state for the Clear button. The pre-fix
  // code awaited updateConfig with no timeout, so a slow / hung
  // ai_configs Supabase request could leave the Clear button
  // "stuck" for 30+ seconds with no feedback to the Learner.
  const [aiClearing, setAiClearing] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const isEn = locale === 'en';

  // Sync local state when savedConfig changes (e.g. on initial load)
  useEffect(() => {
    setAiProvider(savedConfig.provider);
    setAiApiKey(savedConfig.apiKey);
    setAiModel(savedConfig.model);
    setAiOllamaUrl(savedConfig.ollamaBaseUrl || 'http://localhost:11434');
  }, [savedConfig]);

  // Auto-select first model when provider changes
  useEffect(() => {
    const models = PROVIDER_MODELS[aiProvider];
    if (models.length > 0 && !models.some(m => m.value === aiModel)) {
      setAiModel(models[0].value);
    }
    if (aiProvider === 'none') {
      setAiModel('');
      setAiApiKey('');
    }
  }, [aiProvider]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || updating) return;

    try {
      setUpdating(true);
      setSuccessMsg(null);
      await updateProfile({ display_name: displayName });
      setSuccessMsg(isEn ? 'Profile updated successfully!' : 'Đã cập nhật hồ sơ thành công!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveAIConfig = async () => {
    setAiSaving(true);
    setAiSaved(false);
    setAiTestResult(null);
    
    // Add a timeout to prevent infinite loading state
    const timeoutId = setTimeout(() => {
      setAiSaving(false);
      setAiTestResult({
        success: false,
        message: isEn
          ? 'Save operation timed out. Your settings may not have been saved.'
          : 'Thao tác lưu đã hết thời gian. Cài đặt của bạn có thể chưa được lưu.',
      });
    }, 10000); // 10 second timeout (5s Supabase + buffer)
    
    try {
      const newConfig: AIConfig = {
        provider: aiProvider,
        apiKey: aiApiKey,
        model: aiModel,
        ollamaBaseUrl: aiProvider === 'ollama' ? aiOllamaUrl : undefined,
      };
      const result = await updateConfig(newConfig);
      clearTimeout(timeoutId);
      
      if (result && !result.cloudOk) {
        // Cloud sync failed (timeout, missing table, RLS, etc.) — local
        // cache is still updated, but warn the user.
        setAiTestResult({
          success: false,
          message: isEn
            ? `Saved locally, but cloud sync failed: ${result.reason || 'unknown error'}`
            : `Đã lưu cục bộ, nhưng đồng bộ đám mây thất bại: ${result.reason || 'lỗi không xác định'}`,
        });
      } else {
        setAiSaved(true);
        setTimeout(() => setAiSaved(false), 3000);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(err);
      setAiTestResult({
        success: false,
        message: isEn
          ? `Error: ${err instanceof Error ? err.message : 'Unknown error'}`
          : `Lỗi: ${err instanceof Error ? err.message : 'Lỗi không xác định'}`,
      });
    } finally {
      setAiSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setAiTesting(true);
    setAiTestResult(null);
    
    // Add a timeout to prevent infinite loading state (test + save should complete within 50s)
    const timeoutId = setTimeout(() => {
      setAiTesting(false);
      setAiTestResult({
        success: false,
        message: isEn
          ? 'Connection test timed out. Please check your API key and network connection.'
          : 'Kiểm tra kết nối đã hết thời gian. Vui lòng kiểm tra khóa API và kết nối mạng của bạn.',
      });
    }, 50000); // 50 second timeout (5s save + 30s API test + 15s buffer)
    
    try {
      // Save first so the context uses the latest config
      const newConfig: AIConfig = {
        provider: aiProvider,
        apiKey: aiApiKey,
        model: aiModel,
        ollamaBaseUrl: aiProvider === 'ollama' ? aiOllamaUrl : undefined,
      };
      const result = await updateConfig(newConfig);
      if (result && !result.cloudOk) {
        // Don't block the network test on a cloud-sync failure — the local
        // config is valid and that's what the test call uses.
        console.warn('Cloud sync warning during test:', result.reason);
      }

      // Test directly against the local newConfig — no need to wait for
      // the context to re-render. AbortController inside aiClient caps
      // the wait at 60 s, so aiTesting can never get stuck.
      const reply = await testAIConnection(newConfig);
      clearTimeout(timeoutId);
      setAiTestResult({ success: true, message: reply.slice(0, 200) });
    } catch (err: any) {
      clearTimeout(timeoutId);
      setAiTestResult({ 
        success: false, 
        message: err.message || isEn ? 'Connection failed' : 'Kết nối thất bại' 
      });
    } finally {
      setAiTesting(false);
    }
  };

  // CH1 (diagnosis 2026-06-06, fix-1): the API key cannot be FULLY
  // hidden once it lives in the browser (localStorage + React state
  // are readable via DevTools). The Tier C server-side fix (proxy
  // via Edge Function with server-side GEMINI_API_KEY) is the only
  // way to eliminate the exposure. For Tier A/D we ship 3
  // mitigations:
  //
  //   1. "Clear API key" button: wipes the key from local state +
  //      savedConfig (which clears the localStorage cache +
  //      ai_configs cloud row). One-tap revoke for shoulder-surfing
  //      or shared-device scenarios.
  //   2. Auto-hide timer: if the user reveals the key with the
  //      show/hide toggle, the field re-masks after 30 s. Shortens
  //      the window where the value is visible on screen.
  //   3. Prominent warning: the SECURITY NOTE text below the field
  //      is colored with --warning (was text-secondary gray) so the
  //      "not encrypted" caveat is impossible to miss.
  const handleClearApiKey = useCallback(async () => {
    if (!window.confirm(isEn
      ? 'Clear the saved API key? You will need to re-enter it to use AI features.'
      : 'Xoá khóa API đã lưu? Bạn sẽ cần nhập lại để dùng các tính năng AI.')) {
      return;
    }
    setAiApiKey('');
    setShowApiKey(false);
    setAiSaved(false);
    setAiTestResult(null);
    // CH1-fix (2026-06-07): wrap updateConfig in withTimeout so a
    // slow / hung Supabase ai_configs request cannot leave the
    // Clear button in a stuck state. The localStorage cache is
    // already wiped by the local setAiApiKey('') above, so a
    // timeout here only means the cloud ai_configs row will be
    // cleaned up on the next save (acceptable degradation).
    setAiClearing(true);
    try {
      await withTimeout(
        async () => {
          await updateConfig({
            provider: aiProvider,
            apiKey: '',
            model: aiModel,
            ollamaBaseUrl: aiProvider === 'ollama' ? aiOllamaUrl : undefined,
          });
        },
        8_000,
        'SettingsPage: clearApiKey',
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        console.warn('Clear API key timed out (cloud sync skipped):', err.message);
      } else {
        // Even if cloud sync fails, the local state is already cleared.
        console.warn('Failed to clear API key from cloud:', err);
      }
    } finally {
      setAiClearing(false);
    }
  }, [aiProvider, aiModel, aiOllamaUrl, isEn, updateConfig]);

  // Auto-hide the API key 30 s after the user reveals it. The
  // timer is cleared on unmount or when the user hides it manually.
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!showApiKey) {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
      return;
    }
    autoHideTimerRef.current = setTimeout(() => {
      setShowApiKey(false);
      autoHideTimerRef.current = null;
    }, 30_000);
    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
    };
  }, [showApiKey]);

  const handleResetLocalStorage = () => {
    if (window.confirm(isEn 
      ? 'Are you sure you want to delete all local progress, words learned, and writing submissions? This cannot be undone.'
      : 'Bạn có chắc chắn muốn xoá toàn bộ tiến trình học tập, từ vựng và bài viết trên máy? Việc này không thể hoàn tác.')) {
      
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('learnt_') || 
          key.startsWith('sb-')
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      alert(isEn ? 'Local database reset complete. Reloading page...' : 'Đã xoá bộ nhớ cục bộ. Đang tải lại trang...');
      window.location.reload();
    }
  };

  const availableModels = PROVIDER_MODELS[aiProvider] || [];
  const needsApiKey = aiProvider !== 'none' && aiProvider !== 'ollama';
  const needsOllamaUrl = aiProvider === 'ollama';

  return (
    <div className="settings-container animate-fade-in" style={{ maxWidth: '680px', margin: '0 auto' }}>
      <div className="settings-header flex align-center gap-sm" style={{ marginBottom: 'var(--spacing-lg)' }}>
        <Settings size={28} className="text-primary" />
        <h1 className="title-lg">{t('nav.settings')}</h1>
      </div>

      <div className="flex flex-col gap-lg">
        {/* Section 1: User Profile */}
        <div className="card settings-card">
          <h2 className="title-xs flex align-center gap-xs" style={{ marginBottom: 'var(--spacing-md)' }}>
            <User size={16} className="text-secondary" />
            <span>{isEn ? 'Profile Details' : 'Thông tin cá nhân'}</span>
          </h2>

          <form onSubmit={handleUpdateProfile} className="flex flex-col gap-md">
            <div className="input-group">
              <label htmlFor="settings-display-name" className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                {isEn ? 'Display Name' : 'Tên hiển thị'}
              </label>
              <input
                id="settings-display-name"
                type="text"
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. John Doe"
                disabled={updating}
              />
            </div>

            <div className="input-group">
              <label htmlFor="settings-email" className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                {isEn ? 'Email Address' : 'Địa chỉ Email'}
              </label>
              <input
                id="settings-email"
                type="email"
                className="input"
                value={user?.email || ''}
                disabled
                style={{ opacity: 0.6, cursor: 'not-allowed' }}
              />
            </div>

            {successMsg && (
              <div className="success-banner flex align-center gap-xs" role="status">
                <Check size={16} />
                <span className="body-xs font-medium">{successMsg}</span>
              </div>
            )}

            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary btn-xs" disabled={updating || !displayName.trim()}>
                {updating ? (isEn ? 'Saving...' : 'Đang lưu...') : (isEn ? 'Save Changes' : 'Lưu thay đổi')}
              </button>
            </div>
          </form>
        </div>

        {/* Section 2: AI Configuration */}
        <div className="card settings-card">
          <h2 className="title-xs flex align-center gap-xs" style={{ marginBottom: 'var(--spacing-sm)' }}>
            <Bot size={16} className="text-primary" />
            <span>{isEn ? 'AI Configuration' : 'Cấu hình AI'}</span>
            {isConfigured && (
              <span 
                className="body-xs font-semibold"
                style={{ 
                  marginLeft: 'auto',
                  background: 'var(--primary)', 
                  color: 'var(--accent-text)', 
                  padding: '2px 8px', 
                  borderRadius: 'var(--radius-full)',
                  fontSize: '10px',
                }}
              >
                {PROVIDER_LABELS[savedConfig.provider]} • {savedConfig.model}
              </span>
            )}
          </h2>
          <p className="body-xs text-secondary" style={{ marginBottom: 'var(--spacing-md)' }}>
            {isEn 
              ? 'Configure an AI provider to enable real-time AI features (conversation, writing feedback, exercise generation). Without AI, the app uses local mock data.'
              : 'Cấu hình nhà cung cấp AI để bật các tính năng AI thời gian thực (hội thoại, chấm bài, sinh bài tập). Nếu không có AI, ứng dụng dùng dữ liệu giả lập.'}
          </p>

          <div className="flex flex-col gap-md">
            {/* Provider Selector */}
            <div className="input-group">
              <label htmlFor="settings-ai-provider" className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                {isEn ? 'AI Provider' : 'Nhà cung cấp AI'}
              </label>
              <select
                id="settings-ai-provider"
                className="input"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as AIProviderType)}
              >
                {AI_PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* API Key */}
            {needsApiKey && (
              <div className="input-group">
                <label htmlFor="settings-api-key" className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                  API Key
                </label>
                <div className="flex gap-xs" style={{ position: 'relative' }}>
                  <input
                    id="settings-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    className="input flex-1"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder={`${isEn ? 'Enter your' : 'Nhập'} ${PROVIDER_LABELS[aiProvider]} API key`}
                    style={{ paddingRight: '76px' }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="btn btn-outline btn-xs flex align-center justify-center"
                    onClick={() => setShowApiKey(!showApiKey)}
                    style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', padding: '6px' }}
                    title={showApiKey ? 'Hide' : 'Show'}
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  {aiApiKey && (
                    <button
                      type="button"
                      className="btn btn-outline btn-xs flex align-center justify-center"
                      onClick={() => void handleClearApiKey()}
                      disabled={aiClearing}
                      style={{ position: 'absolute', right: '36px', top: '50%', transform: 'translateY(-50%)', padding: '6px' }}
                      title={isEn ? 'Clear API key' : 'Xoá khóa API'}
                      aria-label={isEn ? 'Clear API key' : 'Xoá khóa API'}
                    >
                      {aiClearing ? <Loader2 size={14} className="spin" /> : <Eraser size={14} />}
                    </button>
                  )}
                </div>
                {/* CH1 (fix-1): SECURITY NOTE styled as a warning (was
                    text-secondary gray, easy to miss). Reminds the user
                    that the key is in browser localStorage and is
                    visible to anyone with DevTools. Full remediation
                    requires the Tier C server-side proxy (see comment
                    in the .ts file). */}
                <div
                  className="flex align-start gap-xs body-xs"
                  style={{
                    marginTop: '6px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--warning)',
                    background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
                    color: 'var(--warning)',
                    display: 'flex',
                  }}
                  role="note"
                  aria-live="polite"
                >
                  <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                  <span style={{ color: 'var(--warning)' }}>
                    {/* SECURITY NOTE (Tier C, DEFERRED): API keys are stored unencrypted -
                        browser localStorage and, in cloud mode, the Supabase ai_config row -
                        and travel directly from the browser to the provider. Full remediation
                        (server-side proxy + encryption at rest) is out of scope for Tier A;
                        tracked for Tier C. See non-scope.md. Compliance sign-off: BA + DevOps. */}
                    {isEn
                      ? 'Your API key is stored in this browser\u2019s local storage and is sent directly from your browser to the AI provider with each request. It is NOT encrypted \u2014 anyone with DevTools access on this device can read it. Avoid shared/public devices. Use the "Clear" button when you finish a session.'
                      : 'Khóa API được lưu trong bộ nhớ cục bộ của trình duyệt này và được gửi trực tiếp từ trình duyệt đến nhà cung cấp AI mỗi lần gọi. Khóa KHÔNG được mã hoá \u2014 bất kỳ ai có DevTools trên thiết bị này đều đọc được. Tránh dùng trên thiết bị chung/công cộng. Bấm "Xoá" khi kết thúc phiên.'}
                  </span>
                </div>
              </div>
            )}

            {/* Ollama Base URL */}
            {needsOllamaUrl && (
              <div className="input-group">
                <label htmlFor="settings-ollama-url" className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                  Ollama Base URL
                </label>
                <input
                  id="settings-ollama-url"
                  type="text"
                  className="input"
                  value={aiOllamaUrl}
                  onChange={(e) => setAiOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
                <span className="body-xs text-tertiary" style={{ marginTop: '4px', display: 'block' }}>
                  {isEn 
                    ? 'URL of your Ollama server. Default: http://localhost:11434'
                    : 'URL máy chủ Ollama của bạn. Mặc định: http://localhost:11434'}
                </span>
              </div>
            )}

            {/* Model Selector */}
            {aiProvider !== 'none' && (
              <div className="input-group">
                <label htmlFor="settings-ai-model" className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                  {isEn ? 'Model' : 'Mô hình AI'}
                </label>
                <select
                  id="settings-ai-model"
                  className="input"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                >
                  {availableModels.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Test result banner */}
            {aiTestResult && (
              <div 
                className="flex align-center gap-xs" 
                style={{ 
                  padding: '8px 12px', 
                  borderRadius: 'var(--radius-md)',
                  background: aiTestResult.success ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'color-mix(in srgb, var(--error) 12%, transparent)',
                  border: `1px solid ${aiTestResult.success ? 'var(--success)' : 'var(--error)'}`,
                }}
              >
                {aiTestResult.success 
                  ? <CheckCircle size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                  : <AlertCircle size={14} style={{ color: 'var(--error)', flexShrink: 0 }} />
                }
                <span className="body-xs" style={{ color: aiTestResult.success ? 'var(--success)' : 'var(--error)', wordBreak: 'break-word' }}>
                  {aiTestResult.message}
                </span>
              </div>
            )}

            {/* Action buttons */}
            {aiProvider !== 'none' && (
              <div className="flex gap-sm justify-end flex-wrap">
                <button
                  className="btn btn-outline btn-xs flex align-center gap-xs"
                  onClick={handleTestConnection}
                  disabled={aiTesting || (!aiApiKey && needsApiKey) || !aiModel}
                >
                  {aiTesting 
                    ? <><Loader2 size={14} className="spin" /> <span>{isEn ? 'Testing...' : 'Đang kiểm tra...'}</span></>
                    : <><Wifi size={14} /> <span>{isEn ? 'Test Connection' : 'Kiểm tra kết nối'}</span></>
                  }
                </button>

                <button 
                  className="btn btn-primary btn-xs flex align-center gap-xs" 
                  onClick={handleSaveAIConfig}
                  disabled={aiSaving || (!aiApiKey && needsApiKey) || !aiModel}
                >
                  {aiSaving 
                    ? <><Loader2 size={14} className="spin" /> <span>{isEn ? 'Saving...' : 'Đang lưu...'}</span></>
                    : aiSaved
                      ? <><Check size={14} /> <span>{isEn ? 'Saved!' : 'Đã lưu!'}</span></>
                      : <span>{isEn ? 'Save AI Config' : 'Lưu cấu hình AI'}</span>
                  }
                </button>
              </div>
            )}

            {/* Save for none mode (reset) */}
            {aiProvider === 'none' && isConfigured && (
              <div className="flex justify-end">
                <button 
                  className="btn btn-outline btn-xs" 
                  onClick={handleSaveAIConfig}
                  disabled={aiSaving}
                >
                  {isEn ? 'Switch to Mock Mode' : 'Chuyển sang chế độ giả lập'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Section 4: Storage & Database Sync */}
        <div className="card settings-card">
          <h2 className="title-xs flex align-center gap-xs" style={{ marginBottom: 'var(--spacing-md)' }}>
            <ShieldAlert size={16} className="text-error" />
            <span style={{ color: 'var(--error)' }}>{isEn ? 'System Actions' : 'Hệ thống'}</span>
          </h2>

          <div className="flex flex-col gap-md">
            <div className="flex justify-between align-center flex-wrap gap-sm" style={{ paddingBottom: 'var(--spacing-md)', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <span className="body-sm font-semibold block" style={{ color: 'var(--text-primary)' }}>
                  {isEn ? 'Database sync Mode' : 'Chế độ lưu trữ dữ liệu'}
                </span>
                <span className="body-xs text-secondary">
                  {isMock 
                    ? (isEn ? 'Running Local-Offline Mode (Saving locally).' : 'Đang chạy ngoại tuyến (Lưu trên máy).')
                    : (isEn ? 'Connected to cloud Supabase services.' : 'Đã kết nối với máy chủ Supabase đám mây.')}
                </span>
              </div>
              <span className={`topic-badge ${isMock ? '' : 'bg-primary-subtle text-primary'}`}>
                {isMock ? 'Local Demo' : 'Supabase Sync'}
              </span>
            </div>

            <div className="flex justify-between align-center flex-wrap gap-sm">
              <div>
                <span className="body-sm font-semibold block" style={{ color: 'var(--error)' }}>
                  {isEn ? 'Clear Local Progress' : 'Xoá tiến trình cục bộ'}
                </span>
                <span className="body-xs text-secondary">
                  {isEn 
                    ? 'Deletes all localStorage data, streaks, vocabulary intervals, and essays.'
                    : 'Xoá bỏ toàn bộ dữ liệu lưu trữ, chuỗi ngày học, thẻ từ vựng và bài luận trên trình duyệt.'}
                </span>
              </div>
              <button className="btn btn-outline btn-xs flex align-center gap-xs text-error" onClick={handleResetLocalStorage} style={{ borderColor: 'var(--error)' }}>
                <Trash2 size={14} />
                <span>{isEn ? 'Reset Progress' : 'Đặt lại dữ liệu'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
