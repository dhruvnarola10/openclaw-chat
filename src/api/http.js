// HTTP client for the OpenClaw OpenResponses surface.
// All functions accept the runtime config as arguments so they can be called
// from anywhere without depending on React state.

/**
 * Resolve the OpenClaw "base" URL from the responses URL.
 *  /api/responses                    → /api
 *  http://host/v1/responses          → http://host/v1
 *  http://host/v1/chat/completions   → http://host/v1
 */
export function resolveBaseUrl(apiUrl) {
  return (apiUrl || '/api/responses')
    .replace(/\/responses$/, '')
    .replace(/\/(chat\/)?completions$/, '');
}

/**
 * GET <base>/models — supports OpenAI ({data:[]}), OpenClaw ({models:[]})
 * and bare-array response shapes.
 *
 * Returns: { id, label }[]
 * Throws on network / non-2xx.
 */
export async function fetchModelsHttp({ apiUrl, token }) {
  const base = resolveBaseUrl(apiUrl);
  const url  = base.endsWith('/models') ? base : `${base}/models`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const json = await res.json();
  const list = Array.isArray(json) ? json : json.data ?? json.models ?? [];

  return list
    .filter((m) => m.id)
    .map((m) => ({
      id:    m.id,
      label: m.alias ? `${m.name ?? m.id} (${m.alias})` : (m.name ?? m.id),
    }));
}

/**
 * POST <apiUrl> — opens an SSE stream against the OpenResponses endpoint.
 *
 * The body's `model` field MUST be one of:
 *   "openclaw" | "openclaw/default" | "openclaw/<agentId>"
 * The dropdown is locked to those values (see hooks/useModels.js), so we
 * pass the body through unchanged. OpenClaw decides which provider model
 * to dispatch internally based on the agent configuration.
 */
export function postResponses({ apiUrl, token, agentId, sessionKey, body, signal }) {
  return fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': agentId,
      'x-openclaw-session-key': sessionKey,
    },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Stream-reader helper: reads an SSE body chunk-by-chunk and dispatches
 * each `data:` line to the supplied handler with `{ type, payload }`.
 *
 * The OpenResponses SSE wire format:
 *   event: response.output_text.delta
 *   data:  { "type": "...", "delta": "..." }
 *   data:  [DONE]
 */
export async function readSseStream(response, onEvent) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let evt = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line)                       { evt = ''; continue; }
      if (line.startsWith('event:'))   { evt = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:'))   continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]')           continue;
      try {
        const parsed = JSON.parse(data);
        onEvent({ type: parsed.type || evt, payload: parsed });
      } catch {
        // ignore malformed chunk — server sometimes splits frames mid-way
      }
    }
  }
}
