import { useState, useEffect } from 'react';
import { api } from '../api';

export default function GeneralSettings() {
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await api.getAppSettings();
      setRegistrationEnabled(settings.registration_enabled ?? true);
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

      <div className="settings-card settings-card-disabled">
        <div className="settings-card-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
          </svg>
          <h3>Email (SMTP)</h3>
          <span className="coming-soon-pill">Coming soon</span>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">SMTP Host</div>
          </div>
          <input type="text" disabled placeholder="smtp.example.com" className="setting-input" />
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Port</div>
          </div>
          <input type="text" disabled placeholder="587" className="setting-input" />
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Username</div>
          </div>
          <input type="text" disabled placeholder="user@example.com" className="setting-input" />
        </div>
        <div className="setting-row setting-row-last">
          <div className="setting-info">
            <div className="setting-label">From Address</div>
          </div>
          <input type="text" disabled placeholder="noreply@example.com" className="setting-input" />
        </div>
      </div>
    </div>
  );
}
