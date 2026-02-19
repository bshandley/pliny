import { useState, useEffect } from 'react';
import { api } from '../api';

export default function OidcSettings() {
  const [enabled, setEnabled] = useState(false);
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [clientSecretMasked, setClientSecretMasked] = useState('');
  const [buttonLabel, setButtonLabel] = useState('Login with SSO');
  const [claimEmail, setClaimEmail] = useState('email');
  const [claimName, setClaimName] = useState('name');
  const [claimAvatar, setClaimAvatar] = useState('picture');
  const [callbackBaseUrl, setCallbackBaseUrl] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getOidcSettings()
      .then(data => {
        setEnabled(data.enabled);
        setIssuerUrl(data.issuer_url);
        setClientId(data.client_id);
        setClientSecretMasked(data.client_secret_masked);
        setButtonLabel(data.button_label);
        setClaimEmail(data.claim_email || 'email');
        setClaimName(data.claim_name || 'name');
        setClaimAvatar(data.claim_avatar || 'picture');
        setCallbackBaseUrl(data.callback_base_url || '');
        setCallbackUrl(data.callback_url || '');
      })
      .catch(err => setError(err.message || 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updates: any = {
        enabled,
        issuer_url: issuerUrl,
        client_id: clientId,
        button_label: buttonLabel,
        claim_email: claimEmail,
        claim_name: claimName,
        claim_avatar: claimAvatar,
        callback_base_url: callbackBaseUrl,
      };
      if (clientSecret) {
        updates.client_secret = clientSecret;
      }
      const result = await api.updateOidcSettings(updates);
      setCallbackUrl(result.callback_url || '');
      setSuccess('Settings saved');
      if (clientSecret) {
        setClientSecretMasked(clientSecret.length > 4 ? '\u2022\u2022\u2022\u2022' + clientSecret.slice(-4) : '\u2022\u2022\u2022\u2022');
        setClientSecret('');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCallback = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div><p>Loading...</p></div>;
  }

  return (
    <div className="oidc-settings">
      {/* Quick-start guide */}
      <div className="oidc-card oidc-quickstart">
        <div className="oidc-card-header">
          <svg className="oidc-card-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
          </svg>
          <h3>Getting Started</h3>
        </div>
        <ol className="oidc-steps">
          <li>
            <span className="oidc-step-num">1</span>
            <span>Create an OIDC client in your identity provider</span>
          </li>
          <li>
            <span className="oidc-step-num">2</span>
            <span>Set the <strong>Redirect URI</strong> to the callback URL below</span>
          </li>
          <li>
            <span className="oidc-step-num">3</span>
            <span>Copy the <strong>Client ID</strong> and <strong>Secret</strong> into the form</span>
          </li>
          <li>
            <span className="oidc-step-num">4</span>
            <span>Enable the <code>openid</code> <code>profile</code> <code>email</code> scopes</span>
          </li>
        </ol>
      </div>

      {/* Callback URL */}
      {callbackUrl && (
        <div className="oidc-card oidc-callback-card">
          <div className="oidc-card-header">
            <svg className="oidc-card-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <h3>Callback URL</h3>
          </div>
          <p className="oidc-callback-hint">Add this as the Redirect URI in your OIDC provider</p>
          <div className="oidc-callback-row">
            <code className="oidc-callback-value">{callbackUrl}</code>
            <button type="button" className="oidc-copy-btn" onClick={handleCopyCallback}>
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* Connection section */}
        <div className="oidc-card">
          <div className="oidc-card-header">
            <svg className="oidc-card-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
            <h3>Connection</h3>
            <label className="oidc-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="oidc-toggle-track">
                <span className="oidc-toggle-thumb" />
              </span>
              <span className="oidc-toggle-text">{enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="issuer-url">Issuer URL</label>
            <input
              type="url"
              id="issuer-url"
              value={issuerUrl}
              onChange={(e) => setIssuerUrl(e.target.value)}
              placeholder="https://id.example.com"
              maxLength={500}
            />
            <span className="form-hint">Provider base URL with <code>.well-known/openid-configuration</code></span>
          </div>

          <div className="form-group">
            <label htmlFor="client-id">Client ID</label>
            <input
              type="text"
              id="client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="plank"
              maxLength={255}
            />
          </div>

          <div className="form-group">
            <label htmlFor="client-secret">Client Secret</label>
            <input
              type="password"
              id="client-secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={clientSecretMasked || 'Enter secret'}
            />
            {clientSecretMasked && !clientSecret && (
              <span className="form-hint">Current: {clientSecretMasked}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="callback-base-url">External Base URL</label>
            <input
              type="url"
              id="callback-base-url"
              value={callbackBaseUrl}
              onChange={(e) => setCallbackBaseUrl(e.target.value)}
              placeholder="https://plank.example.com"
              maxLength={500}
            />
            <span className="form-hint">The public URL where Plank is reachable (used for OIDC redirects)</span>
          </div>
        </div>

        {/* Appearance section */}
        <div className="oidc-card">
          <div className="oidc-card-header">
            <svg className="oidc-card-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/>
              <circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
            </svg>
            <h3>Appearance</h3>
          </div>
          <div className="form-group">
            <label htmlFor="button-label">Login Button Text</label>
            <input
              type="text"
              id="button-label"
              value={buttonLabel}
              onChange={(e) => setButtonLabel(e.target.value)}
              placeholder="Login with SSO"
              maxLength={100}
            />
            <span className="form-hint">Shown on the login page</span>
          </div>
        </div>

        {/* Claim Mapping section */}
        <div className="oidc-card">
          <div className="oidc-card-header">
            <svg className="oidc-card-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <h3>Claim Mapping</h3>
          </div>
          <p className="oidc-section-desc">Map ID token claims to user profile fields. Defaults work with most providers.</p>
          <div className="oidc-claim-grid">
            <div className="oidc-claim-item">
              <label htmlFor="claim-email">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                </svg>
                Email
              </label>
              <input
                type="text"
                id="claim-email"
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
                placeholder="email"
                maxLength={100}
              />
            </div>
            <div className="oidc-claim-item">
              <label htmlFor="claim-name">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                Display Name
              </label>
              <input
                type="text"
                id="claim-name"
                value={claimName}
                onChange={(e) => setClaimName(e.target.value)}
                placeholder="name"
                maxLength={100}
              />
            </div>
            <div className="oidc-claim-item">
              <label htmlFor="claim-avatar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                Avatar URL
              </label>
              <input
                type="text"
                id="claim-avatar"
                value={claimAvatar}
                onChange={(e) => setClaimAvatar(e.target.value)}
                placeholder="picture"
                maxLength={100}
              />
            </div>
          </div>
        </div>

        {/* Status bar */}
        {(error || success) && (
          <div className={`oidc-status ${error ? 'oidc-status-error' : 'oidc-status-success'}`}>
            {error ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            )}
            {error || success}
          </div>
        )}

        <div className="oidc-save-bar">
          <button type="submit" className="oidc-save-btn" disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
