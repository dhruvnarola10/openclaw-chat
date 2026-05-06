// Model list — pulled from the gateway via `models.list` (WS).
//
// In direct-WS chat mode we patch the chosen model onto the session via
// `sessions.patch` before sending, so any provider model the gateway
// exposes is selectable. The HTTP fallback path requires a routing-style
// id (`openclaw` / `openclaw/<agentId>`), so we always offer those at
// the top of the list as safe defaults.

import { useCallback, useEffect, useMemo, useState } from 'react';

// Static routing options. Only the dynamic `openclaw/<agentId>` is kept;
// the others ("openclaw" and "openclaw/default") are commented out because
// the WS `models.list` already provides every real model the gateway can
// route to. Uncomment if you ever want them back as picker entries.
// const ROUTING_FALLBACK = (agentId) => {
//   const out = [
//     { id: 'openclaw',         label: 'openclaw (default routing)' },
//     { id: 'openclaw/default', label: 'openclaw/default' },
//   ];
//   if (agentId && agentId !== 'default') {
//     out.push({ id: `openclaw/${agentId}`, label: `openclaw/${agentId}` });
//   }
//   return out;
// };

// Routing-style ids that the gateway sometimes returns from `models.list`
// alongside real provider models. Hide them from the picker since they're
// just aliases for "use the agent default" — confusing in a model dropdown.
const ROUTING_RE = /^openclaw(\/|$)/i;

// export function useModels({ agentId, model, setModel }) {
export function useModels({ model, setModel }) {
  const [wsModels, setWsModels] = useState([]);

  const models = useMemo(() => {
    const seen = new Set();
    const out  = [];
    for (const m of [...wsModels]) {
      // if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [wsModels]);

  // Reset selection if persisted value disappeared from the new list.
  useEffect(() => {
    if (!model || !models.find((m) => m.id === model)) {
      setModel(models[0]?.id);
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
      }))
      .filter((m) => !ROUTING_RE.test(m.id));   // hide openclaw/<agentId> aliases
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
