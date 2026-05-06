// Top-level Chat surface: sidebar + workspace + optional settings drawer.
//
// All chat-specific state (threads, input, slash autocomplete, send/stop, voice)
// lives here. Config + gateway are passed in from App as props.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat }           from '../hooks/useChat.js';
import { useSlashCommands }  from '../hooks/useSlashCommands.js';
import { useVoice }          from '../hooks/useVoice.js';
import ChatHeader            from '../components/chat/ChatHeader.jsx';
import Messages              from '../components/chat/Messages.jsx';
import MessageInput          from '../components/chat/MessageInput.jsx';
import Sidebar               from '../components/sidebar/Sidebar.jsx';
import SettingsPanel         from '../components/settings/SettingsPanel.jsx';
import VoiceModal            from '../components/voice/VoiceModal.jsx';

export default function ChatView({ config, models, threadOps, gateway }) {
  const [tab,          setTab]          = useState('threads');
  const [showSettings, setShowSettings] = useState(false);
  const [deletingId,   setDeletingId]   = useState(null);
  const [input,        setInput]        = useState('');

  const slash = useSlashCommands({ input });

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

  // ── Voice ───────────────────────────────────────────────────────────────
  const chatSendRef = useRef(chat.send);
  chatSendRef.current = chat.send;

  const voice = useVoice({
    // Use a ref-forwarded callback so voice never captures a stale `chat.send`.
    onTranscript: useCallback((text) => {
      chatSendRef.current({ text, attachments: [] });
    }, []),
  });

  // Auto-read-aloud: when the last assistant message finishes streaming while
  // voice mode is open, pipe it through TTS.
  const { threads, activeId, activeThread } = threadOps;
  const messages = activeThread?.messages ?? [];
  const lastMsg  = messages[messages.length - 1];
  const prevStreamRef = useRef(false);

  useEffect(() => {
    if (!voice.voiceOpen) { prevStreamRef.current = false; return; }
    if (!lastMsg || lastMsg.role !== 'assistant') return;

    const wasStreaming = prevStreamRef.current;
    const nowDone      = !lastMsg.streaming && !lastMsg.waiting && !lastMsg.isError;

    if (wasStreaming && nowDone && lastMsg.content) {
      voice.onResponseReady(lastMsg.content);
    }
    prevStreamRef.current = !!(lastMsg.streaming || lastMsg.waiting);
  }, [lastMsg, voice]);

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

  return (
    <div className="app-row">
      <Sidebar
        tab={tab}
        setTab={setTab}
        threads={threads}
        activeId={activeId}
        activeSessionKey={activeThread?.sessionKey ?? null}
        onSwitchThread={threadOps.switchThread}
        onNewThread={() => threadOps.newThread()}
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
          onCancel={() => setDeletingId(null)}
          onConfirm={() => { threadOps.deleteThread(deletingId); setDeletingId(null); }}
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

function DeleteDialog({ onCancel, onConfirm }) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Delete conversation?</h3>
        <p>This will permanently remove the chat history. The server-side session will be unaffected.</p>
        <div className="dialog-actions">
          <button className="dialog-cancel"  onClick={onCancel}>Cancel</button>
          <button className="dialog-confirm" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
