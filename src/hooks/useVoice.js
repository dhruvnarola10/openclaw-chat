// Voice interface hook.
//
// STT: vosk-browser running fully in-browser via WASM. No cloud dependency,
//      so it works on plain HTTP server IPs (where Chrome blocks the Web
//      Speech API because that one phones home to Google).
// TTS: SpeechSynthesis (browser-native, works everywhere).
//
// State machine:
//   idle → loading → listening → processing → speaking → idle
//
// Notes:
//   • The Vosk model (~40 MB) is downloaded on first use and cached by the
//     browser. Subsequent opens are instant.
//   • Silence detection auto-stops listening after ~1.5 s of quiet.

import { useCallback, useEffect, useRef, useState } from 'react';

// Public CDN-hosted small English model (~40 MB, GitHub Pages, CORS open).
// Override via VITE_VOSK_MODEL_URL if you self-host.
const MODEL_URL =
  import.meta.env?.VITE_VOSK_MODEL_URL ||
  'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';

const SAMPLE_RATE        = 16000;
const SILENCE_RMS        = 0.012;   // below = silence
const SILENCE_HOLD_MS    = 1500;    // ms of quiet before auto-stop
const MIN_SPEECH_MS      = 500;     // ignore stray clicks shorter than this

const SS = typeof window !== 'undefined' ? window.speechSynthesis : null;

const VOICE_PREFS = [
  'Google US English',
  'Google UK English Female',
  'Microsoft Aria Online (Natural)',
  'Microsoft Guy Online (Natural)',
  'Samantha',
];

let cachedVoice = null;
function loadVoices() {
  if (!SS) return;
  const pick = () => {
    const voices = SS.getVoices();
    for (const name of VOICE_PREFS) {
      const v = voices.find((x) => x.name === name);
      if (v) { cachedVoice = v; return; }
    }
    cachedVoice =
      voices.find((v) => v.lang.startsWith('en') && !v.localService) ??
      voices.find((v) => v.lang.startsWith('en')) ??
      voices[0] ?? null;
  };
  pick();
  SS.onvoiceschanged = pick;
}
loadVoices();

function stripMarkdown(md) {
  return (md ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*[-*+>]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Module-level cached model — survives re-mounts so we don't re-download.
// vosk-browser is dynamically imported so its ~6 MB WASM bundle doesn't
// inflate the initial page load.
let modelPromise = null;
function getModel() {
  if (!modelPromise) {
    modelPromise = import('vosk-browser').then((m) => m.createModel(MODEL_URL));
  }
  return modelPromise;
}

export function useVoice({ onTranscript }) {
  const [voiceOpen,  setVoiceOpen]  = useState(false);
  const [voiceState, setVoiceState] = useState('idle');
  const [interim,    setInterim]    = useState('');
  const [level,      setLevel]      = useState(0);
  const [error,      setError]      = useState('');
  const [supported,  setSupported]  = useState(true);
  const [modelReady, setModelReady] = useState(false);

  const stateRef       = useRef('idle');
  const audioCtxRef    = useRef(null);
  const streamRef      = useRef(null);
  const procRef        = useRef(null);
  const sourceRef      = useRef(null);
  const recognizerRef  = useRef(null);
  const finalRef       = useRef('');
  const silenceStart   = useRef(null);
  const speechStart    = useRef(null);
  const keepAliveRef   = useRef(null);

  useEffect(() => { stateRef.current = voiceState; }, [voiceState]);

  useEffect(() => {
    // Microphone is only available in secure contexts (HTTPS, localhost,
    // or pages added via chrome://flags#unsafely-treat-insecure-origin-as-secure).
    if (!navigator.mediaDevices?.getUserMedia || !SS) setSupported(false);
    return () => {
      SS?.cancel();
      clearInterval(keepAliveRef.current);
    };
  }, []);

  // ── TTS ──────────────────────────────────────────────────────────────

  const speak = useCallback((text) => {
    if (!SS) return;
    SS.cancel();
    clearInterval(keepAliveRef.current);

    const clean = stripMarkdown(text);
    if (!clean) return;

    setVoiceState('speaking');
    const utt = new SpeechSynthesisUtterance(clean);
    utt.voice  = cachedVoice;
    utt.rate   = 1.05;
    utt.pitch  = 1.0;
    utt.volume = 1.0;

    // Chrome silently stops synthesis after ~15s — pause/resume to keep alive.
    utt.onstart = () => {
      keepAliveRef.current = setInterval(() => {
        if (SS.speaking) { SS.pause(); SS.resume(); }
      }, 10000);
    };
    const done = () => {
      clearInterval(keepAliveRef.current);
      if (stateRef.current === 'speaking') setVoiceState('idle');
    };
    utt.onend   = done;
    utt.onerror = done;

    SS.speak(utt);
  }, []);

  const stopSpeaking = useCallback(() => {
    SS?.cancel();
    clearInterval(keepAliveRef.current);
    if (stateRef.current === 'speaking') setVoiceState('idle');
  }, []);

  // ── Audio-graph teardown ─────────────────────────────────────────────

  const teardownAudio = useCallback(() => {
    try { procRef.current?.disconnect(); }   catch { /* noop */ }
    try { sourceRef.current?.disconnect(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    procRef.current     = null;
    sourceRef.current   = null;
    streamRef.current   = null;
    audioCtxRef.current = null;
    recognizerRef.current?.remove?.();
    recognizerRef.current = null;
    setLevel(0);
  }, []);

  // ── Listening ────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    teardownAudio();
    const spoken = finalRef.current.trim();
    if (spoken && stateRef.current === 'listening') {
      setVoiceState('processing');
      setInterim('');
      onTranscript(spoken);
    } else if (stateRef.current === 'listening') {
      setVoiceState('idle');
      setInterim('');
    }
  }, [onTranscript, teardownAudio]);

  const startListening = useCallback(async () => {
    setError('');
    finalRef.current = '';
    silenceStart.current = null;
    speechStart.current  = null;

    // 1. Load the Vosk model on first use (cached afterwards)
    let model;
    try {
      if (!modelReady) setVoiceState('loading');
      model = await getModel();
      setModelReady(true);
    } catch (e) {
      setError(`Couldn't load voice model: ${e.message}`);
      setVoiceState('idle');
      return;
    }

    // 2. Mic stream
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount:      1,
          sampleRate:        SAMPLE_RATE,
          echoCancellation:  true,
          noiseSuppression:  true,
        },
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        setError('Microphone access was denied. Allow it in the address bar and try again.');
      } else if (e.name === 'NotFoundError') {
        setError('No microphone detected. Connect one and try again.');
      } else {
        setError(`Microphone error: ${e.message}`);
      }
      setVoiceState('idle');
      return;
    }

    streamRef.current = stream;

    // 3. Build recognizer
    const recognizer = new model.KaldiRecognizer(SAMPLE_RATE);
    recognizer.setWords(false);
    recognizer.on('partialresult', (m) => {
      const partial = m.result.partial ?? '';
      setInterim((finalRef.current + ' ' + partial).trim());
    });
    recognizer.on('result', (m) => {
      const text = m.result.text ?? '';
      if (text) finalRef.current = (finalRef.current + ' ' + text).trim();
      setInterim(finalRef.current);
    });
    recognizerRef.current = recognizer;

    // 4. Audio graph: stream → analyser (for level + silence) → script processor (for vosk)
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // ScriptProcessorNode is deprecated but is the only thing vosk-browser
    // currently consumes. AudioWorklet support upstream is pending.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    procRef.current = proc;

    proc.onaudioprocess = (ev) => {
      if (stateRef.current !== 'listening') return;
      try { recognizer.acceptWaveform(ev.inputBuffer); } catch { /* ignore */ }

      // RMS — drives both the orb level and silence detection
      const data = ev.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 18));

      const now = performance.now();
      if (rms > SILENCE_RMS) {
        if (!speechStart.current) speechStart.current = now;
        silenceStart.current = null;
      } else if (speechStart.current) {
        // We've heard speech; now waiting for sustained silence.
        if (!silenceStart.current) silenceStart.current = now;
        else if (
          now - silenceStart.current > SILENCE_HOLD_MS &&
          now - speechStart.current  > MIN_SPEECH_MS
        ) {
          stopListening();
        }
      }
    };

    source.connect(proc);
    proc.connect(ctx.destination);

    setVoiceState('listening');
  }, [modelReady, stopListening]);

  // ── Modal lifecycle ──────────────────────────────────────────────────

  const openVoice = useCallback(() => {
    setVoiceOpen(true);
    setVoiceState('idle');
    setInterim('');
    setError('');
  }, []);

  const closeVoice = useCallback(() => {
    teardownAudio();
    SS?.cancel();
    clearInterval(keepAliveRef.current);
    setVoiceOpen(false);
    setVoiceState('idle');
    setInterim('');
    setError('');
  }, [teardownAudio]);

  // Pre-warm the model when the modal opens, so the first tap is instant.
  useEffect(() => {
    if (!voiceOpen || modelReady) return;
    let cancelled = false;
    setVoiceState('loading');
    getModel()
      .then(() => { if (!cancelled) { setModelReady(true); setVoiceState('idle'); } })
      .catch((e) => {
        if (cancelled) return;
        setError(`Couldn't load voice model: ${e.message}`);
        setVoiceState('idle');
      });
    return () => { cancelled = true; };
  }, [voiceOpen, modelReady]);

  const onResponseReady = useCallback((text) => {
    if (voiceOpen) speak(text);
  }, [voiceOpen, speak]);

  return {
    supported,
    voiceOpen, openVoice, closeVoice,
    voiceState, interim, level, error,
    modelReady,
    startListening, stopListening,
    speak, stopSpeaking,
    onResponseReady,
  };
}
