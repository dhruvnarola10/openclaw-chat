// Generic loader for any gateway RPC method. Handles:
//   • initial load when the gateway becomes ready
//   • manual refresh via the returned `refresh()` fn
//   • optional auto-refresh on an interval
//   • timeouts so a hung method doesn't strand the page
//
// The hook stays defensive: failures populate `error` instead of throwing.

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

export function useGatewayResource({
  gateway,
  method,
  params,
  intervalMs = 0,
  timeoutMs  = DEFAULT_TIMEOUT_MS,
  enabled    = true,
}) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [lastAt,  setLastAt]  = useState(null);
  const inFlight = useRef(false);

  // Stringify params so the effect dep is stable; safe because they're plain JSON.
  const paramsKey = params ? JSON.stringify(params) : '';

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (gateway?.status !== 'on') return;
    if (!method) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const payload = await withTimeout(gateway.request(method, params ?? {}), timeoutMs);
      setData(payload);
      setLastAt(Date.now());
    } catch (e) {
      setError(`${method}: ${e.message}`);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [gateway, method, paramsKey, timeoutMs, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gateway?.status === 'on') refresh();
  }, [gateway?.status, paramsKey, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!intervalMs) return;
    if (gateway?.status !== 'on') return;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [gateway?.status, intervalMs, refresh]);

  return { data, loading, error, lastAt, refresh };
}
