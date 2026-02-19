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

      <div className="settings-section">
        <h3>Registration</h3>
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

      <div className="settings-section disabled-section">
        <h3>Email (SMTP)</h3>
        <p className="coming-soon-label">Coming soon</p>
        <div className="setting-row disabled">
          <div className="setting-info">
            <div className="setting-label">SMTP Host</div>
          </div>
          <input type="text" disabled placeholder="smtp.example.com" />
        </div>
        <div className="setting-row disabled">
          <div className="setting-info">
            <div className="setting-label">Port</div>
          </div>
          <input type="text" disabled placeholder="587" />
        </div>
        <div className="setting-row disabled">
          <div className="setting-info">
            <div className="setting-label">Username</div>
          </div>
          <input type="text" disabled placeholder="user@example.com" />
        </div>
        <div className="setting-row disabled">
          <div className="setting-info">
            <div className="setting-label">From Address</div>
          </div>
          <input type="text" disabled placeholder="noreply@example.com" />
        </div>
      </div>
    </div>
  );
}
