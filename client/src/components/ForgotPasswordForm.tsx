import { useState } from 'react';
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
          <PlinyLogo size={48} />
          <h1>Pliny</h1>
        </div>

        {success ? (
          <div className="forgot-password-success">
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
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>
              {error && <div className="error">{error}</div>}
              <button type="submit" disabled={loading || !email.trim()}>
                {loading ? 'Sending...' : 'Send reset link'}
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
