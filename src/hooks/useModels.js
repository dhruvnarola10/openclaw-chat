// Model list — locked to OpenClaw routing values only.
//
// Per the OpenResponses spec, the request body's `model` field MUST be
// `"openclaw"`, `"openclaw/default"`, or `"openclaw/<agentId>"`. Showing
// the provider-specific list (e.g. `gpt-oss:120b-cloud`) led to 400s
// because the gateway rejects non-routing values in the body. We expose
// only the safe routing options here and let OpenClaw decide which
// provider model to use behind the scenes.

import { useCallback, useEffect, useMemo } from 'react';

export function useModels({ agentId, model, setModel }) {
  const models = useMemo(() => {
    const base = [
      { id: 'openclaw',         label: 'openclaw (default routing)' },
      { id: 'openclaw/default', label: 'openclaw/default' },
    ];
    if (agentId && agentId !== 'default' && agentId !== 'main') {
      base.push({ id: `openclaw/${agentId}`, label: `openclaw/${agentId}` });
    } else if (agentId === 'main') {
      base.push({ id: 'openclaw/main', label: 'openclaw/main' });
    }
    return base;
  }, [agentId]);

  // Reset selection if the persisted value is something the gateway
  // would now reject (e.g. an old provider-specific id like gpt-oss:...).
  useEffect(() => {
    if (!model || !models.find((m) => m.id === model)) {
      setModel(models[0].id);
    }
  }, [model, models, setModel]);

  // Refresh / WS-overlay are no-ops in this simplified mode, but kept as
  // stable callbacks so existing call sites don't have to change.
  const noop = useCallback(() => {}, []);

  return {
    models,
    loading:           false,
    error:             '',
    refresh:           noop,
    setModelsFromWs:   noop,
    setGatewayRequest: noop,
  };
}
