// ElevenLabs integration — all calls go through our backend proxy
// (/api/v1/elevenlabs/*), which forwards the user's key to ElevenLabs. This
// avoids CORS and keeps the platform key server-side.
//
// Exposes voices + TTS-capable models, a per-voice preview, and a save that
// persists to voiceSettings (localStorage).

import { useCallback, useEffect, useState } from 'react';
import { voiceSettings, PLATFORM_ELEVENLABS_ENABLED } from '../utils/voiceSettings.js';
import { getApiToken } from './useApi.js';

const BASE = import.meta.env.VITE_MC_API ?? '/api/v1';

// Shared <audio> for previews so we don't stack overlapping clips.
let previewAudio = null;

function authHeaders(elevenKey) {
  const h = { Authorization: `Bearer ${getApiToken()}` };
  if (elevenKey) h['X-Eleven-Key'] = elevenKey;
  return h;
}

export function useElevenLabs() {
  const initial = voiceSettings.get();
  const [apiKey,  setApiKey]  = useState(initial.apiKey);
  const [voiceId, setVoiceId] = useState(initial.voiceId);
  const [modelId, setModelId] = useState(initial.modelId);

  const [voices,  setVoices]  = useState([]);
  const [models,  setModels]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [verified, setVerified] = useState(false);

  const fetchVoicesAndModels = useCallback(async (key) => {
    const useKey = key ?? apiKey;
    // Allowed with no key when the platform key is enabled (backend supplies
    // it); otherwise the user must provide their own.
    if (!useKey && !PLATFORM_ELEVENLABS_ENABLED) {
      setError('Enter your ElevenLabs API key first.'); return;
    }
    setLoading(true); setError('');
    try {
      const [vRes, mRes] = await Promise.all([
        fetch(`${BASE}/elevenlabs/voices`, { headers: authHeaders(useKey) }),
        fetch(`${BASE}/elevenlabs/models`, { headers: authHeaders(useKey) }),
      ]);
      if (vRes.status === 401 || mRes.status === 401) throw new Error('Invalid API key (401).');
      if (!vRes.ok) throw new Error(`voices failed (${vRes.status})`);
      if (!mRes.ok) throw new Error(`models failed (${mRes.status})`);
      const vJson = await vRes.json();
      const mJson = await mRes.json();
      const vList = vJson?.voices ?? (Array.isArray(vJson) ? vJson : []);
      const mListRaw = mJson?.models ?? (Array.isArray(mJson) ? mJson : []);
      const mList = mListRaw.filter((m) => m.can_do_text_to_speech === true);
      setVoices(vList);
      setModels(mList);
      setVerified(true);
      // Auto-pick sensible defaults if nothing chosen yet.
      if (!voiceId && vList.length) setVoiceId(vList[0].voice_id);
      if (!modelId && mList.length) {
        const flash = mList.find((m) => /flash/i.test(m.model_id));
        setModelId((flash ?? mList[0]).model_id);
      }
    } catch (e) {
      setVerified(false);
      setError(e.message || 'Failed to reach ElevenLabs.');
    } finally {
      setLoading(false);
    }
  }, [apiKey, voiceId, modelId]);

  // Auto-load on mount if a user key is stored OR the platform key is on.
  useEffect(() => {
    if (initial.apiKey || PLATFORM_ELEVENLABS_ENABLED) fetchVoicesAndModels(initial.apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Preview a voice — prefer the free preview_url, else generate via proxy. */
  const previewVoice = useCallback(async (voice) => {
    try { previewAudio?.pause(); } catch { /* ignore */ }
    if (voice?.preview_url) {
      previewAudio = new Audio(voice.preview_url);
      previewAudio.play().catch(() => {});
      return;
    }
    // Fall back to generating a short clip through our proxy.
    try {
      const resp = await fetch(`${BASE}/elevenlabs/tts`, {
        method: 'POST',
        headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: voice.voice_id, modelId, text: 'Hello, this is a preview of my voice.' }),
      });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      previewAudio = new Audio(url);
      previewAudio.onended = () => URL.revokeObjectURL(url);
      previewAudio.play().catch(() => {});
    } catch { /* ignore preview errors */ }
  }, [apiKey, modelId]);

  // Save to the backend (per-user) AND localStorage so the same account
  // gets the same config on every device (PC + mobile).
  const saveSettings = useCallback(() => {
    voiceSettings.saveToServer({ apiKey, voiceId, modelId });
  }, [apiKey, voiceId, modelId]);

  return {
    apiKey, voiceId, modelId,
    voices, models, loading, error, verified,
    setApiKey, setVoiceId, setModelId,
    fetchVoicesAndModels, previewVoice, saveSettings,
  };
}

/**
 * Speak text through ElevenLabs via the backend proxy. Returns a Promise that
 * resolves when playback finishes (or fails). Used by useTalk / useVoice in
 * place of the browser speechSynthesis. Returns false if not configured.
 */
export async function speakWithElevenLabs(text, { onStart, onEnd } = {}) {
  const { apiKey, voiceId, modelId } = voiceSettings.get();
  if (!apiKey || !voiceId || !text?.trim()) return false;
  try {
    const resp = await fetch(`${BASE}/elevenlabs/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getApiToken()}`,
        'X-Eleven-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ voiceId, modelId, text: text.trim() }),
    });
    if (!resp.ok) { onEnd?.(); return false; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    return await new Promise((resolve) => {
      audio.onplay  = () => onStart?.();
      audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); resolve(true); };
      audio.onerror = () => { URL.revokeObjectURL(url); onEnd?.(); resolve(false); };
      audio.play().catch(() => { URL.revokeObjectURL(url); onEnd?.(); resolve(false); });
    });
  } catch {
    onEnd?.();
    return false;
  }
}
