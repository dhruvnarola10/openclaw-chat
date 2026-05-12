// User-session gate backed by the /auth API.
//
// Stores the JWT in localStorage (persists across reloads), exposes
// `login`, `register`, `logout`, and the current `user`. On boot we
// re-validate the saved token by hitting /auth/me; expired or rejected
// tokens are silently cleared.

import { useEffect, useState } from 'react';

const TOKEN_KEY = 'oc-jwt';
const USER_KEY  = 'oc-user';

// Read API base from Vite env, fall back to /api/v1 for nginx-proxied prod.
const API = import.meta.env.VITE_MC_API ?? '/api/v1';

async function jsonFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user,  setUser]  = useState(() => {
    const raw = localStorage.getItem(USER_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [bootChecked, setBootChecked] = useState(!token);  // skip check if no token

  // Re-validate saved token on first mount. If /auth/me returns 401, the
  // token is stale (expired or revoked) — drop it and force re-login.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const data = await jsonFetch('/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (alive && data?.user) {
          setUser(data.user);
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
      } catch (e) {
        if (alive && e.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (alive) setBootChecked(true);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (tok, usr) => {
    localStorage.setItem(TOKEN_KEY, tok);
    localStorage.setItem(USER_KEY,  JSON.stringify(usr));
    setToken(tok);
    setUser(usr);
  };

  const login = async ({ email, password }) => {
    const data = await jsonFetch('/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ email, password }),
    });
    persist(data.token, data.user);
    return data.user;
  };

  const register = async ({ email, password, name }) => {
    const data = await jsonFetch('/auth/register', {
      method: 'POST',
      body:   JSON.stringify({ email, password, name }),
    });
    persist(data.token, data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  return {
    authed: !!token,
    bootChecked,
    user,
    token,
    login,
    register,
    logout,
  };
}
