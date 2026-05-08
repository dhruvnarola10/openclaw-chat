// Tiny fetch wrapper for the mission-control backend (/api/v1/*).
// Adds the bearer token from VITE_MC_TOKEN, parses JSON, surfaces errors
// with the server's actual error.message when present.

import { useCallback, useEffect, useState } from 'react';

const BASE  = import.meta.env.VITE_MC_API   ?? '/api/v1';
const TOKEN = import.meta.env.VITE_MC_TOKEN ?? '';

async function request(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(BASE + path, {
    method,
    signal,
    headers: {
      Authorization:  `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data   = data;
    throw err;
  }
  return data;
}

export const api = {
  get:    (path)         => request(path),
  post:   (path, body)   => request(path, { method: 'POST',   body }),
  patch:  (path, body)   => request(path, { method: 'PATCH',  body }),
  delete: (path)         => request(path, { method: 'DELETE' }),
};

/** Hook: fetch on mount + on `deps` change, exposes `{data, loading, error, refresh}`. */
export function useApi(path, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const refresh = useCallback(async () => {
    if (!path) { setData(null); setLoading(false); return; }
    setLoading(true); setError('');
    try { setData(await api.get(path)); }
    catch (e) { setError(e.message); setData(null); }
    finally   { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}

/**
 * Open an SSE stream against /api/v1/<path>/stream and dispatch named events
 * to onEvent({type, payload}). Returns nothing — cleanup is automatic.
 *
 * Note: native EventSource can't set Authorization headers, so we put the
 * token in a query string. The backend accepts ?token=… as a fallback.
 */
export function openSse(path, onEvent) {
  const url = new URL(BASE + path, window.location.origin);
  url.searchParams.set('token', TOKEN);
  const es = new EventSource(url.toString());

  // We listen for any named event we care about
  for (const type of ['status', 'delta', 'approval']) {
    es.addEventListener(type, (e) => {
      try { onEvent({ type, payload: JSON.parse(e.data) }); }
      catch { /* ignore */ }
    });
  }

  es.addEventListener('error', () => onEvent({ type: 'error' }));
  return () => es.close();
}
