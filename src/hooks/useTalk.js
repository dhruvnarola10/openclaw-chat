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

// On mobile, `continuous = true` is buggy (Android re-reports growing finals
// and restarts mid-utterance → duplicated transcripts). `continuous = false`
// makes the recogniser capture ONE clean utterance per session and end —
// no restart-mid-sentence, no overlap, no duplication. We send on that
// session's end. Desktop keeps continuous mode (works fine there).
const IS_MOBILE = typeof navigator !== 'undefined' &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');

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

// Merge two transcript fragments, removing the overlap where the tail of
// `a` repeats the head of `b`. Android restarts the recogniser mid-utterance
// and the new session re-hears the same audio, producing phrase-level
// duplication ("hello can you" + "can you hear me" → "hello can you hear me").
function mergeOverlap(a, b) {
  const A = (a || '').trim();
  const B = (b || '').trim();
  if (!A) return B;
  if (!B) return A;
  const aw = A.split(/\s+/);
  const bw = B.split(/\s+/);
  const max = Math.min(aw.length, bw.length);
  let overlap = 0;
  for (let k = max; k > 0; k--) {
    if (aw.slice(-k).join(' ').toLowerCase() === bw.slice(0, k).join(' ').toLowerCase()) {
      overlap = k;
      break;
    }
  }
  return [...aw, ...bw.slice(overlap)].join(' ');
}

// Collapse immediately-repeated words ("can can you you" → "can you") as a
// final safety net for any duplication the overlap-merge didn't catch.
function dedupeRepeats(text) {
  const words = (text || '').trim().split(/\s+/);
  const out = [];
  for (const w of words) {
    if (out.length === 0 || out[out.length - 1].toLowerCase() !== w.toLowerCase()) {
      out.push(w);
    }
  }
  return out.join(' ');
}

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
  const committedRef    = useRef('');     // final transcript from ENDED sessions this turn
  const finalRef        = useRef('');     // final transcript of the CURRENT recogniser session
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
      // Combine all sources: committed (prior sessions) + current session
      // final + live interim, overlap-merged, then collapse repeats.
      let spoken = mergeOverlap(committedRef.current, finalRef.current);
      spoken = mergeOverlap(spoken, liveRef.current);
      spoken = dedupeRepeats(spoken).trim();
      if (!spoken) { log('silence: no transcript to send'); return; }

      sentRef.current = true;
      setState('thinking');
      setUserInterim('');
      committedRef.current = '';
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

    // IMPORTANT: do NOT reset finalRef/liveRef here. On Android Chrome the
    // recogniser ignores `continuous` and auto-ends every few seconds, so
    // `onend` restarts us mid-turn. Wiping the buffer on each restart
    // destroyed the captured transcript before the silence timer could
    // send it — which is exactly why voice "listened but never answered"
    // on Android. The buffers are cleared after a successful send instead
    // (see armSilenceTimer) and on a genuine fresh turn (see beginTurn()).
    sentRef.current = false;
    setAssistantSpeaking('');
    // Keep showing whatever we've captured so far across the restart.
    const carried = mergeOverlap(committedRef.current, finalRef.current);
    if (carried) setUserInterim(carried);

    const rec = new SR();
    rec.continuous      = !IS_MOBILE;  // false on mobile → clean single-utterance capture
    rec.interimResults  = true;
    rec.lang            = 'en-US';
    rec.maxAlternatives = 1;

    rec.onstart = () => { log('SR onstart → listening'); setState('listening'); };

    rec.onresult = (e) => {
      if (IS_MOBILE) {
        // Android (this device) reports CUMULATIVE results: each entry in
        // e.results is a longer prefix of the same sentence
        // ("can" / "can you" / "can you able"...). Concatenating them gave
        // the duplicated mess. The LAST entry is always the most complete
        // transcript — use it directly, no concatenation, no dedupe needed.
        const last = e.results[e.results.length - 1];
        const t = (last?.[0]?.transcript || '').trim();
        if (last?.isFinal) { finalRef.current = t; liveRef.current = ''; }
        else               { liveRef.current  = t; }
        const shown = (finalRef.current || liveRef.current).trim();
        setUserInterim(shown);
        if (shown) { log(`onresult "${shown.slice(0, 40)}"`); armSilenceTimer(); }
        return;
      }

      // Desktop (continuous=true): accumulate final segments across the
      // session; rebuild fresh each event to avoid the re-report dup.
      let finalText = '';
      let live = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += (r[0].transcript || '') + ' ';
        else           live      += r[0].transcript || '';
      }
      finalRef.current = finalText.trim();
      liveRef.current  = live.trim();
      const merged = mergeOverlap(committedRef.current, finalRef.current);
      const shown  = mergeOverlap(merged, liveRef.current);
      setUserInterim(shown);
      if (shown) log(`onresult "${shown.slice(0, 40)}"`);
      if (finalRef.current || liveRef.current) armSilenceTimer();
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

    // Android Chrome ends the recogniser every few seconds (it ignores
    // `continuous`). We restart to keep listening — BUT if a long silence
    // has already elapsed and we have transcript, the silence timer will
    // send it; we just keep the buffer alive across the restart.
    rec.onend = () => {
      log('SR onend');
      if (sentRef.current) return;          // we already sent this turn
      if (!activeRef.current) return;       // user stopped talk mode

      if (IS_MOBILE) {
        // continuous=false: this session captured one complete utterance.
        // Its end IS the end-of-turn. Send the clean final transcript — no
        // accumulation across sessions, so no duplication to clean up.
        const spoken = (finalRef.current || liveRef.current).trim();
        if (spoken) {
          sentRef.current = true;
          clearTimeout(silenceTimerRef.current);
          setState('thinking');
          setUserInterim('');
          finalRef.current = '';
          liveRef.current  = '';
          log(`onend send (mobile) → "${spoken.slice(0, 50)}"`);
          onTranscript(spoken);
          return;                           // speak()'s done() restarts listening
        }
        // No speech captured (just silence) — keep listening.
        restartRef.current = setTimeout(startListening, RESTART_DELAY);
        return;
      }

      // Desktop (continuous=true): commit this session's text with overlap-
      // merge and restart; the silence timer sends after a pause.
      if (finalRef.current) {
        committedRef.current = mergeOverlap(committedRef.current, finalRef.current);
        finalRef.current = '';
      }
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
        // Fresh turn after the reply — clear buffers (startListening no
        // longer does, so it can preserve transcript across mid-turn
        // Android restarts).
        committedRef.current = '';
        finalRef.current = '';
        liveRef.current  = '';
        sentRef.current  = false;
        setUserInterim('');
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
      committedRef.current = '';
      finalRef.current = '';
      liveRef.current  = '';
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
    // Fresh turn — clear any stale transcript from a previous session.
    committedRef.current = '';
    finalRef.current = '';
    liveRef.current  = '';
    sentRef.current  = false;
    setUserInterim('');
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
