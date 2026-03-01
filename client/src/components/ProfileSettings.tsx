import { useState, useEffect } from 'react';
import { api } from '../api';
import { User, ApiToken } from '../types';
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

  // Profile editing state
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [email, setEmail] = useState(user.email || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

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
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [disableError, setDisableError] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);

  // Notification preferences
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [prefsLoading, setPrefsLoading] = useState(true);

  // API Tokens
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenExpiry, setNewTokenExpiry] = useState<string>('never');
  const [creatingToken, setCreatingToken] = useState(false);
  const [showNewToken, setShowNewToken] = useState<ApiToken | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

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

    // Load API tokens
    api.getApiTokens()
      .then(setTokens)
      .catch(() => {})
      .finally(() => setTokensLoading(false));
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileError('');
    setProfileSuccess('');

    try {
      await api.updateProfile({
        display_name: displayName || undefined,
        email: email || undefined,
      });
      setProfileSuccess('Profile updated successfully');
      setTimeout(() => setProfileSuccess(''), 3000);
    } catch (err: any) {
      setProfileError(err.message || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }

    setPasswordSaving(true);

    try {
      await api.updateProfile({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setTimeout(() => setPasswordSuccess(''), 3000);
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password');
    } finally {
      setPasswordSaving(false);
    }
  };

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

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim()) return;
    setCreatingToken(true);
    try {
      const expiresInDays = newTokenExpiry === 'never' ? undefined :
        newTokenExpiry === '30' ? 30 :
        newTokenExpiry === '60' ? 60 :
        newTokenExpiry === '90' ? 90 : undefined;
      const token = await api.createApiToken(newTokenName.trim(), expiresInDays);
      setTokens(prev => [{ ...token, token: undefined }, ...prev]);
      setShowNewToken(token);
      setNewTokenName('');
      setNewTokenExpiry('never');
      setShowCreateForm(false);
    } catch (err: any) {
      alert(err.message || 'Failed to create token');
    } finally {
      setCreatingToken(false);
    }
  };

  const handleRevokeToken = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this token? Any applications using it will stop working.')) return;
    try {
      await api.revokeApiToken(id);
      setTokens(prev => prev.filter(t => t.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to revoke token');
    }
  };

  const handleRevokeAllTokens = async () => {
    if (!confirm('Are you sure you want to revoke ALL your tokens? All applications using them will stop working.')) return;
    try {
      await api.revokeAllApiTokens();
      setTokens([]);
    } catch (err: any) {
      alert(err.message || 'Failed to revoke tokens');
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = token;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    }
  };

  const formatTokenDate = (date: string | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString();
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
          <div className="profile-avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.display_name || user.username} className="profile-avatar-img" />
            ) : (
              <div className="profile-avatar-initials" aria-hidden="true">
                {(user.display_name || user.username || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>
            )}
          </div>
          <div className="profile-field">
            <label>Username</label>
            <span>{user.username}</span>
          </div>
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

        <section className="profile-section profile-edit-section">
          <h2>Profile</h2>
          <form onSubmit={handleSaveProfile}>
            <div className="form-group">
              <label htmlFor="display-name">Display name</label>
              <input
                type="text"
                id="display-name"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setProfileError(''); }}
                placeholder={user.username}
                maxLength={100}
              />
              <span className="form-hint">This is how your name appears to others</span>
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setProfileError(''); }}
                placeholder="you@example.com"
              />
              <span className="form-hint">Used for password reset and notifications</span>
            </div>
            {profileError && <div className="error" id="profile-error" role="alert">{profileError}</div>}
            {profileSuccess && (
              <div className="success" role="status">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                {profileSuccess}
              </div>
            )}
            <div className="profile-actions">
              <button type="submit" disabled={profileSaving} aria-describedby={profileError ? 'profile-error' : undefined}>
                {profileSaving ? (
                  <span className="btn-spinner"><span className="spinner-sm" />Saving…</span>
                ) : 'Save profile'}
              </button>
            </div>
          </form>
        </section>

        <section className="profile-section password-section">
          <h2>Change Password</h2>
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label htmlFor="current-password">Current password</label>
              <div className="password-input-wrapper">
                <input
                  type={showPasswords ? 'text' : 'password'}
                  id="current-password"
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(''); }}
                  autoComplete="current-password"
                  aria-describedby={passwordError ? 'password-error' : undefined}
                />
                <button type="button" className="password-toggle" onClick={() => setShowPasswords(v => !v)} tabIndex={-1} aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}>
                  {showPasswords ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="new-password">New password</label>
              <input
                type={showPasswords ? 'text' : 'password'}
                id="new-password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-new-password">Confirm new password</label>
              <input
                type={showPasswords ? 'text' : 'password'}
                id="confirm-new-password"
                value={confirmNewPassword}
                onChange={(e) => { setConfirmNewPassword(e.target.value); setPasswordError(''); }}
                autoComplete="new-password"
              />
            </div>
            {passwordError && <div className="error" id="password-error" role="alert">{passwordError}</div>}
            {passwordSuccess && (
              <div className="success" role="status">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                {passwordSuccess}
              </div>
            )}
            <div className="profile-actions">
              <button type="submit" disabled={passwordSaving || !currentPassword || !newPassword || !confirmNewPassword}>
                {passwordSaving ? (
                  <span className="btn-spinner"><span className="spinner-sm" />Changing…</span>
                ) : 'Change password'}
              </button>
            </div>
          </form>
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
                    {setupLoading ? (
                      <span className="btn-spinner"><span className="spinner-sm" />Verifying…</span>
                    ) : 'Enable 2FA'}
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
                    <div className="password-input-wrapper">
                      <input
                        type={showDisablePassword ? 'text' : 'password'}
                        id="disable-password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        autoComplete="current-password"
                        required
                      />
                      <button type="button" className="password-toggle" onClick={() => setShowDisablePassword(v => !v)} tabIndex={-1} aria-label={showDisablePassword ? 'Hide password' : 'Show password'}>
                        {showDisablePassword ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  {disableError && <div className="error">{disableError}</div>}
                  <div className="profile-actions">
                    <button type="submit" className="btn-danger" disabled={disableLoading}>
                      {disableLoading ? (
                        <span className="btn-spinner"><span className="spinner-sm" />Disabling…</span>
                      ) : 'Disable 2FA'}
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

        <section className="profile-section api-tokens-section">
          <h2>API Tokens</h2>
          <p className="profile-section-desc">Personal access tokens allow third-party applications to access the Plank API on your behalf.</p>

          {tokensLoading ? (
            <p className="profile-loading">Loading...</p>
          ) : (
            <>
              {/* Show-once modal for new token */}
              {showNewToken && showNewToken.token && (
                <div className="token-modal-overlay" onClick={() => setShowNewToken(null)}>
                  <div className="token-modal" onClick={e => e.stopPropagation()}>
                    <h3>Token Created</h3>
                    <p className="token-warning">
                      Make sure to copy your personal access token now. You won't be able to see it again!
                    </p>
                    <div className="token-display">
                      <code>{showNewToken.token}</code>
                      <button
                        className="token-copy-btn"
                        onClick={() => handleCopyToken(showNewToken.token!)}
                      >
                        {tokenCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <button className="btn-primary" onClick={() => setShowNewToken(null)}>
                      Done
                    </button>
                  </div>
                </div>
              )}

              {/* Token list */}
              {tokens.length > 0 && (
                <div className="token-list">
                  {tokens.map(token => (
                    <div key={token.id} className="token-item">
                      <div className="token-info">
                        <div className="token-name">{token.name}</div>
                        <div className="token-meta">
                          Created {formatTokenDate(token.created_at)}
                          {token.last_used_at && <> &middot; Last used {formatTokenDate(token.last_used_at)}</>}
                          {token.expires_at && <> &middot; Expires {formatTokenDate(token.expires_at)}</>}
                        </div>
                      </div>
                      <button
                        className="btn-danger btn-sm"
                        onClick={() => handleRevokeToken(token.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Create form */}
              {showCreateForm ? (
                <form className="token-create-form" onSubmit={handleCreateToken}>
                  <div className="form-group">
                    <label htmlFor="token-name">Token name</label>
                    <input
                      type="text"
                      id="token-name"
                      value={newTokenName}
                      onChange={e => setNewTokenName(e.target.value.slice(0, 100))}
                      placeholder="e.g. CI/CD Pipeline"
                      maxLength={100}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="token-expiry">Expiration</label>
                    <select
                      id="token-expiry"
                      value={newTokenExpiry}
                      onChange={e => setNewTokenExpiry(e.target.value)}
                    >
                      <option value="never">No expiration</option>
                      <option value="30">30 days</option>
                      <option value="60">60 days</option>
                      <option value="90">90 days</option>
                    </select>
                  </div>
                  <div className="profile-actions">
                    <button type="submit" disabled={creatingToken || !newTokenName.trim()}>
                      {creatingToken ? 'Creating...' : 'Generate token'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setShowCreateForm(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="token-actions">
                  <button onClick={() => setShowCreateForm(true)}>
                    Generate new token
                  </button>
                  {tokens.length > 1 && (
                    <button className="btn-danger" onClick={handleRevokeAllTokens}>
                      Revoke all
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
