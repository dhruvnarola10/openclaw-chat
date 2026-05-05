// Persists OpenClaw config (apiUrl/token/agentId/model/stream) to localStorage
// and exposes setters. Used by every component that needs to talk to the API.

import { useEffect, useState } from 'react';
import { ENV } from '../config/env.js';
import { load, save } from '../utils/storage.js';

export function useConfig() {
  const [apiUrl,  setApiUrl]  = useState(() => load('oc-apiUrl',  ENV.apiUrl));
  const [token,   setToken]   = useState(() => load('oc-token',   ENV.token));
  const [agentId, setAgentId] = useState(() => load('oc-agentId', ENV.agentId));
  const [model,   setModel]   = useState(() => load('oc-model',   ENV.model));
  const [stream,  setStream]  = useState(() => load('oc-stream',  ENV.stream));

  useEffect(() => save('oc-apiUrl',  apiUrl),  [apiUrl]);
  useEffect(() => save('oc-token',   token),   [token]);
  useEffect(() => save('oc-agentId', agentId), [agentId]);
  useEffect(() => save('oc-model',   model),   [model]);
  useEffect(() => save('oc-stream',  stream),  [stream]);

  return {
    apiUrl, token, agentId, model, stream,
    setApiUrl, setToken, setAgentId, setModel, setStream,
  };
}
