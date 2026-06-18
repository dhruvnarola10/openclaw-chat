// Continuous voice-to-voice "Talk Mode" — mirrors the OpenClaw dashboard.
//
// Loop:    listen continuously → final transcript + 1.5 s of silence → send
//          → wait for reply → speak → listen again → …
//
// Web Speech API + speechSynthesis. Requires HTTPS or localhost — Chrome
// blocks SpeechRecognition over plain HTTP non-localhost.
//
// Why `continuous: true`: in non-continuous mode the recogniser auto-aborts
// after ~1 s of silence with `no-speech`, which makes the UI flicker
// ("Listening…" appears for one second and disappears). Continuous mode
// keeps the mic open. We detect end-of-utterance ourselves by waiting for
// 1.5 s with no new transcript activity after at least one final result.

import { useCallback, useEffect, useRef, useState } from 'react';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;
const SS = typeof window !== 'undefined' ? window.speechSynthesis : null;

const SILENCE_HOLD_MS = 1500;   // ms of inactivity after a final result → end-of-turn
const RESTART_DELAY   = 200;    // small gap before re-arming SR

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
      voices.find((v) => v.lang.startsWith('en')) ?? voices[0] ?? null;
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

const SPEECH_ERRORS = {
  network:
    "Speech recognition needs HTTPS or localhost (Chrome routes audio through Google).",
  'not-allowed':
    'Microphone access denied. Allow it in the address bar and try again.',
  'audio-capture':
    'No microphone detected.',
  'service-not-allowed':
    'Speech recognition is blocked on this page.',
};

export function useTalk({ onTranscript }) {
  const [talkActive, setTalkActive]               = useState(false);
  const [state, setState]                         = useState('idle');
  const [userInterim, setUserInterim]             = useState('');
  const [assistantSpeaking, setAssistantSpeaking] = useState('');
  const [error, setError]                         = useState('');
  // On-screen debug log — same overlay as useRealtimeTalk uses, so users
  // can screenshot what happened without remote-inspecting the phone.
  const [debugLog, setDebugLog]                   = useState([]);
  const log = useCallback((line) => {
    const stamp = new Date().toISOString().slice(11, 19);
    setDebugLog((prev) => [...prev.slice(-24), `${stamp} ${line}`]);
    console.log('[webspeech]', line);
  }, []);

  const recRef          = useRef(null);
  const finalRef        = useRef('');     // accumulated final transcript for current turn
  const liveRef         = useRef('');     // current interim text
  const activeRef       = useRef(false);  // are we in talk mode (true while loop runs)
  const sentRef         = useRef(false);  // did we already send this turn?
  const keepAliveRef    = useRef(null);   // Chrome 15s TTS keep-alive
  const restartRef      = useRef(null);   // setTimeout id for delayed restart
  const silenceTimerRef = useRef(null);   // setTimeout id for end-of-turn detection

  const supported = !!(SR && SS);

  useEffect(() => { activeRef.current = talkActive; }, [talkActive]);

  // Schedule end-of-turn check. Each new transcript piece resets it.
  const armSilenceTimer = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (sentRef.current || !activeRef.current) { log('silence: skip (already sent / inactive)'); return; }
      const spoken = finalRef.current.trim() || liveRef.current.trim();
      if (!spoken) { log('silence: no transcript to send'); return; }

      sentRef.current = true;
      setState('thinking');
      setUserInterim('');
      finalRef.current = '';
      liveRef.current  = '';

      log(`silence fired → sending "${spoken.slice(0, 50)}"`);
      try { recRef.current?.stop(); } catch { /* ignore */ }
      onTranscript(spoken);
    }, SILENCE_HOLD_MS);
  }, [onTranscript, log]);

  // ── STT (continuous) ───────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (!SR || !activeRef.current) return;

    // Tear down any prior recogniser before starting a fresh one.
    if (recRef.current) {
      try { recRef.current.abort(); } catch { /* ignore */ }
      recRef.current = null;
    }

    finalRef.current = '';
    liveRef.current  = '';
    sentRef.current  = false;
    setUserInterim('');
    setAssistantSpeaking('');

    const rec = new SR();
    rec.continuous      = true;     // keep listening through pauses
    rec.interimResults  = true;
    rec.lang            = 'en-US';
    rec.maxAlternatives = 1;

    rec.onstart = () => { log('SR onstart → listening'); setState('listening'); };

    rec.onresult = (e) => {
      let live = '';
      // Iterate from resultIndex so we only consume new chunks.
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += (r[0].transcript || '') + ' ';
        else           live            += r[0].transcript || '';
      }
      liveRef.current = live;
      setUserInterim((finalRef.current + ' ' + live).trim());

      // Re-arm the silence timer on every transcript update.
      if (finalRef.current.trim() || live.trim()) {
        armSilenceTimer();
      }
    };

    rec.onerror = (e) => {
      log(`SR onerror: ${e.error}`);
      if (e.error === 'aborted')   return;
      if (e.error === 'no-speech') return;   // continuous mode shouldn't fire this often
      setError(SPEECH_ERRORS[e.error] ?? `Speech error: ${e.error}`);
      activeRef.current = false;
      setTalkActive(false);
      setState('idle');
    };

    // Continuous mode auto-stops after ~60s of silence in Chrome — restart
    // if we're still in talk mode and haven't sent yet.
    rec.onend = () => {
      if (sentRef.current) return;          // we stopped on purpose
      if (!activeRef.current) return;
      restartRef.current = setTimeout(startListening, RESTART_DELAY);
    };

    try {
      rec.start();
      log('SR.start() called');
      recRef.current = rec;
    } catch (err) {
      log(`SR.start() threw: ${err?.message ?? err}`);
      // "InvalidStateError: already started" on rapid toggles — wait then retry.
      restartRef.current = setTimeout(startListening, 250);
    }
  }, [armSilenceTimer, log]);

  // ── TTS — speak the assistant reply, then auto-loop back to listening ──

  const speak = useCallback((text) => {
    log(`speak() called, len=${(text || '').length}, active=${activeRef.current}, hasSS=${!!SS}`);
    if (!activeRef.current) { log('speak: skip (not active)'); return; }
    clearTimeout(silenceTimerRef.current);

    if (!SS || !text) {
      log('speak: no SS or empty text → restart listen');
      restartRef.current = setTimeout(startListening, 100);
      return;
    }
    SS.cancel();
    clearInterval(keepAliveRef.current);

    const cleaned = stripMarkdown(text);
    if (!cleaned) {
      log('speak: cleaned text empty → restart listen');
      restartRef.current = setTimeout(startListening, 100);
      return;
    }

    log(`speak: SS.speak() "${cleaned.slice(0, 50)}"`);
    setState('speaking');
    setAssistantSpeaking(cleaned);

    const utt   = new SpeechSynthesisUtterance(cleaned);
    utt.voice   = cachedVoice;
    utt.rate    = 1.05;
    utt.pitch   = 1.0;
    utt.volume  = 1.0;

    // Chrome silently stops synthesis after ~15s — pause/resume keeps it alive.
    utt.onstart = () => {
      keepAliveRef.current = setInterval(() => {
        if (SS.speaking) { SS.pause(); SS.resume(); }
      }, 10000);
    };

    const done = () => {
      clearInterval(keepAliveRef.current);
      setAssistantSpeaking('');
      if (activeRef.current) {
        // Loop back — small delay so the user can perceive the pause naturally.
        restartRef.current = setTimeout(startListening, 250);
      } else {
        setState('idle');
      }
    };
    utt.onend   = done;
    utt.onerror = done;

    SS.speak(utt);
  }, [startListening]);

  // ── Toggle the loop ────────────────────────────────────────────────

  const toggle = useCallback(() => {
    log(`toggle ua="${(navigator.userAgent || '').slice(0, 60)}..." SR=${!!SR} SS=${!!SS} active=${talkActive}`);
    if (talkActive) {
      activeRef.current = false;
      setTalkActive(false);
      clearTimeout(restartRef.current);
      clearTimeout(silenceTimerRef.current);
      clearInterval(keepAliveRef.current);
      try { recRef.current?.abort(); } catch { /* ignore */ }
      recRef.current = null;
      SS?.cancel();
      setState('idle');
      setUserInterim('');
      setAssistantSpeaking('');
      sentRef.current = false;
      return;
    }

    if (!supported) {
      const reason = !SR ? 'SpeechRecognition API not available' : !SS ? 'speechSynthesis API not available' : 'unknown';
      log(`unsupported: ${reason}`);
      setError(`Voice not supported on this browser: ${reason}. Try Chrome on Android, or Safari on iPhone 14+.`);
      return;
    }

    setError('');
    activeRef.current = true;
    setTalkActive(true);
    setDebugLog([]);
    log('starting listen loop…');
    restartRef.current = setTimeout(startListening, 50);
  }, [talkActive, supported, startListening, log]);

  // Cleanup on unmount.
  useEffect(() => () => {
    activeRef.current = false;
    clearTimeout(restartRef.current);
    clearTimeout(silenceTimerRef.current);
    clearInterval(keepAliveRef.current);
    try { recRef.current?.abort(); } catch { /* ignore */ }
    SS?.cancel();
  }, []);

  return {
    supported,
    talkActive,
    state,
    userInterim,
    assistantSpeaking,
    error,
    toggle,
    speak,
    debugLog,
  };
}
