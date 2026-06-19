// ElevenLabs voice settings — persisted to localStorage so a user can bring
// their own key/voice/model. Falls back to platform defaults baked in at
// build time (VITE_ELEVENLABS_*). The API key itself is sent to OUR backend
// proxy, never to api.elevenlabs.io directly (see backend/routes/elevenlabs).
//
// get() is called INSIDE speak() on every utterance — not cached at hook
// init — so a settings change takes effect on the next spoken reply with no
// page reload.

const K_KEY   = 'xi-api-key';
const K_VOICE = 'xi-voice-id';
const K_MODEL = 'xi-model-id';

// Platform default: when ENABLED, ElevenLabs voice works out of the box
// using the key held on OUR backend (never shipped to the browser). The
// frontend only carries the non-secret default voice/model ids. A user can
// still paste their OWN key in settings to use their account & voices.
const ENV_ENABLED = String(import.meta.env.VITE_ELEVENLABS_ENABLED ?? '') === 'true';
const ENV_VOICE   = import.meta.env.VITE_ELEVENLABS_VOICE_ID  ?? '';
const ENV_MODEL   = import.meta.env.VITE_ELEVENLABS_MODEL_ID  ?? 'eleven_flash_v2_5';

function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback; }
  catch { return fallback; }
}

export const PLATFORM_ELEVENLABS_ENABLED = ENV_ENABLED;

export const voiceSettings = {
  /** Current effective settings. apiKey is the USER's own (or '' to use the
   *  platform key held server-side). voice/model fall back to env defaults. */
  get() {
    return {
      apiKey:  read(K_KEY,   ''),           // '' → backend uses platform key
      voiceId: read(K_VOICE, ENV_VOICE),
      modelId: read(K_MODEL, ENV_MODEL),
    };
  },

  /** Persist whichever fields are provided. */
  set({ apiKey, voiceId, modelId } = {}) {
    try {
      if (apiKey  !== undefined) localStorage.setItem(K_KEY,   apiKey ?? '');
      if (voiceId !== undefined) localStorage.setItem(K_VOICE, voiceId ?? '');
      if (modelId !== undefined) localStorage.setItem(K_MODEL, modelId ?? '');
    } catch { /* storage disabled — ignore */ }
  },

  clear() {
    try {
      localStorage.removeItem(K_KEY);
      localStorage.removeItem(K_VOICE);
      localStorage.removeItem(K_MODEL);
    } catch { /* ignore */ }
  },

  /** True when ElevenLabs is usable: a voice is chosen AND either the
   *  platform key is enabled or the user supplied their own key. */
  isConfigured() {
    const { apiKey, voiceId } = voiceSettings.get();
    return Boolean(voiceId && (ENV_ENABLED || apiKey));
  },
};
