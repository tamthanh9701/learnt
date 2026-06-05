import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAI } from '../contexts/AIContext';
import { PROVIDER_MODELS, PROVIDER_LABELS, testAIConnection, probeGeminiModels } from '../lib/aiClient';
import { QuotaExhaustedError, RateLimitError, AuthError } from '../lib/aiClient';
import type { AIProvider as AIProviderType, AIConfig } from '../lib/aiClient';
import { useFormDirtyReact } from '../hooks/useFormDirty';
import { Settings, User, Trash2, ShieldAlert, Check, Bot, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Wifi } from 'lucide-react';

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

  // H5 (diagnosis 2026-06-05): keep refs to every setTimeout the page
  // schedules so a single useEffect cleanup on unmount cancels them all.
  // Without this, navigating away during a 10s/50s wait would let the timer
  // fire on an unmounted component (React 18+ silently ignores setState, but
  // it is still wasted work and can mask real state-update bugs).
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const trackTimer = (id: ReturnType<typeof setTimeout>) => {
    timersRef.current.add(id);
    return id;
  };
  const clearAllTimers = () => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current.clear();
  };
  useEffect(() => () => clearAllTimers(), []);

  // AI Config local state
  const [aiProvider, setAiProvider] = useState<AIProviderType>(savedConfig.provider);
  const [aiApiKey, setAiApiKey] = useState(savedConfig.apiKey);
  const [aiModel, setAiModel] = useState(savedConfig.model);
  const [aiOllamaUrl, setAiOllamaUrl] = useState(savedConfig.ollamaBaseUrl || 'http://localhost:11434');
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const isEn = locale === 'en';

  // F2 (diagnosis 2026-06-04): the dirty-flag ref prevents useEffect on
  // [savedConfig] from clobbering characters the user is still typing. Set
  // to true in onChange handlers of the 4 form fields; reset to false after
  // a successful Save (see handleSaveAIConfig).
  const dirty = useFormDirtyReact();

  // Sync local state when savedConfig changes (e.g. on initial load).
  // Guarded by `dirty.isDirty()` — if the user is mid-edit, the sync is a
  // no-op so the user's typed characters are preserved.
  useEffect(() => {
    if (dirty.isDirty()) return;
    setAiProvider(savedConfig.provider);
    setAiApiKey(savedConfig.apiKey);
    setAiModel(savedConfig.model);
    setAiOllamaUrl(savedConfig.ollamaBaseUrl || 'http://localhost:11434');
  }, [savedConfig, dirty]);

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
  }, [aiProvider, aiModel]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || updating) return;

    try {
      setUpdating(true);
      setSuccessMsg(null);
      await updateProfile({ display_name: displayName });
      setSuccessMsg(isEn ? 'Profile updated successfully!' : 'Đã cập nhật hồ sơ thành công!');
      // H5: register this timer with the cleanup ref so unmount clears it.
      trackTimer(setTimeout(() => setSuccessMsg(null), 3000));
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
    const timeoutId = trackTimer(setTimeout(() => {
      timersRef.current.delete(timeoutId);
      setAiSaving(false);
      setAiTestResult({
        success: false,
        message: isEn
          ? 'Save operation timed out. Your settings may not have been saved.'
          : 'Thao tác lưu đã hết thời gian. Cài đặt của bạn có thể chưa được lưu.',
      });
    }, 10000)); // 10 second timeout (5s Supabase + buffer)

    try {
      const newConfig: AIConfig = {
        provider: aiProvider,
        apiKey: aiApiKey,
        model: aiModel,
        ollamaBaseUrl: aiProvider === 'ollama' ? aiOllamaUrl : undefined,
      };
      const result = await updateConfig(newConfig);
      clearTimeout(timeoutId);
      timersRef.current.delete(timeoutId);

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
        // F2: successful save — reset the dirty flag so future savedConfig
        // changes (e.g. on next mount) sync the form state again.
        dirty.markClean();
        setAiSaved(true);
        const savedFlagTimer = trackTimer(setTimeout(() => setAiSaved(false), 3000));
        // H5: clear from set on next tick to keep the registry accurate
        setTimeout(() => timersRef.current.delete(savedFlagTimer), 3001);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      timersRef.current.delete(timeoutId);
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

    // Add a timeout to prevent infinite loading state (test should complete within 50s)
    const timeoutId = trackTimer(setTimeout(() => {
      timersRef.current.delete(timeoutId);
      setAiTesting(false);
      setAiTestResult({
        success: false,
        message: isEn
          ? 'Connection test timed out. Please check your API key and network connection.'
          : 'Kiểm tra kết nối đã hết thời gian. Vui lòng kiểm tra khóa API và kết nối mạng của bạn.',
      });
    }, 50000)); // 50 second timeout (30s API test + 20s buffer)

    try {
      // F3 (diagnosis 2026-06-04): the Test button should verify the form's
      // current state, not write to the cloud. Previously every Test click
      // triggered a Supabase upsert — 5 clicks = 5 wasted writes. The user
      // wanting to "save" their config should hit Save first; Test is
      // strictly a network round-trip with the form's local state.
      const newConfig: AIConfig = {
        provider: aiProvider,
        apiKey: aiApiKey,
        model: aiModel,
        ollamaBaseUrl: aiProvider === 'ollama' ? aiOllamaUrl : undefined,
      };

      // Test directly against the local newConfig. AbortController inside
      // aiClient caps the wait at 30 s, so aiTesting can never get stuck.
      const reply = await testAIConnection(newConfig);
      clearTimeout(timeoutId);
      timersRef.current.delete(timeoutId);
      setAiTestResult({ success: true, message: reply.slice(0, 200) });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      timersRef.current.delete(timeoutId);
      // F1b (diagnosis 2026-06-04): render actionable UI for typed errors.
      // For QuotaExhaustedError, surface a model-swap hint so users with
      // an exhausted cached model see "try X instead" instead of a wall of
      // JSON. AuthError / RateLimitError get clear single-line messages.
      if (err instanceof QuotaExhaustedError) {
        // H6 (diagnosis 2026-06-05): the previous F1 hint sliced the first 3
        // models in PROVIDER_MODELS.gemini and showed them as suggestions,
        // but it never verified those models actually had remaining quota.
        // With the user's real API key, 2 of the 3 suggested models were
        // ALSO exhausted, so the hint misled the user into trying more
        // broken models ("Vẫn không kết nối được").
        //
        // New flow: probe the other 4 models in parallel via
        // `probeGeminiModels`, then show ONLY the ones that returned 200.
        // If the probe finds nothing working, show a generic fallback
        // message instead of a misleading list.
        //
        // We render an interim "checking…" message so the user knows
        // something is happening (probe takes ~1-3 s on a fast net).
        setAiTestResult({
          success: false,
          message: isEn
            ? `Model "${err.model}" is quota-exhausted. Checking other models…`
            : `Mô hình "${err.model}" đã hết hạn ngạch. Đang kiểm tra các mô hình khác…`,
        });
        // We re-use aiTesting=true to keep the Test button disabled while
        // the probe runs (a second click during the probe would race
        // against the in-flight probe). The outer `finally` resets it.
        setAiTesting(true);
        try {
          const candidates = PROVIDER_MODELS.gemini
            .map(m => m.value)
            .filter(v => v !== err.model);
          const probes = await probeGeminiModels(aiApiKey, candidates);
          const working = probes.filter(p => p.ok).map(p => p.model);
          if (working.length > 0) {
            setAiTestResult({
              success: false,
              message: isEn
                ? `Model "${err.model}" is quota-exhausted. These models are still working: ${working.join(', ')}.`
                : `Mô hình "${err.model}" đã hết hạn ngạch. Các mô hình còn hoạt động: ${working.join(', ')}.`,
            });
          } else {
            // No other model works. Most likely: the API key is
            // exhausted across the board, or the key is bad. Generic
            // message (H6 plan C) so the user doesn't loop trying the
            // (also-exhausted) list. See runbook §8.
            setAiTestResult({
              success: false,
              message: isEn
                ? `Model "${err.model}" is quota-exhausted, and no other Gemini model in the dropdown works with this API key. Wait a few minutes and try again, or create a new API key.`
                : `Mô hình "${err.model}" đã hết hạn ngạch và không có mô hình Gemini nào khác trong danh sách hoạt động với khoá API này. Vui lòng đợi vài phút rồi thử lại, hoặc tạo khoá API mới.`,
            });
          }
        } catch {
          // probeGeminiModels is contractually non-throwing, but defend
          // in depth: if it does throw (e.g. a future refactor regresses),
          // show a generic message rather than letting the original
          // QuotaExhaustedError message overwrite the interim state.
          setAiTestResult({
            success: false,
            message: isEn
              ? `Model "${err.model}" is quota-exhausted. Try another model in the dropdown (we couldn't auto-check the others).`
              : `Mô hình "${err.model}" đã hết hạn ngạch. Hãy thử mô hình khác trong danh sách (không thể tự động kiểm tra).`,
          });
        }
      } else if (err instanceof RateLimitError) {
        setAiTestResult({
          success: false,
          message: isEn
            ? `Rate-limited by "${err.model}". Wait ${err.retryAfter}s and try again.`
            : `Bị giới hạn tốc độ bởi "${err.model}". Đợi ${err.retryAfter}s rồi thử lại.`,
        });
      } else if (err instanceof AuthError) {
        setAiTestResult({
          success: false,
          message: isEn
            ? `Authentication failed for "${err.model}". Check your API key.`
            : `Xác thực thất bại với "${err.model}". Vui lòng kiểm tra khóa API.`,
        });
      } else {
        const msg = err instanceof Error ? err.message : (isEn ? 'Connection failed' : 'Kết nối thất bại');
        setAiTestResult({ success: false, message: msg });
      }
    } finally {
      setAiTesting(false);
    }
  };

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
                onChange={(e) => {
                  setAiProvider(e.target.value as AIProviderType);
                  dirty.markDirty();
                }}
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
                    onChange={(e) => {
                      setAiApiKey(e.target.value);
                      dirty.markDirty();
                    }}
                    placeholder={`${isEn ? 'Enter your' : 'Nhập'} ${PROVIDER_LABELS[aiProvider]} API key`}
                    style={{ paddingRight: '40px' }}
                  />
                  <button 
                    type="button"
                    className="btn btn-outline btn-xs flex align-center justify-center"
                    onClick={() => setShowApiKey(!showApiKey)}
                    style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', padding: '6px' }}
                    title={showApiKey ? 'Hide' : 'Show'}
                  >
                    {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <span className="body-xs text-secondary" style={{ marginTop: '4px', display: 'block' }}>
                  {/* SECURITY NOTE (Tier C, DEFERRED): API keys are stored unencrypted -
                      browser localStorage and, in cloud mode, the Supabase ai_config row -
                      and travel directly from the browser to the provider. Full remediation
                      (server-side proxy + encryption at rest) is out of scope for Tier A;
                      tracked for Tier C. See non-scope.md. Compliance sign-off: BA + DevOps. */}
                  {isEn
                    ? "Your API key is stored in this browser's local storage and is sent directly from your browser to the AI provider with each request. It is not encrypted, so avoid using a shared or public device."
                    : 'Khóa API của bạn được lưu trong bộ nhớ cục bộ của trình duyệt này và được gửi trực tiếp từ trình duyệt đến nhà cung cấp AI trong mỗi yêu cầu. Khóa không được mã hóa, vì vậy hãy tránh dùng trên thiết bị chung hoặc công cộng.'}
                </span>
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
                onChange={(e) => {
                  setAiOllamaUrl(e.target.value);
                  dirty.markDirty();
                }}
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
                onChange={(e) => {
                  setAiModel(e.target.value);
                  dirty.markDirty();
                }}
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
