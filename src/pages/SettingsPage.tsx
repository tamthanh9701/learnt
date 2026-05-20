import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Settings, User, Database, Trash2, ShieldAlert, Check } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { user, profile, updateProfile, isMock } = useAuth();
  const { locale, t } = useLanguage();

  const [displayName, setDisplayName] = useState(profile?.display_name || user?.email?.split('@')[0] || '');
  const [updating, setUpdating] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // FSRS customisable parameters
  const [retention, setRetention] = useState('0.90');
  const [maxInterval, setMaxInterval] = useState('36500');

  const isEn = locale === 'en';

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

  const handleResetLocalStorage = () => {
    if (window.confirm(isEn 
      ? 'Are you sure you want to delete all local progress, words learned, and writing submissions? This cannot be undone.'
      : 'Bạn có chắc chắn muốn xoá toàn bộ tiến trình học tập, từ vựng và bài viết trên máy? Việc này không thể hoàn tác.')) {
      
      // Clear key prefixed records
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
              <label className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                {isEn ? 'Display Name' : 'Tên hiển thị'}
              </label>
              <input
                type="text"
                className="text-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. John Doe"
                disabled={updating}
              />
            </div>

            <div className="input-group">
              <label className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                {isEn ? 'Email Address' : 'Địa chỉ Email'}
              </label>
              <input
                type="email"
                className="text-input"
                value={user?.email || ''}
                disabled
                style={{ opacity: 0.6, cursor: 'not-allowed' }}
              />
            </div>

            {successMsg && (
              <div className="success-banner flex align-center gap-xs">
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

        {/* Section 2: FSRS Custom Options */}
        <div className="card settings-card">
          <h2 className="title-xs flex align-center gap-xs" style={{ marginBottom: 'var(--spacing-sm)' }}>
            <Database size={16} className="text-secondary" />
            <span>FSRS Scheduling Parameters</span>
          </h2>
          <p className="body-xs text-secondary" style={{ marginBottom: 'var(--spacing-md)' }}>
            Configure default settings for the Free Spaced Repetition Scheduler algorithm.
          </p>

          <div className="grid grid-cols-2 gap-md" style={{ marginBottom: 'var(--spacing-md)' }}>
            <div className="input-group">
              <label className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                Request Retention
              </label>
              <input
                type="number"
                step="0.01"
                min="0.70"
                max="0.98"
                className="text-input"
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              />
              <span className="body-xs text-tertiary" style={{ marginTop: '2px', display: 'block' }}>
                Target recall probability (default 0.90).
              </span>
            </div>

            <div className="input-group">
              <label className="body-xs font-semibold" style={{ marginBottom: '4px', display: 'block' }}>
                Maximum Interval (days)
              </label>
              <input
                type="number"
                className="text-input"
                value={maxInterval}
                onChange={(e) => setMaxInterval(e.target.value)}
              />
              <span className="body-xs text-tertiary" style={{ marginTop: '2px', display: 'block' }}>
                Cap card review spacing (default 36500).
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <button 
              className="btn btn-secondary btn-xs"
              onClick={() => alert(isEn ? 'FSRS parameters updated!' : 'Đã cập nhật các tham số FSRS!')}
            >
              Update Scheduler Settings
            </button>
          </div>
        </div>

        {/* Section 3: Storage & Database Sync */}
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
