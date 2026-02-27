import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api';
import PlinyLogo from './PlinyLogo';

interface ResetPasswordFormProps {
  onNavigateToLogin: () => void;
  onNavigateToForgotPassword: () => void;
}

function getPasswordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  const clamped = Math.min(4, Math.max(1, score));
  const labels: Record<number, string> = { 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' };
  return { score: clamped, label: labels[clamped] };
}

export default function ResetPasswordForm({ onNavigateToLogin, onNavigateToForgotPassword }: ResetPasswordFormProps) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      setToken(tokenParam);
    }
  }, []);

  useEffect(() => {
    if ((success || error) && resultRef.current) {
      resultRef.current.focus();
    }
  }, [success, error]);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      await api.resetPassword(token, password);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const isExpiredError = error.includes('expired') || error.includes('invalid');

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <PlinyLogo size={48} />
          <h1>Pliny</h1>
        </div>

        {success ? (
          <div className="reset-password-success" ref={resultRef} tabIndex={-1}>
            <div className="auth-result-icon auth-result-icon-success">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <p>Password updated successfully!</p>
            <button type="button" className="btn-primary" onClick={onNavigateToLogin} style={{ width: '100%' }}>
              Log in
            </button>
          </div>
        ) : !token ? (
          <div className="reset-password-error" ref={resultRef} tabIndex={-1}>
            <div className="auth-result-icon auth-result-icon-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <p>No reset token found.</p>
            <button type="button" className="btn-link login-back-link" onClick={onNavigateToForgotPassword}>
              Request a new reset link
            </button>
          </div>
        ) : (
          <>
            <p className="login-subtitle">Enter your new password</p>
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="new-password">New password</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="new-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    required
                    autoComplete="new-password"
                    minLength={8}
                    aria-describedby={error ? 'reset-error' : password ? 'pw-strength' : undefined}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
                {password && (
                  <div className="password-strength" id="pw-strength" aria-live="polite">
                    <div className="password-strength-bar">
                      <div className="password-strength-fill" data-strength={strength.score} />
                    </div>
                    <div className="password-strength-label">{strength.label}</div>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  required
                  autoComplete="new-password"
                />
              </div>
              {error && (
                <div className="error" id="reset-error" role="alert" ref={resultRef} tabIndex={-1}>
                  {error}
                  {isExpiredError && (
                    <button
                      type="button"
                      className="btn-link"
                      onClick={onNavigateToForgotPassword}
                      style={{ marginLeft: '0.5rem' }}
                    >
                      Request a new one
                    </button>
                  )}
                </div>
              )}
              <button type="submit" disabled={loading || !password || !confirmPassword}>
                {loading ? (
                  <span className="btn-spinner"><span className="spinner-sm" />Updating…</span>
                ) : 'Update password'}
              </button>
            </form>
            <button type="button" className="btn-link login-back-link" onClick={onNavigateToLogin}>
              Back to login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
