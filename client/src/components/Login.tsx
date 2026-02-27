import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import PlinyLogo from './PlinyLogo';

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<void>;
  onSsoLogin: (token: string) => Promise<void>;
  ssoError?: string | null;
  sso2faTicket?: string | null;
  onSso2faComplete?: () => void;
  onForgotPassword?: () => void;
}

export default function Login({ onLogin, onSsoLogin, ssoError, sso2faTicket, onSso2faComplete, onForgotPassword }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    if (sso2faTicket) {
      setTicket(sso2faTicket);
      setAwaiting2fa(true);
    }
  }, [sso2faTicket]);

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
            <PlinyLogo size={48} />
            <h1>Pliny</h1>
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
                aria-describedby={error ? 'totp-error' : 'totp-hint'}
              />
              <span className="form-hint" id="totp-hint">Or enter a backup code</span>
            </div>
            {error && <div className="error" id="totp-error" role="alert">{error}</div>}
            <button type="submit" disabled={loading || totpCode.length < 6}>
              {loading ? (
                <span className="btn-spinner"><span className="spinner-sm" />Verifying…</span>
              ) : 'Verify'}
            </button>
            <button
              type="button"
              className="btn-link login-back-link"
              onClick={() => { setAwaiting2fa(false); setTotpCode(''); setError(''); onSso2faComplete?.(); }}
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
          <PlinyLogo size={48} />
          <h1>Pliny</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              required
              autoComplete="username"
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                required
                autoComplete="current-password"
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword(v => !v)} tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
            {onForgotPassword && (
              <button type="button" className="btn-link forgot-password-link" onClick={onForgotPassword}>
                Forgot password?
              </button>
            )}
          </div>
          {error && <div className="error" id="login-error" role="alert">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? (
              <span className="btn-spinner"><span className="spinner-sm" />Logging in…</span>
            ) : 'Login'}
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
