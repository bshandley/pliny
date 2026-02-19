import { useState, useEffect } from 'react';
import { api } from '../api';
import { User } from '../types';
import AppBar from './AppBar';

interface ProfileSettingsProps {
  user: User;
  onBack: () => void;
}

const NOTIFICATION_TOGGLES = [
  { key: 'email_assigned_card', label: 'Assigned to card', desc: 'When someone adds you to a card', defaultOn: true },
  { key: 'email_mention_comment', label: 'Mentioned in comment', desc: 'When someone @mentions you in a comment', defaultOn: true },
  { key: 'email_due_date_reminder', label: 'Due date reminder', desc: '24 hours before a card you\'re on is due', defaultOn: true },
  { key: 'email_card_completed', label: 'Card completed', desc: 'When a card you\'re on is moved to done', defaultOn: false },
  { key: 'email_comment_added', label: 'New comment', desc: 'When someone comments on a card you\'re on', defaultOn: false },
  { key: 'email_checklist_assigned', label: 'Subtask assigned', desc: 'When a checklist item is assigned to you', defaultOn: true },
  { key: 'email_description_changed', label: 'Description updated', desc: 'When a card you\'re on has its description changed', defaultOn: false },
];

export default function ProfileSettings({ user, onBack }: ProfileSettingsProps) {
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // Setup flow
  const [setupMode, setSetupMode] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  // Disable flow
  const [disableMode, setDisableMode] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);

  // Notification preferences
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [prefsLoading, setPrefsLoading] = useState(true);

  useEffect(() => {
    api.getTotpStatus()
      .then(data => setTotpEnabled(data.enabled))
      .catch(() => {})
      .finally(() => setLoading(false));

    // Load SMTP status and notification preferences
    Promise.all([
      api.getSmtpStatus().catch(() => ({ configured: false })),
      api.getNotificationPreferences().catch(() => ({})),
    ]).then(([smtpData, prefs]) => {
      setSmtpConfigured(smtpData.configured);
      setNotifPrefs(prefs);
    }).finally(() => setPrefsLoading(false));
  }, []);

  const handleToggleNotifPref = (key: string) => {
    const currentValue = notifPrefs[key] ?? NOTIFICATION_TOGGLES.find(t => t.key === key)?.defaultOn ?? false;
    const newValue = !currentValue;
    // Optimistic update
    setNotifPrefs(prev => ({ ...prev, [key]: newValue }));
    api.updateNotificationPreferences({ [key]: newValue }).catch(() => {
      // Revert on error
      setNotifPrefs(prev => ({ ...prev, [key]: currentValue }));
    });
  };

  const handleStartSetup = async () => {
    setSetupLoading(true);
    setSetupError('');
    try {
      const data = await api.setupTotp();
      setQrCode(data.qr_code);
      setSecretKey(data.secret);
      setBackupCodes(data.backup_codes);
      setSetupMode(true);
    } catch (err: any) {
      setSetupError(err.message || 'Failed to start setup');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleVerifyAndEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupLoading(true);
    setSetupError('');
    try {
      await api.enableTotp(verifyCode);
      setTotpEnabled(true);
      setShowBackupCodes(true);
    } catch (err: any) {
      setSetupError(err.message || 'Invalid code');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleFinishSetup = () => {
    setSetupMode(false);
    setShowBackupCodes(false);
    setQrCode('');
    setSecretKey('');
    setBackupCodes([]);
    setVerifyCode('');
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableLoading(true);
    setDisableError('');
    try {
      await api.disableTotp(disablePassword);
      setTotpEnabled(false);
      setDisableMode(false);
      setDisablePassword('');
    } catch (err: any) {
      setDisableError(err.message || 'Failed to disable 2FA');
    } finally {
      setDisableLoading(false);
    }
  };

  return (
    <div className="profile-settings">
      <AppBar title="Profile" onBack={onBack} />

      <div className="profile-settings-content">
        <section className="profile-section">
          <h2>Account</h2>
          {user.avatar_url && (
            <div className="profile-avatar">
              <img src={user.avatar_url} alt={user.display_name || user.username} className="profile-avatar-img" />
            </div>
          )}
          {user.display_name && (
            <div className="profile-field">
              <label>Name</label>
              <span>{user.display_name}</span>
            </div>
          )}
          <div className="profile-field">
            <label>Username</label>
            <span>{user.username}</span>
          </div>
          {user.email && (
            <div className="profile-field">
              <label>Email</label>
              <span>{user.email}</span>
            </div>
          )}
          <div className="profile-field">
            <label>Role</label>
            <span className={`role-badge role-${user.role.toLowerCase()}`}>{user.role}</span>
          </div>
          {user.created_at && (
            <div className="profile-field">
              <label>Member since</label>
              <span>{new Date(user.created_at).toLocaleDateString()}</span>
            </div>
          )}
        </section>

        <section className="profile-section">
          <h2>Two-Factor Authentication</h2>

          {loading ? (
            <p className="profile-loading">Loading...</p>
          ) : showBackupCodes ? (
            <div className="totp-backup-codes">
              <p className="totp-success">2FA has been enabled successfully!</p>
              <p className="totp-warning">Save these backup codes in a safe place. Each code can only be used once. You won't be able to see them again.</p>
              <div className="backup-codes-grid">
                {backupCodes.map((code, i) => (
                  <code key={i} className="backup-code">{code}</code>
                ))}
              </div>
              <button onClick={handleFinishSetup} className="btn-primary">
                I've saved my backup codes
              </button>
            </div>
          ) : setupMode ? (
            <div className="totp-setup">
              <p>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
              <div className="totp-qr">
                <img src={qrCode} alt="TOTP QR Code" />
              </div>
              <details className="totp-manual-entry">
                <summary>Can't scan? Enter manually</summary>
                <code className="totp-secret">{secretKey}</code>
              </details>
              <form onSubmit={handleVerifyAndEnable}>
                <div className="form-group">
                  <label htmlFor="verify-code">Enter the 6-digit code from your app to verify</label>
                  <input
                    type="text"
                    id="verify-code"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                {setupError && <div className="error">{setupError}</div>}
                <div className="profile-actions">
                  <button type="submit" disabled={setupLoading || verifyCode.length < 6}>
                    {setupLoading ? 'Verifying...' : 'Enable 2FA'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => { setSetupMode(false); setSetupError(''); }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : totpEnabled ? (
            <div className="totp-enabled">
              <p className="totp-status-badge enabled">2FA is enabled</p>
              {disableMode ? (
                <form onSubmit={handleDisable}>
                  <div className="form-group">
                    <label htmlFor="disable-password">Enter your password to disable 2FA</label>
                    <input
                      type="password"
                      id="disable-password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  {disableError && <div className="error">{disableError}</div>}
                  <div className="profile-actions">
                    <button type="submit" className="btn-danger" disabled={disableLoading}>
                      {disableLoading ? 'Disabling...' : 'Disable 2FA'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => { setDisableMode(false); setDisablePassword(''); setDisableError(''); }}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button onClick={() => setDisableMode(true)} className="btn-secondary">
                  Disable 2FA
                </button>
              )}
            </div>
          ) : (
            <div className="totp-disabled">
              <p>Add an extra layer of security to your account by requiring a verification code when logging in with your password.</p>
              {setupError && <div className="error">{setupError}</div>}
              <button onClick={handleStartSetup} disabled={setupLoading}>
                {setupLoading ? 'Setting up...' : 'Set up 2FA'}
              </button>
            </div>
          )}
        </section>

        <section className="profile-section">
          <h2>Email Notifications</h2>

          {prefsLoading ? (
            <p className="profile-loading">Loading...</p>
          ) : (
            <>
              {!smtpConfigured && (
                <div className="notification-prefs-banner">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Email notifications have not been configured by your administrator.
                </div>
              )}
              <div className={`settings-card${!smtpConfigured ? ' settings-card-disabled' : ''}`}>
                <div className="settings-card-header">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  <h3>Notification Preferences</h3>
                </div>
                {NOTIFICATION_TOGGLES.map((toggle, idx) => {
                  const value = notifPrefs[toggle.key] ?? toggle.defaultOn;
                  return (
                    <div
                      key={toggle.key}
                      className={`setting-row${idx === NOTIFICATION_TOGGLES.length - 1 ? ' setting-row-last' : ''}`}
                    >
                      <div className="setting-info">
                        <div className="setting-label">{toggle.label}</div>
                        <div className="setting-desc">{toggle.desc}</div>
                      </div>
                      <button
                        className={`toggle-switch${value ? ' active' : ''}`}
                        onClick={() => handleToggleNotifPref(toggle.key)}
                        disabled={!smtpConfigured}
                        role="switch"
                        aria-checked={value}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
