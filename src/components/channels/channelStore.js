// Backend-backed channel-config client. Talks to the mission-control API at
// /api/v1/channels.

const BASE  = import.meta.env.VITE_MC_API   ?? '/api/v1';
const TOKEN = import.meta.env.VITE_MC_TOKEN ?? '';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
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

export async function listChannelConfigs() {
  const data = await request('/channels');
  return Array.isArray(data?.items) ? data.items : [];
}

export async function loadChannelConfig(channelId) {
  try {
    return await request(`/channels/${encodeURIComponent(channelId)}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function saveChannelConfig(channelId, values, { enabled = true } = {}) {
  return request(`/channels/${encodeURIComponent(channelId)}`, {
    method: 'PUT',
    body:   { config: values, enabled },
  });
}

export async function clearChannelConfig(channelId) {
  return request(`/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
}
