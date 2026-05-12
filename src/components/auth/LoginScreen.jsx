// Front-door auth gate. Two modes:
//   • login    — email + password → POST /auth/login
//   • register — email + password + (optional) name → POST /auth/register
// Both call into the useAuth hook which persists the JWT and refreshes
// the parent App.

import { useState } from 'react';
import { LogIn, Send, UserPlus, Zap } from 'lucide-react';

export default function LoginScreen({ onLogin, onRegister }) {
  const [mode,     setMode]     = useState('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');
  const [shaking,  setShaking]  = useState(false);

  const isLogin = mode === 'login';

  const valid = email.trim() && password.length >= (isLogin ? 1 : 8);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError('');
    try {
      if (isLogin) await onLogin({ email: email.trim(), password });
      else         await onRegister({ email: email.trim(), password, name: name.trim() || undefined });
      // Success — App will swap to the authed view.
    } catch (err) {
      setError(err.message || 'Authentication failed');
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className={`login-card${shaking ? ' shake' : ''}`}>
        <div className="login-logo"><Zap size={24} /></div>
        <h1 className="login-title">Leonardo AI</h1>
        <p className="login-sub">
          {isLogin ? 'Sign in to your account' : 'Create an account to get started'}
        </p>

        <div className="login-tabs">
          <button type="button"
            className={`login-tab${isLogin ? ' login-tab--active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}>
            <LogIn size={13} /> Sign in
          </button>
          <button type="button"
            className={`login-tab${!isLogin ? ' login-tab--active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}>
            <UserPlus size={13} /> Register
          </button>
        </div>

        <form onSubmit={submit} className="login-form">
          {!isLogin && (
            <input
              className="login-input"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="Name (optional)"
              autoComplete="name"
              maxLength={120}
            />
          )}
          <input
            className={`login-input${error ? ' login-input-err' : ''}`}
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            placeholder="Email"
            autoFocus
            autoComplete="email"
            required
          />
          <input
            className={`login-input${error ? ' login-input-err' : ''}`}
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder={isLogin ? 'Password' : 'Password (≥8 characters)'}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
            minLength={isLogin ? 1 : 8}
          />

          {error && <p className="login-error">{error}</p>}

          <button className="login-btn" type="submit" disabled={!valid || busy}>
            <Send size={15} />
            {busy ? '…' : (isLogin ? 'Sign in' : 'Create account')}
          </button>
        </form>
      </div>
    </div>
  );
}
