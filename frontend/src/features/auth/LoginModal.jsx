import { useEffect, useState } from 'react';
import { Lock, User, X } from 'lucide-react';
import { Button } from '../../app/ui/Button';
import { Card, CardHeader } from '../../app/ui/Card';
import { login } from '../../app/services/auth';

const LAST_USERNAME_STORAGE_KEY = 'westos.auth.lastUsername';

export function LoginModal({ open, onClose }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    const lastUsername = typeof window !== 'undefined'
      ? String(window.localStorage.getItem(LAST_USERNAME_STORAGE_KEY) || '')
      : '';
    setUsername(lastUsername);
    setPassword('');
    setError('');
  }, [open]);

  if (!open) {
    return null;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login(username, password);
      if (typeof window !== 'undefined' && username.trim()) {
        window.localStorage.setItem(LAST_USERNAME_STORAGE_KEY, username.trim());
      }
      window.dispatchEvent(new CustomEvent('westos:auth-changed'));
      onClose?.();
    } catch (requestError) {
      setError(requestError.message || 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-modal" role="presentation" onClick={onClose}>
      <div className="auth-modal__surface" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Sign in">
        <Card className="auth-modal__card">
          <div className="auth-modal__close-row">
            <button type="button" className="compact-toggle compact-toggle--icon" onClick={onClose} aria-label="Close sign in">
              <X size={14} />
            </button>
          </div>
          <CardHeader
            eyebrow="westOS"
            title="Sign in to continue"
            description="Sign in with your westOS account."
          />

          <form onSubmit={onSubmit} className="login-page__form">
            <label className="login-field">
              <User size={15} />
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </label>

            <label className="login-field">
              <Lock size={15} />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error ? <p className="status-text status-text--error">{error}</p> : null}
            <Button type="submit" disabled={loading} className="login-page__submit">
              {loading ? 'Signing In...' : 'Sign In'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default LoginModal;
