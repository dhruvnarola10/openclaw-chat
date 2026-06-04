// Resolve OpenClaw `MEDIA:<path>` / message-tool attachment paths to a
// renderable URL.
//
// We route through OUR backend (`/api/v1/media/proxy`) instead of hitting
// the OpenClaw gateway directly — that avoids CORS, lets <img src=> work
// without setting headers, and works regardless of how the user has the
// gateway proxied. The backend completes the OpenClaw handshake server-
// side (see backend/src/routes/media.js).

import { getApiToken } from '../hooks/useApi.js';
import { load } from '../utils/storage.js';

const BACKEND_BASE = import.meta.env.VITE_MC_API ?? '/api/v1';

function gatewayConfig() {
  return {
    apiUrl: load('oc-apiUrl', ''),   // OpenClaw gateway URL
    token:  load('oc-token',  ''),   // OpenClaw token
  };
}

/**
 * Build the proxy URL for a given media source. Synchronous — the actual
 * HTTP call (and ticket minting) happens server-side when the <img> loads.
 * Returns null when we don't have enough config to attempt the fetch.
 */
export function mediaProxyUrl(source) {
  if (typeof source !== 'string' || !source) return null;
  const { apiUrl, token } = gatewayConfig();
  const jwt = getApiToken();
  if (!apiUrl || !jwt) return null;
  const params = new URLSearchParams({
    source,
    gw:    apiUrl,
    gt:    token,
    token: jwt,
  });
  return `${BACKEND_BASE}/media/proxy?${params.toString()}`;
}

/**
 * Probe the backend for availability before rendering. Returns
 * `{ url }` on success, `null` if the gateway reports the file as
 * unavailable. Used by ImageThumb to decide between rendering the image
 * vs the "Unavailable / File not found" chip.
 *
 * The proxy URL is the SAME as what the <img> will load, so a successful
 * HEAD here means the <img> will succeed too.
 */
export async function resolveMediaUrl(source) {
  const url = mediaProxyUrl(source);
  if (!url) return null;
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    if (!resp.ok) return null;
    return { url, mimeType: resp.headers.get('content-type'), sizeBytes: Number(resp.headers.get('content-length')) || null };
  } catch {
    return null;
  }
}
