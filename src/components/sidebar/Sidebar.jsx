// Left sidebar — contains a Threads tab and a Sessions tab.
// Both lists are pure renders driven by props.

import { useMemo } from 'react';
import {
  MessageSquare, Plus, Radio, Trash2, Zap,
} from 'lucide-react';
import { ago, groupThreads } from '../../utils/format.js';
import { channelMeta } from '../../utils/channels.js';

export default function Sidebar({
  brand = 'Leonardo AI',
  tab, setTab,
  threads, activeId, onSwitchThread, onNewThread, onRequestDelete,
  wsStatus, sessions, onJoinSession, onReconnect,
  activeSessionKey,
}) {
  const grouped = useMemo(() => groupThreads(threads), [threads]);
  const sessionsByChannel = useMemo(
    () => sessions.reduce((acc, s) => { (acc[s.channel] ??= []).push(s); return acc; }, {}),
    [sessions],
  );

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="brand-icon"><Zap size={15} /></div>
        <span className="brand-text">{brand}</span>
      </div>

      <div className="sb-tabs">
        <button
          className={`sb-tab${tab === 'threads' ? ' active' : ''}`}
          onClick={() => setTab('threads')}
        >
          <MessageSquare size={13} />Threads
        </button>
        <button
          className={`sb-tab${tab === 'sessions' ? ' active' : ''}`}
          onClick={() => setTab('sessions')}
        >
          <Radio size={13} />
          Sessions
          <span className={`ws-dot ws-${wsStatus}`} title={wsStatus} />
        </button>
      </div>

      {tab === 'threads' ? (
        <ThreadsTab
          grouped={grouped}
          activeId={activeId}
          onSwitch={onSwitchThread}
          onNew={onNewThread}
          onDelete={onRequestDelete}
        />
      ) : (
        <SessionsTab
          wsStatus={wsStatus}
          sessions={sessions}
          sessionsByChannel={sessionsByChannel}
          threads={threads}
          activeSessionKey={activeSessionKey}
          onJoin={onJoinSession}
          onReconnect={onReconnect}
        />
      )}
    </aside>
  );
}

// ── Threads tab ─────────────────────────────────────────────────────────

function ThreadsTab({ grouped, activeId, onSwitch, onNew, onDelete }) {
  return (
    <>
      <div className="sb-new" onClick={onNew}>
        <Plus size={15} /><span>New chat</span>
      </div>
      <div className="sb-threads">
        {grouped.length === 0 && <div className="sb-empty">No conversations yet</div>}
        {grouped.map(([label, items]) => (
          <div key={label} className="sb-group">
            <div className="sb-group-label">{label}</div>
            {items.map((t) => (
              <div
                key={t.id}
                className={`sb-item${t.id === activeId ? ' active' : ''}`}
                onClick={() => onSwitch(t.id)}
              >
                <MessageSquare size={13} className="sb-item-icon" />
                <span className="sb-item-title">{t.title || 'New chat'}</span>
                <button
                  className="sb-item-del"
                  onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Sessions tab ────────────────────────────────────────────────────────

function SessionsTab({
  wsStatus, sessions, sessionsByChannel,
  threads, activeSessionKey, onJoin, onReconnect,
}) {
  return (
    <div className="sb-sessions">
      <div className={`ws-status ws-status-${wsStatus}`}>
        <span className={`ws-dot ws-${wsStatus}`} />
        {wsStatus === 'on'         && `Live · ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`}
        {wsStatus === 'connecting' && 'Connecting…'}
        {(wsStatus === 'off' || wsStatus === 'error') && (
          <>
            <span>{wsStatus === 'off' ? 'Disconnected' : 'Error'}</span>
            <button className="ws-retry" onClick={onReconnect}>Retry</button>
          </>
        )}
      </div>

      {sessions.length === 0 && wsStatus === 'on' && (
        <div className="sb-empty">No active sessions</div>
      )}

      {Object.entries(sessionsByChannel).map(([ch, list]) => {
        const meta = channelMeta(ch);
        return (
          <div key={ch} className="sb-group">
            <div className="sb-group-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="ch-abbr" style={{ background: meta.color }}>{meta.abbr}</span>
              {meta.label}
              <span className="sb-count">{list.length}</span>
            </div>
            {list.map((s) => {
              const isLinked = threads.some((t) => t.sessionKey === s.key);
              const isActive = isLinked && activeSessionKey === s.key;
              return (
                <div
                  key={s.key}
                  className={`sb-item${isActive ? ' active' : ''}`}
                  onClick={() => onJoin(s.key)}
                  title={s.key}
                >
                  <span className="ch-dot" style={{ background: meta.color }} />
                  <span className="sb-item-title">{s.peer || s.key}</span>
                  <span className="sb-item-right">
                    {s.kind && s.kind !== 'main' && <span className="kind-badge">{s.kind}</span>}
                    {s.updatedAt && <span className="sess-time">{ago(s.updatedAt)}</span>}
                    {isLinked && <span className="linked-badge">open</span>}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
