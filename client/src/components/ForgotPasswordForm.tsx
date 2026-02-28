import { useState, useRef, useEffect } from 'react';
import { api } from '../api';
import PlinyLogo from './PlinyLogo';

interface ForgotPasswordFormProps {
  onBack: () => void;
}

export default function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if ((success || error) && resultRef.current) {
      resultRef.current.focus();
    }
  }, [success, error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.forgotPassword(email);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <PlinyLogo size={48} showName />
        </div>

        {success ? (
          <div className="forgot-password-success" ref={resultRef} tabIndex={-1}>
            <div className="auth-result-icon auth-result-icon-success">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <p>If that email is registered, you'll receive a reset link shortly.</p>
            <p className="forgot-password-note">
              Don't have an email on your account? Contact your administrator to reset your password.
            </p>
            <button type="button" className="btn-link login-back-link" onClick={onBack}>
              Back to login
            </button>
          </div>
        ) : (
          <>
            <p className="login-subtitle">Enter your email to receive a password reset link</p>
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="forgot-email">Email</label>
                <input
                  type="email"
                  id="forgot-email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-describedby={error ? 'forgot-error' : undefined}
                />
              </div>
              {error && (
                <div className="error" id="forgot-error" role="alert" ref={resultRef} tabIndex={-1}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading || !email.trim()}>
                {loading ? (
                  <span className="btn-spinner"><span className="spinner-sm" />Sending…</span>
                ) : 'Send reset link'}
              </button>
            </form>
            <button type="button" className="btn-link login-back-link" onClick={onBack}>
              Back to login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
