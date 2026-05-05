// Front-door access gate. Compares against ENV.appToken at submit time.

import { useState } from 'react';
import { Send, Zap } from 'lucide-react';

export default function LoginScreen({ onSubmit }) {
  const [value,   setValue]   = useState('');
  const [error,   setError]   = useState('');
  const [shaking, setShaking] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (onSubmit(value)) return;        // success — App will swap views
    setError('Invalid access token.');
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
    setValue('');
  };

  return (
    <div className="login-screen">
      <div className={`login-card${shaking ? ' shake' : ''}`}>
        <div className="login-logo"><Zap size={24} /></div>
        <h1 className="login-title">Leonardo AI</h1>
        <p className="login-sub">Enter your access token to continue</p>
        <form onSubmit={submit} className="login-form">
          <input
            className={`login-input${error ? ' login-input-err' : ''}`}
            type="password"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            placeholder="Access token"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          {error && <p className="login-error">{error}</p>}
          <button className="login-btn" type="submit" disabled={!value.trim()}>
            <Send size={15} /> Continue
          </button>
        </form>
      </div>
    </div>
  );
}
