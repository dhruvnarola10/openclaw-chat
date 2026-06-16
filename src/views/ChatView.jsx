// Top-level Chat surface: sidebar + workspace + optional settings drawer.
//
// All chat-specific state (threads, input, slash autocomplete, send/stop, voice)
// lives here. Config + gateway are passed in from App as props.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat }           from '../hooks/useChat.js';
import { useAsyncReplies }   from '../hooks/useAsyncReplies.js';
import { useRealtimeTalk }   from '../hooks/useRealtimeTalk.js';
import { useSlashCommands }  from '../hooks/useSlashCommands.js';
import { useGatewayCommands } from '../hooks/useGatewayCommands.js';
import { useTalk }           from '../hooks/useTalk.js';
import { useVoice }          from '../hooks/useVoice.js';
import ChatHeader            from '../components/chat/ChatHeader.jsx';
import Messages              from '../components/chat/Messages.jsx';
import MessageInput          from '../components/chat/MessageInput.jsx';
import Sidebar               from '../components/sidebar/Sidebar.jsx';
import SettingsPanel         from '../components/settings/SettingsPanel.jsx';
import VoiceModal            from '../components/voice/VoiceModal.jsx';

export default function ChatView({ config, models, threadOps, gateway, pendingJoinKey, onPendingJoinHandled }) {
  const [tab,          setTab]          = useState('threads');
  const [showSettings, setShowSettings] = useState(false);
  const [deletingId,   setDeletingId]   = useState(null);
  const [input,        setInput]        = useState('');
  // Mobile-only: sidebar (threads/sessions) is hidden by default and
  // surfaced via the hamburger button in ChatHeader. On desktop this state
  // is ignored — CSS keeps the sidebar permanently visible at ≥ 720px.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Live slash-command catalog from the gateway (falls back to static).
  const { commands: slashCatalog } = useGatewayCommands({
    gateway,
    agentId: config.agentId,
  });
  const slash = useSlashCommands({ input, commands: slashCatalog });

  // chat must be defined before voice so the onTranscript callback can call chat.send
  const chat = useChat({
    apiUrl:  config.apiUrl,
    token:   config.token,
    agentId: config.agentId,
    model:   config.model,
    stream:  config.stream,
    gateway,
    threadOps,
  });

  // Tracked-ref signal for the async-reply listener: while loading=true,
  // it should defer to useChat for that runId. After the active send
  // finalises, any *new* runId on the same sessionKey is an async wake
  // (image_generate finishing, follow-up task result, etc).
  const isSendingRef = useRef(false);
  isSendingRef.current = chat.loading;

  useAsyncReplies({
    gateway,
    sessionKey: threadOps.activeThread?.sessionKey ?? null,
    threadId:   threadOps.activeId ?? null,
    threadOps,
    isSendingRef,
  });

  // ── Voice ───────────────────────────────────────────────────────────────
  const chatSendRef = useRef(chat.send);
  chatSendRef.current = chat.send;

  const voice = useVoice({
    // Use a ref-forwarded callback so voice never captures a stale `chat.send`.
    onTranscript: useCallback((text) => {
      chatSendRef.current({ text, attachments: [] });
    }, []),
  });

  // ── Talk Mode ───────────────────────────────────────────────────────────
  // Two implementations:
  //   • realtime — WebRTC + OpenAI Realtime via the gateway. Best quality
  //     when the gateway has the `talk.client.create` extension.
  //   • web speech — continuous Web Speech API + browser TTS, routed
  //     through chat.send. Used when the gateway lacks realtime methods.
  // We try realtime first; the realtime hook flips `fallback=true` when
  // it detects the gateway doesn't support those methods, after which we
  // hand the Talk button over to the Web Speech hook.
  const activeThreadRef = useRef(threadOps.activeThread);
  activeThreadRef.current = threadOps.activeThread;

  const realtimeTalk = useRealtimeTalk({
    gateway,
    agentId: config.agentId,
    getSessionKey: () => activeThreadRef.current?.sessionKey ?? null,
  });
  const webSpeechTalk = useTalk({
    onTranscript: useCallback((text) => {
      chatSendRef.current({ text, attachments: [] });
    }, []),
  });

  // Active hook = realtime by default; switch permanently to Web Speech
  // once realtime reports it can't run on this gateway.
  const talk = realtimeTalk.fallback ? webSpeechTalk : realtimeTalk;

  // Watch the last assistant message — when it finishes streaming via the
  // text path, pipe it through the modal voice (vosk) for read-aloud.
  // Realtime talk handles its own audio so we skip it when talk is active.
  const { threads, activeId, activeThread } = threadOps;
  const messages = activeThread?.messages ?? [];
  const lastMsg  = messages[messages.length - 1];
  const prevStreamRef = useRef(false);

  useEffect(() => {
    if (!lastMsg || lastMsg.role !== 'assistant') return;

    const wasStreaming = prevStreamRef.current;
    const nowDone      = !lastMsg.streaming && !lastMsg.waiting && !lastMsg.isError;

    if (wasStreaming && nowDone && lastMsg.content) {
      // Web Speech talk mode: speak the reply through the browser TTS.
      // (Realtime mode handles audio in the WebRTC peer connection itself.)
      if (webSpeechTalk.talkActive) webSpeechTalk.speak(lastMsg.content);
      else if (voice.voiceOpen)     voice.onResponseReady(lastMsg.content);
    }
    prevStreamRef.current = !!(lastMsg.streaming || lastMsg.waiting);
  }, [lastMsg, voice, webSpeechTalk]);

  // ── Gateway helpers ─────────────────────────────────────────────────────

  const refreshActiveHistory = () => {
    if (!activeThread) return;
    gateway.fetchHistory(
      activeThread.sessionKey,
      activeThread.id,
      (msgs) => threadOps.setMessages(activeThread.id, msgs),
    );
  };

  const joinSession = (sessionKey) => {
    const tid = threadOps.ensureThreadForSession(sessionKey);
    setTab('threads');
    gateway.fetchHistory(sessionKey, tid, (msgs) => threadOps.setMessages(tid, msgs));
  };

  // Deep-link from CronView (or anywhere else) — once the gateway is ready,
  // join the requested session and clear the pending key so we don't loop.
  useEffect(() => {
    if (!pendingJoinKey) return;
    if (gateway.status !== 'on') return;
    joinSession(pendingJoinKey);
    onPendingJoinHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJoinKey, gateway.status]);

  // Auto-close the mobile drawer whenever the user picks a thread or
  // creates a new one — better UX than requiring a second tap to dismiss.
  const closeMobileSidebar = () => setMobileSidebarOpen(false);

  return (
    <div className={`app-row${mobileSidebarOpen ? ' app-row--sidebar-open' : ''}`}>
      {mobileSidebarOpen && (
        <div className="sidebar-backdrop" onClick={closeMobileSidebar} />
      )}
      <Sidebar
        tab={tab}
        setTab={setTab}
        threads={threads}
        activeId={activeId}
        activeSessionKey={activeThread?.sessionKey ?? null}
        onSwitchThread={(id) => { threadOps.switchThread(id); closeMobileSidebar(); }}
        onNewThread={() => { threadOps.newThread(); closeMobileSidebar(); }}
        onRequestDelete={setDeletingId}
        wsStatus={gateway.status}
        sessions={gateway.sessions}
        onJoinSession={joinSession}
        onReconnect={gateway.reconnect}
      />

      <div className="workspace">
        <ChatHeader
          thread={activeThread}
          onRename={threadOps.renameThread}
          onRefreshHistory={refreshActiveHistory}
          refreshing={activeThread ? gateway.loadingHistory.has(activeThread.id) : false}
          onToggleSettings={() => setShowSettings((s) => !s)}
          settingsOpen={showSettings}
          onToggleSidebar={() => setMobileSidebarOpen((s) => !s)}
        />

        <Messages
          messages={messages}
          loadingHistory={activeThread ? gateway.loadingHistory.has(activeThread.id) : false}
          onHint={(t) => setInput(t)}
        />

        <MessageInput
          value={input}
          onChange={setInput}
          onSend={chat.send}
          onStop={chat.stop}
          loading={chat.loading}
          slash={slash}
          onOpenVoice={voice.supported ? voice.openVoice : null}
          voiceActive={voice.voiceOpen}
          talk={talk}
        />
      </div>

      {showSettings && (
        <SettingsPanel
          config={config}
          models={models}
          status={{ threadCount: threads.length, messageCount: messages.length }}
          onClose={() => setShowSettings(false)}
          onClearHistory={threadOps.clearAll}
        />
      )}

      {deletingId && (
        <DeleteDialog
          thread={threads.find((t) => t.id === deletingId)}
          gatewayReady={gateway.status === 'on'}
          onCancel={() => setDeletingId(null)}
          onConfirm={async ({ alsoDeleteServer }) => {
            const target = threads.find((t) => t.id === deletingId);
            // Delete locally first so the UI updates immediately.
            threadOps.deleteThread(deletingId);
            setDeletingId(null);
            // Then ask the gateway to drop the server-side session, if requested.
            if (alsoDeleteServer && target?.sessionKey) {
              try {
                await gateway.request('sessions.delete', {
                  key:              target.sessionKey,
                  deleteTranscript: true,
                });
              } catch (e) {
                console.warn('[sessions.delete] failed:', e.message);
              }
            }
          }}
        />
      )}

      {voice.voiceOpen && (
        <VoiceModal
          voiceState={voice.voiceState}
          interim={voice.interim}
          level={voice.level}
          error={voice.error}
          supported={voice.supported}
          onOrbClick={voice.voiceState === 'listening' ? voice.stopListening : voice.startListening}
          onStopSpeaking={voice.stopSpeaking}
          onClose={voice.closeVoice}
        />
      )}
    </div>
  );
}

function DeleteDialog({ thread, gatewayReady, onCancel, onConfirm }) {
  const [alsoDeleteServer, setAlsoDeleteServer] = useState(true);
  const sessionKey = thread?.sessionKey;
  const title = thread?.title || 'this conversation';

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Delete conversation?</h3>
        <p>
          <strong>“{title}”</strong> will be removed from your chat list.
          This can't be undone.
        </p>

        {sessionKey && (
          <label className={`dialog-check${!gatewayReady ? ' dialog-check--disabled' : ''}`}>
            <input
              type="checkbox"
              checked={alsoDeleteServer && gatewayReady}
              disabled={!gatewayReady}
              onChange={(e) => setAlsoDeleteServer(e.target.checked)}
            />
            <span>
              Also delete from the server
              {!gatewayReady && <em> — gateway offline</em>}
            </span>
          </label>
        )}

        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="dialog-confirm"
            onClick={() => onConfirm({ alsoDeleteServer: alsoDeleteServer && gatewayReady })}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
