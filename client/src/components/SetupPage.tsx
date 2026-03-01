import { useState } from 'react';
import { api } from '../api';
import PlinyLogo from './PlinyLogo';

interface SetupPageProps {
  onSetupComplete: (user: any) => void;
}

export default function SetupPage({ onSetupComplete }: SetupPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      const result = await api.setup(username, password);
      onSetupComplete(result.user);
    } catch (err: any) {
      setError(err.message || 'Setup failed');
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
        <p className="login-subtitle">Welcome to Pliny</p>
        <p className="setup-description">Create your admin account to get started.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="setup-username">Username</label>
            <input
              type="text"
              id="setup-username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              required
              autoComplete="username"
              autoFocus
              maxLength={255}
            />
          </div>
          <div className="form-group">
            <label htmlFor="setup-password">Password</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="setup-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                required
                autoComplete="new-password"
                minLength={8}
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword(v => !v)} tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="setup-confirm-password">Confirm Password</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="setup-confirm-password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                required
                autoComplete="new-password"
                minLength={8}
              />
            </div>
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? (
              <span className="btn-spinner"><span className="spinner-sm" />Creating account…</span>
            ) : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
