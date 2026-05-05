// Tiny session-storage gate against the build-time VITE_APP_TOKEN.
// If no token is configured, the gate is bypassed entirely.

import { useState } from 'react';
import { ENV } from '../config/env.js';

const KEY = 'oc-authed';

export function useAuth() {
  const [authed, setAuthed] = useState(() =>
    !ENV.appToken || sessionStorage.getItem(KEY) === '1'
  );

  const login = (entered) => {
    if (entered.trim() === ENV.appToken) {
      sessionStorage.setItem(KEY, '1');
      setAuthed(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    sessionStorage.removeItem(KEY);
    setAuthed(false);
  };

  return { authed, login, logout, gated: !!ENV.appToken };
}
