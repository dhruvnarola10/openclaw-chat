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

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof RTCPeerConnection !== 'undefined' &&
    typeof WebSocket !== 'undefined';

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
          gateway.request('talk.client.toolCall', {
            sessionKey: sessionKeyRef.current,
            callId:     evt.call_id,
            name:       evt.name,
            args,
          }).catch((e) => console.warn('[talk] tool relay failed:', e.message));
        }
        break;
      case 'error':
        setError(evt.error?.message ?? evt.message ?? 'Realtime error');
        break;
    }
  }, [gateway]);

  const startWebRtc = useCallback(async (session) => {
    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    audioElRef.current = audioEl;

    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setError('WebRTC connection lost.');
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
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

    // Tool calls
    for (const call of msg.toolCall?.functionCalls ?? []) {
      if (gateway?.request && sessionKeyRef.current && call.id && call.name) {
        gateway.request('talk.client.toolCall', {
          sessionKey: sessionKeyRef.current,
          callId:     call.id,
          name:       call.name,
          args:       call.args ?? {},
        }).catch((e) => console.warn('[talk] tool relay failed:', e.message));
      }
    }
  }, [gateway, playPcm16Chunk]);

  const startGoogleLive = useCallback(async (session) => {
    if (session.protocol !== 'google-live-bidi') {
      throw new Error(`Unsupported provider-websocket protocol: ${session.protocol}`);
    }
    const wsUrl = buildGoogleLiveUrl(session);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
    });
    streamRef.current = stream;

    inputCtxRef.current  = new AudioContext({ sampleRate: session.audio.inputSampleRateHz  });
    outputCtxRef.current = new AudioContext({ sampleRate: session.audio.outputSampleRateHz });

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
      setError('Your browser does not support real-time voice. Use Chrome/Edge/Safari over HTTPS.');
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
