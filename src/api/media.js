// Resolve OpenClaw media references to a renderable `blob:` URL — the
// same pattern OpenClaw's built-in Control UI uses.
//
// Two delivery paths, tried in order:
//
//   1. DIRECT (preferred — matches built-in OpenClaw UI exactly):
//        GET /__openclaw__/assistant-media?source=<path>&meta=1
//        Authorization: Bearer <gatewayToken>
//        → { available, mediaTicket, ... }
//        GET /__openclaw__/assistant-media?source=<path>&mediaTicket=<ticket>
//        → raw bytes
//      Requires the frontend's reverse proxy (nginx) to forward
//      `/__openclaw__/*` to the OpenClaw gateway, the same way `/ws`
//      is forwarded. Same-origin so no CORS issues; token stays in the
//      Authorization header.
//
//   2. BACKEND PROXY (fallback for setups that haven't added the nginx
//      rule yet): GET /api/v1/media/proxy?source=<path> with
//      Authorization: Bearer <our-jwt>, X-Gateway-Url, X-Gateway-Token
//      headers. Our backend completes the OpenClaw two-step server-side
//      and streams the bytes back.
//
// Either way, the raw bytes get wrapped via URL.createObjectURL → the
// final `blob:` URL looks just like OpenClaw's `blob:http://…/<uuid>`.

import { getApiToken } from '../hooks/useApi.js';
import { load } from '../utils/storage.js';

const BACKEND_BASE = import.meta.env.VITE_MC_API ?? '/api/v1';
const GW_MEDIA_PATH = '/__openclaw__/assistant-media';

// source → { url, promise } — `promise` is in-flight, `url` is resolved.
const cache = new Map();

function gatewayConfig() {
  const raw = load('oc-apiUrl', '');
  let apiUrl = raw;
  try {
    if (raw && typeof location !== 'undefined') {
      apiUrl = new URL(raw, location.origin).toString();
    }
  } catch { /* leave raw */ }
  return { apiUrl, token: load('oc-token', '') };
}

// ── Path 1: direct browser → gateway (same-origin via nginx) ────────────
async function tryDirectFetch(source, gatewayToken) {
  const metaUrl = `${GW_MEDIA_PATH}?${new URLSearchParams({ source, meta: '1' }).toString()}`;
  let metaResp;
  try {
    metaResp = await fetch(metaUrl, {
      headers: gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {},
      credentials: 'include',
    });
  } catch (e) {
    return { ok: false, reason: `direct meta network: ${e?.message ?? e}` };
  }
  if (!metaResp.ok) return { ok: false, reason: `direct meta ${metaResp.status}` };
  const meta = await metaResp.json().catch(() => null);
  if (!meta?.available || !meta?.mediaTicket) {
    return { ok: false, reason: `direct unavailable (${meta?.code ?? 'no ticket'})` };
  }
  const imgUrl = `${GW_MEDIA_PATH}?${new URLSearchParams({ source, mediaTicket: meta.mediaTicket }).toString()}`;
  const imgResp = await fetch(imgUrl).catch((e) => ({ ok: false, _err: e }));
  if (!imgResp?.ok) return { ok: false, reason: `direct img ${imgResp?.status ?? 'fail'}` };
  return { ok: true, blob: await imgResp.blob() };
}

// ── Path 2: through our backend proxy ───────────────────────────────────
async function tryBackendProxy(source, apiUrl, gatewayToken, jwt) {
  const url = `${BACKEND_BASE}/media/proxy?source=${encodeURIComponent(source)}`;
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        Authorization:     `Bearer ${jwt}`,
        'X-Gateway-Url':   apiUrl,
        'X-Gateway-Token': gatewayToken,
      },
    });
  } catch (e) {
    return { ok: false, reason: `proxy network: ${e?.message ?? e}` };
  }
  if (!resp.ok) {
    let body = ''; try { body = (await resp.text()).slice(0, 200); } catch { /* ignore */ }
    return { ok: false, reason: `proxy ${resp.status} ${body}` };
  }
  return { ok: true, blob: await resp.blob() };
}

/**
 * Fetch the media bytes for `source` and return a `blob:` URL ready to
 * drop into <img src=>. Returns null when no delivery path succeeds.
 */
export async function fetchMediaBlobUrl(source) {
  if (typeof source !== 'string' || !source) return null;

  const hit = cache.get(source);
  if (hit?.url)     return hit.url;
  if (hit?.promise) return hit.promise;

  const { apiUrl, token } = gatewayConfig();
  const jwt = getApiToken();

  const promise = (async () => {
    const reasons = [];
    let result = await tryDirectFetch(source, token);
    if (!result.ok) {
      reasons.push(result.reason);
      if (apiUrl && jwt) {
        result = await tryBackendProxy(source, apiUrl, token, jwt);
        if (!result.ok) reasons.push(result.reason);
      } else {
        reasons.push('proxy skipped (no apiUrl/jwt)');
      }
    }
    if (!result.ok) {
      console.warn('[media] could not resolve', source, '— tried:', reasons);
      cache.delete(source);
      return null;
    }
    const blobUrl = URL.createObjectURL(result.blob);
    cache.set(source, { url: blobUrl });
    return blobUrl;
  })();
  cache.set(source, { promise });
  return promise;
}

/** Free a cached blob URL. */
export function releaseMediaBlobUrl(source) {
  const hit = cache.get(source);
  if (hit?.url) URL.revokeObjectURL(hit.url);
  cache.delete(source);
}
