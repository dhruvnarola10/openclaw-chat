// Model list — pulled from the gateway via `models.list` (WS).
//
// In direct-WS chat mode we patch the chosen model onto the session via
// `sessions.patch` before sending, so any provider model the gateway
// exposes is selectable. The HTTP fallback path requires a routing-style
// id (`openclaw` / `openclaw/<agentId>`), so we always offer those at
// the top of the list as safe defaults.

import { useCallback, useEffect, useMemo, useState } from 'react';

const ROUTING_FALLBACK = (agentId) => {
  const out = [
    { id: 'openclaw',         label: 'openclaw (default routing)' },
    { id: 'openclaw/default', label: 'openclaw/default' },
  ];
  if (agentId && agentId !== 'default') {
    out.push({ id: `openclaw/${agentId}`, label: `openclaw/${agentId}` });
  }
  return out;
};

export function useModels({ agentId, model, setModel }) {
  const [wsModels, setWsModels] = useState([]);

  const models = useMemo(() => {
    const seen = new Set();
    const out  = [];
    for (const m of [...wsModels, ...ROUTING_FALLBACK(agentId)]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [wsModels, agentId]);

  // Reset selection if persisted value disappeared from the new list.
  useEffect(() => {
    if (!model || !models.find((m) => m.id === model)) {
      setModel(models[0].id);
    }
  }, [model, models, setModel]);

  // Receives the gateway's `models.list` payload.
  const setModelsFromWs = useCallback((wsRaw) => {
    if (!Array.isArray(wsRaw)) return;
    const mapped = wsRaw
      .filter((m) => m?.id || m?.name)
      .map((m) => ({
        id:    String(m.id ?? m.name),
        label: m.alias
          ? `${m.name ?? m.id} (${m.alias})`
          : String(m.name ?? m.id),
      }));
    setWsModels(mapped);
  }, []);

  const noop = useCallback(() => {}, []);

  return {
    models,
    loading: false,
    error:   '',
    refresh: noop,
    setModelsFromWs,
    setGatewayRequest: noop, // legacy interface
  };
}
