import { useState, useEffect } from 'react';
import { api } from '../api';
import { User } from '../types';
import AppBar from './AppBar';

interface ProfileSettingsProps {
  user: User;
  onBack: () => void;
}

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

  useEffect(() => {
    api.getTotpStatus()
      .then(data => setTotpEnabled(data.enabled))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      </div>
    </div>
  );
}
