// Resolve OpenClaw media references to a renderable `blob:` URL — the
// same pattern OpenClaw's built-in Control UI uses.
//
// Flow:
//   1. fetch(`/api/v1/media/proxy?source=<path>`) with auth headers
//        Authorization:    Bearer <our-jwt>
//        X-Gateway-Url:    <openclaw-gateway-url>
//        X-Gateway-Token:  <user's openclaw token>
//   2. backend completes the OpenClaw two-step (meta → ticket → bytes)
//      and streams the raw image back
//   3. wrap the Blob with URL.createObjectURL → `blob:…` URL
//   4. <img src={blobUrl}> renders it directly, no token in the DOM
//
// Resolved blob URLs are cached by source for the lifetime of the page,
// so re-renders never re-fetch the same image.

import { getApiToken } from '../hooks/useApi.js';
import { load } from '../utils/storage.js';

const BACKEND_BASE = import.meta.env.VITE_MC_API ?? '/api/v1';

// source → { url, promise } — `promise` is in-flight, `url` is resolved.
// Dedupes concurrent fetches for the same source.
const cache = new Map();

// Resolve oc-apiUrl to an absolute URL the backend can call. Users who
// configure a full URL (`https://gateway.example.com/v1/responses`) keep
// theirs verbatim; the default relative `/api/responses` becomes
// `${location.origin}/api/responses`, matching what the browser sees.
function gatewayConfig() {
  const raw = load('oc-apiUrl', '');
  let apiUrl = raw;
  try {
    if (raw && typeof location !== 'undefined') {
      apiUrl = new URL(raw, location.origin).toString();
    }
  } catch { /* leave raw — backend will reject if it's truly unparseable */ }
  return {
    apiUrl,
    token: load('oc-token', ''),
  };
}

/**
 * Fetch the media bytes for `source` through our backend proxy and return
 * a `blob:` URL the browser can drop straight into an `<img>` tag. Returns
 * null when the gateway can't serve the file (missing path, auth failure,
 * unavailable, network error, etc).
 */
export async function fetchMediaBlobUrl(source) {
  if (typeof source !== 'string' || !source) return null;

  const hit = cache.get(source);
  if (hit?.url)     return hit.url;
  if (hit?.promise) return hit.promise;

  const { apiUrl, token } = gatewayConfig();
  const jwt = getApiToken();
  if (!apiUrl || !jwt) return null;

  const url    = `${BACKEND_BASE}/media/proxy?source=${encodeURIComponent(source)}`;
  const promise = (async () => {
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization:     `Bearer ${jwt}`,
          'X-Gateway-Url':   apiUrl,
          'X-Gateway-Token': token,
        },
      });
      if (!resp.ok) {
        let body = '';
        try { body = await resp.text(); } catch { /* ignore */ }
        console.warn('[media] proxy failed', { source, status: resp.status, body: body.slice(0, 200), gatewayUrl: apiUrl });
        cache.delete(source);
        return null;
      }
      const blob    = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      cache.set(source, { url: blobUrl });
      return blobUrl;
    } catch (e) {
      console.warn('[media] proxy error', { source, error: e?.message ?? String(e) });
      cache.delete(source);
      return null;
    }
  })();
  cache.set(source, { promise });
  return promise;
}

/** Free a cached blob URL (revokes it so the browser can reclaim memory). */
export function releaseMediaBlobUrl(source) {
  const hit = cache.get(source);
  if (hit?.url) URL.revokeObjectURL(hit.url);
  cache.delete(source);
}
