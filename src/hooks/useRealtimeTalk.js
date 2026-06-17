// Real-time voice-to-voice — same flow as the OpenClaw built-in dashboard.
//
// Two transports supported (server picks based on its provider config):
//
//   • WebRTC + OpenAI Realtime
//       (transport:"webrtc")
//       Browser does an SDP-over-HTTPS handshake directly with
//       https://api.openai.com/v1/realtime/calls using the ephemeral
//       clientSecret minted by the gateway.
//
//   • Google Live BidiGenerateContent (Gemini)
//       (transport:"provider-websocket", protocol:"google-live-bidi")
//       Browser opens a WebSocket directly to
//       wss://generativelanguage.googleapis.com/...?access_token=<clientSecret>
//       and exchanges JSON frames with PCM16 base64-encoded audio.
//
// Both run entirely in the browser with no audio relay through the gateway.
// The gateway's only job is `talk.client.create` → ephemeral session credentials.
//
// Tool calls arriving on either transport are forwarded to the gateway via
// `talk.client.toolCall` so server-side skills execute.

import { useCallback, useEffect, useRef, useState } from 'react';
import { base64ToBytes, bytesToBase64, decodeMessageData, floatToPcm16, pcm16ToFloat } from '../utils/audio.js';

const GOOGLE_LIVE_HOST = 'generativelanguage.googleapis.com';

export function useRealtimeTalk({ gateway, agentId, getSessionKey }) {
  const [talkActive, setTalkActive]               = useState(false);
  const [state, setState]                         = useState('idle');
  const [userInterim, setUserInterim]             = useState('');
  const [assistantSpeaking, setAssistantSpeaking] = useState('');
  const [error, setError]                         = useState('');
  const [fallback, setFallback]                   = useState(false);
  const [transportInUse, setTransportInUse]       = useState(null);

  // WebRTC refs
  const pcRef        = useRef(null);
  const dcRef        = useRef(null);
  const audioElRef   = useRef(null);

  // WebSocket / Google Live refs
  const wsRef            = useRef(null);
  const inputCtxRef      = useRef(null);
  const outputCtxRef     = useRef(null);
  const inputSrcRef      = useRef(null);
  const inputProcRef     = useRef(null);
  const playheadRef      = useRef(0);
  const audioSourcesRef  = useRef(new Set());

  // Shared
  const streamRef     = useRef(null);
  const sessionKeyRef = useRef(null);
  const transcriptRef = useRef('');

  // We expose `supported: true` whenever the browser is capable in
  // principle (RTCPeerConnection + WebSocket exist). The mic-access check
  // happens at start time, so users on an HTTP non-localhost origin see
  // the button + a clear error instead of it silently disappearing.
  const supported =
    typeof navigator !== 'undefined' &&
    typeof RTCPeerConnection !== 'undefined' &&
    typeof WebSocket !== 'undefined';

  const hasMicAccess = !!navigator?.mediaDevices?.getUserMedia;
  const isSecureContext =
    typeof window !== 'undefined' &&
    (window.isSecureContext === true ||
     ['localhost', '127.0.0.1', '::1'].includes(window.location?.hostname));

  // ── Cleanup ─────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    // WebRTC teardown
    try { dcRef.current?.close(); } catch { /* ignore */ }
    try { pcRef.current?.close(); } catch { /* ignore */ }
    if (audioElRef.current) {
      try { audioElRef.current.pause(); } catch { /* ignore */ }
      audioElRef.current.srcObject = null;
      try { audioElRef.current.remove(); } catch { /* ignore */ }
    }

    // WebSocket teardown
    try { wsRef.current?.close(); } catch { /* ignore */ }
    try { inputProcRef.current?.disconnect(); } catch { /* ignore */ }
    try { inputSrcRef.current?.disconnect(); } catch { /* ignore */ }
    for (const src of audioSourcesRef.current) {
      try { src.stop(); } catch { /* ignore */ }
    }
    audioSourcesRef.current.clear();
    try { inputCtxRef.current?.close(); } catch { /* ignore */ }
    try { outputCtxRef.current?.close(); } catch { /* ignore */ }

    streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });

    pcRef.current        = null;
    dcRef.current        = null;
    audioElRef.current   = null;
    wsRef.current        = null;
    inputCtxRef.current  = null;
    outputCtxRef.current = null;
    inputSrcRef.current  = null;
    inputProcRef.current = null;
    streamRef.current    = null;
    playheadRef.current  = 0;
    transcriptRef.current = '';
  }, []);

  // ── WebRTC (OpenAI) ─────────────────────────────────────────────────────

  const handleOpenAIEvent = useCallback((evt) => {
    if (!evt || typeof evt !== 'object') return;
    switch (evt.type) {
      case 'input_audio_buffer.speech_started':
        setState('listening'); setUserInterim('…'); setAssistantSpeaking('');
        break;
      case 'input_audio_buffer.speech_stopped':
        setState('thinking');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (evt.transcript) setUserInterim(evt.transcript);
        break;
      case 'response.audio_transcript.delta':
        if (evt.delta) {
          transcriptRef.current += evt.delta;
          setAssistantSpeaking(transcriptRef.current);
          setState('speaking');
        }
        break;
      case 'response.audio_transcript.done':
        if (evt.transcript) {
          transcriptRef.current = evt.transcript;
          setAssistantSpeaking(evt.transcript);
        }
        break;
      case 'response.done':
        transcriptRef.current = '';
        setState('listening');
        setTimeout(() => setAssistantSpeaking(''), 800);
        break;
      case 'response.function_call_arguments.done':
        if (gateway?.request && sessionKeyRef.current) {
          let args = {};
          try { args = JSON.parse(evt.arguments ?? '{}'); }
          catch { args = { raw: evt.arguments }; }
          // OpenAI Realtime requires us to send a function_call_output back
          // on the data channel for every function_call. Without it the
          // model stays in "awaiting tool" forever — voice UI gets stuck in
          // "thinking" and stops accepting mic input. Send the gateway's
          // response (or a stub for async tools like image_generate that
          // return immediately with a task id) so the model can move on.
          const callId = evt.call_id;
          const sendFunctionOutput = (output, isError = false) => {
            const dc = dcRef.current;
            if (!dc || dc.readyState !== 'open') return;
            try {
              dc.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type:    'function_call_output',
                  call_id: callId,
                  output:  typeof output === 'string' ? output : JSON.stringify(output ?? (isError ? { error: 'unknown' } : {})),
                },
              }));
              dc.send(JSON.stringify({ type: 'response.create' }));
            } catch (e) { console.warn('[talk] failed to send function_call_output:', e.message); }
          };
          gateway.request('talk.client.toolCall', {
            sessionKey: sessionKeyRef.current,
            callId,
            name:       evt.name,
            args,
          })
            .then((result) => sendFunctionOutput(result))
            .catch((e) => {
              console.warn('[talk] tool relay failed:', e.message);
              sendFunctionOutput({ error: e.message ?? 'tool relay failed' }, true);
            });
        }
        break;
      case 'error':
        setError(evt.error?.message ?? evt.message ?? 'Realtime error');
        break;
    }
  }, [gateway]);

  const startWebRtc = useCallback(async (session) => {
    // STUN servers are mandatory for any browser behind NAT (i.e. every
    // phone, every laptop on home/office WiFi, every cellular client). The
    // default `new RTCPeerConnection()` only gathers host candidates —
    // private IPs the OpenAI Realtime edge can't possibly reach.
    //
    // Symptom of missing STUN: the SDP-over-HTTPS handshake succeeds, the
    // data channel opens (so the UI flips to "listening"), but the RTP
    // audio path never reaches connected → user hears silence and the model
    // never receives mic audio.
    //
    // ── ICE servers ──────────────────────────────────────────────────────
    // STUN gets us through normal NAT. TURN is required for symmetric NAT
    // (most cellular, some corporate WiFi, double-NAT setups). Without it,
    // mobile users on cellular usually see `iceConnectionState=failed`.
    //
    // Sources, merged in priority order:
    //   1. App-level env vars (single TURN URL or comma-separated list)
    //      VITE_TURN_URL       — turn:turn.example.com:3478?transport=udp
    //      VITE_TURN_USERNAME  — credentials issued by the TURN provider
    //      VITE_TURN_PASSWORD
    //   2. Public STUN servers (free).
    //   3. ICE servers the OpenClaw gateway minted in talk.client.create —
    //      if your gateway is configured with TURN credentials they end up
    //      here automatically.
    const envTurnUrls = (import.meta.env.VITE_TURN_URL ?? '').trim();
    const envTurnUser = (import.meta.env.VITE_TURN_USERNAME ?? '').trim();
    const envTurnPass = (import.meta.env.VITE_TURN_PASSWORD ?? '').trim();
    const iceServers = [];
    if (envTurnUrls) {
      iceServers.push({
        urls: envTurnUrls.split(',').map((u) => u.trim()).filter(Boolean),
        ...(envTurnUser ? { username: envTurnUser } : {}),
        ...(envTurnPass ? { credential: envTurnPass } : {}),
      });
    }
    iceServers.push(
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun.l.google.com:5349'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
    );
    if (Array.isArray(session.iceServers)) iceServers.push(...session.iceServers);
    console.log('[talk:webrtc] iceServers:', iceServers.map((s) => s.urls));

    const pc = new RTCPeerConnection({
      iceServers,
      // Force iceTransportPolicy=relay only when we have TURN AND the
      // gateway hints `forceRelay:true`. Otherwise let the browser pick the
      // fastest path (host → srflx → relay).
      iceTransportPolicy: session.forceRelay && envTurnUrls ? 'relay' : 'all',
    });
    pcRef.current = pc;

    // Re-use the <audio> element start() created in the user-gesture chain.
    // If for some reason it wasn't created, fall back to making one here
    // (desktop path, where autoplay isn't a problem).
    let audioEl = audioElRef.current;
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.setAttribute('playsinline', '');
      audioEl.setAttribute('webkit-playsinline', '');
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;
    }

    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
      // Explicit play() so the user-gesture chain (button click → start →
      // ontrack) keeps the autoplay policy happy on iOS. Errors here mean
      // the browser ignored autoplay anyway — log so we can surface it.
      const p = audioEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err) => console.warn('[talk:webrtc] audio play() rejected:', err?.message ?? err));
      }
    };

    // Watch the ICE / connection state so we can SURFACE the failure
    // instead of staying silently in "listening" forever. Most NAT-induced
    // failures show up here as `iceConnectionState === 'failed'`.
    pc.oniceconnectionstatechange = () => {
      console.log('[talk:webrtc] iceConnectionState =', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        setError('Voice connection failed (NAT/firewall blocked the audio path). Try a different network or VPN.');
        setState('idle');
      }
    };
    pc.onconnectionstatechange = () => {
      console.log('[talk:webrtc] connectionState =', pc.connectionState);
      if (pc.connectionState === 'failed') {
        setError('Voice connection failed. If you keep seeing this on mobile or restricted networks, the gateway needs to supply TURN servers.');
        setState('idle');
      } else if (pc.connectionState === 'disconnected') {
        setError('Voice connection lost.');
      }
    };

    // Re-use the mic stream start() acquired during the user gesture. Only
    // request a fresh one if there isn't one yet (e.g. talk re-started
    // without the full start() chain, or a desktop path that skipped it).
    const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    for (const track of stream.getTracks()) pc.addTrack(track, stream);

    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.addEventListener('open',    () => setState('listening'));
    dc.addEventListener('message', (e) => {
      try { handleOpenAIEvent(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const headers = {
      ...(session.offerHeaders ?? {}),
      Authorization:  `Bearer ${session.clientSecret}`,
      'Content-Type': 'application/sdp',
    };
    const resp = await fetch(session.offerUrl, { method: 'POST', headers, body: offer.sdp });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => resp.statusText);
      throw new Error(`SDP offer rejected (HTTP ${resp.status}): ${detail.slice(0, 240)}`);
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await resp.text() });
  }, [handleOpenAIEvent]);

  // ── Google Live (Gemini) ────────────────────────────────────────────────

  const buildGoogleLiveUrl = (session) => {
    const url = new URL(session.websocketUrl);
    if (url.protocol !== 'wss:')                throw new Error('Google Live URL must use wss://');
    if (url.hostname.toLowerCase() !== GOOGLE_LIVE_HOST)
      throw new Error('Untrusted Google Live host');
    if (url.username || url.password)           throw new Error('Google Live URL must not include credentials');
    url.search = '';
    url.searchParams.set('access_token', session.clientSecret);
    return url.toString();
  };

  const playPcm16Chunk = useCallback((base64, sampleRate) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    const samples = pcm16ToFloat(base64ToBytes(base64));
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    audioSourcesRef.current.add(source);
    source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime, playheadRef.current);
    source.start(startAt);
    playheadRef.current = startAt + buffer.duration;
  }, []);

  const handleGoogleLiveMessage = useCallback(async (data, session) => {
    let msg;
    try { msg = JSON.parse(await decodeMessageData(data)); }
    catch { return; }

    if (msg.setupComplete) setState('listening');

    const content = msg.serverContent;
    if (content?.interrupted) {
      // Stop currently playing audio (user interrupted).
      for (const src of audioSourcesRef.current) {
        try { src.stop(); } catch { /* ignore */ }
      }
      audioSourcesRef.current.clear();
      playheadRef.current = outputCtxRef.current?.currentTime ?? 0;
    }

    if (content?.inputTranscription?.text) {
      setUserInterim(content.inputTranscription.text);
      if (content.inputTranscription.finished) setState('thinking');
    }
    if (content?.outputTranscription?.text) {
      transcriptRef.current = content.outputTranscription.text;
      setAssistantSpeaking(transcriptRef.current);
      setState('speaking');
    }

    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        playPcm16Chunk(part.inlineData.data, session.audio.outputSampleRateHz);
        setState('speaking');
      } else if (!part.thought && typeof part.text === 'string' && part.text.trim()) {
        transcriptRef.current = (transcriptRef.current || '') + part.text;
        setAssistantSpeaking(transcriptRef.current);
      }
    }

    if (content?.turnComplete) {
      setState('listening');
      setTimeout(() => {
        setAssistantSpeaking('');
        transcriptRef.current = '';
      }, 800);
    }

    // Tool calls — Google Live blocks the conversation until we send a
    // matching `toolResponse` frame back. Relay to the gateway, then echo
    // the result (or an error stub) so the model can continue speaking.
    for (const call of msg.toolCall?.functionCalls ?? []) {
      if (gateway?.request && sessionKeyRef.current && call.id && call.name) {
        const sendToolResponse = (response) => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          try {
            ws.send(JSON.stringify({
              toolResponse: {
                functionResponses: [{
                  id:       call.id,
                  name:     call.name,
                  response: (response && typeof response === 'object') ? response : { result: response ?? null },
                }],
              },
            }));
          } catch (e) { console.warn('[talk] failed to send toolResponse:', e.message); }
        };
        gateway.request('talk.client.toolCall', {
          sessionKey: sessionKeyRef.current,
          callId:     call.id,
          name:       call.name,
          args:       call.args ?? {},
        })
          .then(sendToolResponse)
          .catch((e) => {
            console.warn('[talk] tool relay failed:', e.message);
            sendToolResponse({ error: e.message ?? 'tool relay failed' });
          });
      }
    }
  }, [gateway, playPcm16Chunk]);

  const startGoogleLive = useCallback(async (session) => {
    if (session.protocol !== 'google-live-bidi') {
      throw new Error(`Unsupported provider-websocket protocol: ${session.protocol}`);
    }
    const wsUrl = buildGoogleLiveUrl(session);

    // Re-use the gesture-acquired stream from start() if present.
    const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
    });
    streamRef.current = stream;

    // iOS Safari and several Android browsers ignore the constructor's
    // sampleRate hint AND start every AudioContext in `suspended` state.
    // We need to explicitly resume() after a user gesture (the talk-button
    // click is one — we're inside its async chain). Without this the input
    // ScriptProcessor never produces audio frames and the output buffer
    // queue silently stalls.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    inputCtxRef.current  = new Ctx({ sampleRate: session.audio.inputSampleRateHz  });
    outputCtxRef.current = new Ctx({ sampleRate: session.audio.outputSampleRateHz });
    await Promise.all([
      inputCtxRef.current.resume?.(),
      outputCtxRef.current.resume?.(),
    ].filter(Boolean)).catch((e) => console.warn('[talk:google] audioContext resume failed:', e?.message ?? e));

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    const send = (m) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };

    ws.addEventListener('open', () => {
      // Initial handshake — gateway provides the message; default to {setup:{}} if not.
      send(session.initialMessage ?? { setup: {} });

      // Pump mic. ScriptProcessorNode is deprecated but supported — and it's
      // what OpenClaw uses; AudioWorklet would require a separate worklet
      // file which Vite serves awkwardly.
      const ictx = inputCtxRef.current;
      if (!ictx) return;
      const source = ictx.createMediaStreamSource(stream);
      const proc   = ictx.createScriptProcessor(4096, 1, 1);
      inputSrcRef.current  = source;
      inputProcRef.current = proc;

      proc.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const pcm = floatToPcm16(e.inputBuffer.getChannelData(0));
        send({
          realtimeInput: {
            audio: {
              data: bytesToBase64(pcm),
              mimeType: `audio/pcm;rate=${ictx.sampleRate}`,
            },
          },
        });
      };
      source.connect(proc);
      proc.connect(ictx.destination);
    });

    ws.addEventListener('message', (e) => { void handleGoogleLiveMessage(e.data, session); });
    ws.addEventListener('error',   () => setError('Realtime WebSocket failed'));
    ws.addEventListener('close',   () => {
      if (wsRef.current === ws) {
        // Connection lost mid-talk — surface error if user didn't stop us.
      }
    });
  }, [handleGoogleLiveMessage]);

  // ── Start / Stop ────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (!supported) {
      setError('Your browser does not support real-time voice. Use Chrome/Edge/Safari.');
      return;
    }
    if (!hasMicAccess || !isSecureContext) {
      setError(
        'Microphone access requires HTTPS or localhost.\n' +
        'You\'re on a non-secure origin, so the browser blocks `getUserMedia`.\n' +
        'Fix: serve the app over HTTPS (Cloudflare Tunnel / Caddy / self-signed cert) ' +
        'or open it on localhost.'
      );
      return;
    }
    if (gateway?.status !== 'on') {
      setError('Gateway not connected. Open the Overview page first.');
      return;
    }

    setTalkActive(true);
    setState('connecting');
    setError('');
    setUserInterim('');
    setAssistantSpeaking('');
    setTransportInUse(null);

    // ── iOS Safari mobile-voice fix ────────────────────────────────────
    // Two gesture-sensitive operations need to happen BEFORE any network
    // await — otherwise iOS treats them as "not user-initiated" and either
    // silently denies the mic or refuses to play the model's voice.
    //
    //   1. getUserMedia(): the very first call to ask for mic permission
    //      MUST be inside the user-gesture chain (the talk-button click).
    //      Once permission is granted we can re-use the stream later.
    //   2. <audio> element creation + a synchronous `.play()` on it: locks
    //      in the autoplay allowance so subsequent `pc.ontrack` plays the
    //      model's voice instead of being silently muted on iPhone.
    //
    // Doing these AFTER `await gateway.request(...)` (the old order) broke
    // both — the click had already been consumed by then.

    // Pre-play a silent <audio> element to unlock autoplay on iOS Safari.
    try {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.setAttribute('playsinline', '');
      audioEl.setAttribute('webkit-playsinline', '');
      audioEl.muted = false;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;
      // Fire-and-forget — failure is fine, just means iOS still requires
      // the click to bridge to ontrack which we already handle.
      const p = audioEl.play();
      if (p?.catch) p.catch(() => { /* ignore */ });
    } catch { /* DOM not ready? extremely unlikely */ }

    // Pre-acquire mic stream while the gesture is still live.
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      setError(`Microphone access denied (${err?.name || 'error'}). Check Settings → Safari → Camera & Microphone.`);
      setState('idle');
      setTalkActive(false);
      cleanup();
      return;
    }

    try {
      const sessionKey =
        (typeof getSessionKey === 'function' && getSessionKey()) ||
        `agent:${agentId || 'main'}:web:realtime-${Date.now()}`;
      sessionKeyRef.current = sessionKey;

      // Mint a session. Try `talk.client.create` first; fall back to
      // `talk.session.create` for older builds.
      let session;
      try {
        session = await gateway.request('talk.client.create', { sessionKey });
      } catch (firstErr) {
        try {
          session = await gateway.request('talk.session.create', {
            sessionKey,
            mode:      'realtime',
            transport: 'gateway-relay',
            brain:     'agent-consult',
          });
        } catch {
          if (/unknown method|not[\s_-]?found/i.test(firstErr.message ?? '')) {
            throw new Error('__FALLBACK_WEB_SPEECH__');
          }
          throw firstErr;
        }
      }

      if (!session) throw new Error('Empty session response from gateway');

      setTransportInUse(session.transport);

      if (session.transport === 'webrtc') {
        if (!session.clientSecret || !session.offerUrl) {
          throw new Error('Session missing clientSecret/offerUrl — gateway may not have OpenAI keys.');
        }
        await startWebRtc(session);
      } else if (session.transport === 'provider-websocket') {
        if (!session.clientSecret || !session.websocketUrl) {
          throw new Error('Session missing clientSecret/websocketUrl.');
        }
        await startGoogleLive(session);
      } else if (session.transport === 'gateway-relay' || session.transport === 'managed-room') {
        // Not implemented here — drop to Web Speech.
        throw new Error('__FALLBACK_WEB_SPEECH__');
      } else {
        throw new Error(`Unsupported realtime transport "${session.transport}"`);
      }
    } catch (err) {
      cleanup();
      if (err?.message === '__FALLBACK_WEB_SPEECH__') {
        setState('idle');
        setTalkActive(false);
        setError('');
        setFallback(true);
        return;
      }
      setError(err.message ?? String(err));
      setState('idle');
      setTalkActive(false);
    }
  }, [supported, gateway, agentId, getSessionKey, startWebRtc, startGoogleLive, cleanup]);

  const stop = useCallback(() => {
    cleanup();
    setTalkActive(false);
    setState('idle');
    setUserInterim('');
    setAssistantSpeaking('');
    setTransportInUse(null);
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (talkActive) stop();
    else            start();
  }, [talkActive, start, stop]);

  useEffect(() => () => cleanup(), [cleanup]);

  // Watchdog: if we sit in "thinking" longer than 15s while the call is
  // still active, snap back to "listening" so the mic stops being held by
  // a stalled tool call. A real reply (audio/text) will override this.
  useEffect(() => {
    if (!talkActive || state !== 'thinking') return;
    const t = setTimeout(() => {
      setState((s) => (s === 'thinking' ? 'listening' : s));
    }, 15_000);
    return () => clearTimeout(t);
  }, [talkActive, state]);

  const speak = useCallback(() => { /* no-op for realtime — audio plays automatically */ }, []);

  return {
    supported,
    talkActive,
    state,
    userInterim,
    assistantSpeaking,
    error,
    fallback,
    transportInUse,
    toggle,
    speak,
  };
}
