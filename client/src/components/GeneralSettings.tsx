import { useState, useEffect } from 'react';
import { api } from '../api';

export default function GeneralSettings() {
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpSaved, setSmtpSaved] = useState(false);

  // SMTP fields
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFromAddress, setSmtpFromAddress] = useState('');
  const [smtpTls, setSmtpTls] = useState(true);
  const [smtpPasswordSet, setSmtpPasswordSet] = useState(false);

  // Test connection
  const [smtpTestEmail, setSmtpTestEmail] = useState('');
  const [smtpTestStatus, setSmtpTestStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [smtpTestSending, setSmtpTestSending] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await api.getAppSettings();
      setRegistrationEnabled(settings.registration_enabled ?? true);
      setSmtpHost(settings.smtp_host || '');
      setSmtpPort(settings.smtp_port || '587');
      setSmtpUsername(settings.smtp_username || '');
      setSmtpFromAddress(settings.smtp_from_address || '');
      // smtp_tls may come back as a string from the API; coerce correctly; default true
      setSmtpTls(settings.smtp_tls == null ? true : String(settings.smtp_tls) === 'true');
      // If password is masked, it means one is set
      if (settings.smtp_password && settings.smtp_password !== '') {
        setSmtpPasswordSet(true);
        setSmtpPassword('');
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRegistration = async () => {
    const newValue = !registrationEnabled;
    setSaving(true);
    try {
      await api.updateAppSetting('registration_enabled', newValue);
      setRegistrationEnabled(newValue);
    } catch (err) {
      console.error('Failed to update setting:', err);
    } finally {
      setSaving(false);
    }
  };

  const saveSmtpField = async (key: string, value: any) => {
    try {
      await api.updateAppSetting(key, value);
    } catch (err) {
      console.error(`Failed to save ${key}:`, err);
    }
  };

  const handleSmtpBlur = (key: string, value: string) => {
    saveSmtpField(key, value);
  };

  const handlePasswordBlur = () => {
    // Only save if user actually typed something new
    if (smtpPassword) {
      saveSmtpField('smtp_password', smtpPassword);
      setSmtpPasswordSet(true);
      setSmtpPassword('');
    }
  };

  const handleToggleTls = () => {
    setSmtpTls(prev => !prev);
  };

  const handleSaveSmtp = async () => {
    setSmtpSaving(true);
    setSmtpSaved(false);
    try {
      await Promise.all([
        saveSmtpField('smtp_host', smtpHost),
        saveSmtpField('smtp_port', smtpPort),
        saveSmtpField('smtp_username', smtpUsername),
        saveSmtpField('smtp_from_address', smtpFromAddress),
        saveSmtpField('smtp_tls', smtpTls),
        ...(smtpPassword ? [saveSmtpField('smtp_password', smtpPassword)] : []),
      ]);
      if (smtpPassword) {
        setSmtpPasswordSet(true);
        setSmtpPassword('');
      }
      setSmtpSaved(true);
      setTimeout(() => setSmtpSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save SMTP settings:', err);
    } finally {
      setSmtpSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!smtpTestEmail) return;
    setSmtpTestSending(true);
    setSmtpTestStatus(null);
    try {
      const result = await api.testSmtp(smtpTestEmail);
      setSmtpTestStatus({ type: 'success', message: result.message });
    } catch (err: any) {
      setSmtpTestStatus({ type: 'error', message: err.message || 'Failed to send test email' });
    } finally {
      setSmtpTestSending(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="general-settings">
      <div className="panel-header">
        <h2>General</h2>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <h3>Registration</h3>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Open registration</div>
            <div className="setting-desc">When enabled, anyone can create an account. When disabled, only admins can create users.</div>
          </div>
          <button
            className={`toggle-switch${registrationEnabled ? ' active' : ''}`}
            onClick={handleToggleRegistration}
            disabled={saving}
            role="switch"
            aria-checked={registrationEnabled}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
          </svg>
          <h3>Email (SMTP)</h3>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">SMTP Host</div>
            <div className="setting-desc">Your mail server hostname</div>
          </div>
          <input
            type="text"
            className="setting-input"
            placeholder="smtp.example.com"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
          />
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Port</div>
            <div className="setting-desc">587 (STARTTLS) or 465 (implicit SSL)</div>
          </div>
          <input
            type="text"
            className="setting-input"
            placeholder="587"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
          />
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Username</div>
            <div className="setting-desc">SMTP authentication username</div>
          </div>
          <input
            type="text"
            className="setting-input"
            placeholder="user@example.com"
            value={smtpUsername}
            onChange={(e) => setSmtpUsername(e.target.value)}
          />
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Password</div>
            <div className="setting-desc">SMTP authentication password</div>
          </div>
          <input
            type="password"
            className="setting-input"
            placeholder={smtpPasswordSet ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : ''}
            value={smtpPassword}
            onChange={(e) => setSmtpPassword(e.target.value)}
          />
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">From Address</div>
            <div className="setting-desc">Sender email address for outgoing mail</div>
          </div>
          <input
            type="email"
            className="setting-input"
            placeholder="noreply@example.com"
            value={smtpFromAddress}
            onChange={(e) => setSmtpFromAddress(e.target.value)}
          />
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">TLS</div>
            <div className="setting-desc">Encrypt connections — SSL on port 465, STARTTLS on port 587</div>
          </div>
          <button
            className={`toggle-switch${smtpTls ? ' active' : ''}`}
            onClick={handleToggleTls}
            role="switch"
            aria-checked={smtpTls}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <div className="setting-row" style={{ justifyContent: 'flex-end', gap: '12px' }}>
          {smtpSaved && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-success, #2d7a46)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Saved
            </span>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSaveSmtp}
            disabled={smtpSaving}
            style={{ whiteSpace: 'nowrap' }}
          >
            {smtpSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <div className="setting-row setting-row-last" style={{ alignItems: 'flex-start' }}>
          <div className="setting-info">
            <div className="setting-label">Test Connection</div>
            <div className="setting-desc">Send a test email to verify your SMTP settings</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="email"
                className="setting-input"
                placeholder="test@example.com"
                value={smtpTestEmail}
                onChange={(e) => setSmtpTestEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTestConnection(); }}
              />
              <button
                className="btn btn-primary"
                onClick={handleTestConnection}
                disabled={smtpTestSending || !smtpTestEmail}
                style={{ whiteSpace: 'nowrap' }}
              >
                {smtpTestSending ? 'Sending...' : 'Send Test'}
              </button>
            </div>
            {smtpTestStatus && (
              <div
                className={`smtp-test-status ${smtpTestStatus.type}`}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  backgroundColor: smtpTestStatus.type === 'success' ? 'var(--bg-success, #d4edda)' : 'var(--bg-error, #f8d7da)',
                  color: smtpTestStatus.type === 'success' ? 'var(--text-success, #155724)' : 'var(--text-error, #721c24)',
                }}
              >
                {smtpTestStatus.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
