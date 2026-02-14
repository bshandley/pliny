import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import PlankLogo from './PlankLogo';

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<void>;
  onSsoLogin: (token: string) => Promise<void>;
  ssoError?: string | null;
}

export default function Login({ onLogin, onSsoLogin, ssoError }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 2FA state
  const [awaiting2fa, setAwaiting2fa] = useState(false);
  const [ticket, setTicket] = useState('');
  const [totpCode, setTotpCode] = useState('');

  // SSO config
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoButtonLabel, setSsoButtonLabel] = useState('Login with SSO');

  const totpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getOidcPublicConfig().then(config => {
      setSsoEnabled(config.enabled);
      setSsoButtonLabel(config.button_label);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (ssoError) {
      setError(ssoError === 'state_mismatch' ? 'SSO session expired. Please try again.' :
               ssoError === 'not_configured' ? 'SSO is not configured.' :
               `SSO login failed: ${ssoError}`);
    }
  }, [ssoError]);

  useEffect(() => {
    if (awaiting2fa && totpInputRef.current) {
      totpInputRef.current.focus();
    }
  }, [awaiting2fa]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await onLogin(username, password);
    } catch (err: any) {
      if (err.requires_2fa) {
        setTicket(err.ticket);
        setAwaiting2fa(true);
      } else {
        setError(err.message || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.verify2fa(ticket, totpCode);
      await onSsoLogin(api.getToken()!);
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleSsoLogin = () => {
    window.location.href = '/api/auth/oidc/login';
  };

  if (awaiting2fa) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">
            <PlankLogo size={48} />
            <h1>Plank</h1>
          </div>
          <p className="login-subtitle">Enter the 6-digit code from your authenticator app</p>
          <form onSubmit={handleVerify2fa}>
            <div className="form-group">
              <label htmlFor="totp-code">Verification code</label>
              <input
                ref={totpInputRef}
                type="text"
                id="totp-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                required
              />
              <span className="form-hint">Or enter a backup code</span>
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={loading || totpCode.length < 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              className="btn-link login-back-link"
              onClick={() => { setAwaiting2fa(false); setTotpCode(''); setError(''); }}
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <PlankLogo size={48} />
          <h1>Plank</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        {ssoEnabled && (
          <>
            <div className="login-divider">
              <span>or</span>
            </div>
            <button
              type="button"
              className="btn-sso"
              onClick={handleSsoLogin}
              disabled={loading}
            >
              {ssoButtonLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
