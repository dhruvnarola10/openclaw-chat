// Overview dashboard — gateway access, snapshot, headline stats,
// recent sessions, and a live event log.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Eye, EyeOff, LogOut, Monitor, Moon, Plug, PowerOff,
  RefreshCw, RotateCw, Sun,
} from 'lucide-react';
import { useOverview } from '../../hooks/useOverview.js';
import { ago, compactNumber, parseSessionKey } from '../../utils/format.js';
import { channelMeta } from '../../utils/channels.js';

const THEME_ICON = { dark: Moon, light: Sun, system: Monitor };
const THEME_NEXT = { dark: 'light', light: 'system', system: 'dark' };

export default function OverviewView({ config, gateway, theme = 'dark', onCycleTheme, user, onLogout }) {
  const { data, loading, error, refresh, lastAt } = useOverview({ gateway });
  const ThemeIcon = THEME_ICON[theme] ?? Moon;
  const isOn = gateway.status === 'on';

  // Restart-gateway flow:
  //   1. Click button → fetch `gateway.restart.preflight` → show confirm modal
  //   2. User confirms → call `gateway.restart.request`
  //   3. Watch gateway.status: it'll flip on→off (gateway dies) → on (auto-reconnect)
  //   4. Show toast on successful return-to-on, surface errors otherwise.
  const [restartState, setRestartState]   = useState('idle');   // idle | preflight | confirm | restarting | done | error
  const [preflightData, setPreflightData] = useState(null);
  const [restartError,  setRestartError]  = useState('');
  const wasOnBeforeRestart = useRef(false);

  // Detect the on→off→on cycle that proves the gateway came back up.
  useEffect(() => {
    if (restartState !== 'restarting') return;
    // First time the status drops off, mark that we saw the restart begin.
    if (gateway.status === 'off' || gateway.status === 'error') {
      wasOnBeforeRestart.current = true;
    }
    // Once we've seen the drop AND we're back on, declare success.
    if (wasOnBeforeRestart.current && gateway.status === 'on') {
      setRestartState('done');
      wasOnBeforeRestart.current = false;
      setTimeout(() => setRestartState('idle'), 4000);
    }
  }, [gateway.status, restartState]);

  const openRestartConfirm = async () => {
    if (!isOn) return;
    setRestartError('');
    setRestartState('preflight');
    try {
      const p = await gateway.restartPreflight();
      setPreflightData(p);
      setRestartState('confirm');
    } catch (e) {
      setRestartError(`Preflight failed: ${e.message}`);
      setRestartState('error');
    }
  };

  const confirmRestart = async () => {
    setRestartState('restarting');
    setRestartError('');
    try {
      await gateway.restartGateway('manual UI restart');
      // Don't flip back to idle here — the useEffect above tracks the on/off
      // status cycle and transitions us to 'done' when the gateway returns.
    } catch (e) {
      // If the gateway closed the socket before responding, the request
      // will reject with "Gateway closed". That's actually a *success*
      // signal — the restart did happen, we just lost the ack. Treat the
      // status cycle (off → on) as authoritative.
      if (!/closed|not connected/i.test(e.message)) {
        setRestartError(e.message);
        setRestartState('error');
      }
    }
  };

  return (
    <div className="ov-view">

      {/* Restart confirm + progress dialog. Renders only while the flow is
          active; closing returns to idle. */}
      {(restartState === 'confirm' || restartState === 'restarting' ||
        restartState === 'done'    || restartState === 'error') && (
        <RestartDialog
          state={restartState}
          preflight={preflightData}
          error={restartError}
          gatewayStatus={gateway.status}
          onConfirm={confirmRestart}
          onCancel={() => { setRestartState('idle'); setRestartError(''); }}
        />
      )}

      <header className="ov-head">
        <div>
          <h1 className="ov-h1">Overview</h1>
          <p className="ov-sub">Status, entry points, health.</p>
        </div>
        {/* Header actions: Status pill → Connect/Disconnect → Refresh → Theme.
            The status pill replaces the in-card on/off indicator so the user
            sees connection state immediately, at the top of the page. The
            primary action button toggles between Connect (offline) and
            Disconnect (online). */}
        <div className="ov-head-actions">
          <span className={`ov-status ov-status--${gateway.status}`}>
            <span className="ov-dot" /> {gateway.status}
          </span>
          {isOn ? (
            <button
              className="ov-btn"
              onClick={gateway.disconnect}
              title="Close the WebSocket to the gateway"
            >
              <PowerOff size={14} />
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              className="ov-btn ov-btn--primary"
              onClick={gateway.reconnect}
              title="Connect to gateway"
            >
              <Plug size={14} />
              <span>Connect</span>
            </button>
          )}
          <button
            className="ov-refresh"
            onClick={refresh}
            disabled={loading || !isOn}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          {/* Restart-gateway button — sends SIGUSR1-based restart via RPC.
              Disabled while disconnected (can't preflight) and while a
              restart is already in flight. Status flips on its own once
              the gateway reconnects. */}
          <button
            className="ov-btn"
            onClick={openRestartConfirm}
            disabled={!isOn || restartState === 'preflight' || restartState === 'restarting'}
            title={isOn ? 'Restart the OpenClaw gateway' : 'Connect first'}
          >
            <RotateCw size={14} className={restartState === 'restarting' ? 'spin' : ''} />
            <span>
              {restartState === 'preflight'  ? 'Checking…'
              : restartState === 'restarting' ? 'Restarting…'
              : restartState === 'done'       ? 'Restarted ✓'
              : 'Restart'}
            </span>
          </button>
          {onCycleTheme && (
            <button
              className="ov-btn"
              onClick={onCycleTheme}
              title={`Theme: ${theme} (click for ${THEME_NEXT[theme]})`}
            >
              <ThemeIcon size={14} />
              <span style={{ textTransform: 'capitalize' }}>{theme}</span>
            </button>
          )}
          {onLogout && (
            <button
              className="ov-btn"
              onClick={onLogout}
              title={user?.email ? `Sign out (${user.email})` : 'Sign out'}
            >
              <LogOut size={14} />
              <span>{user?.name || user?.email?.split('@')[0] || 'Sign out'}</span>
            </button>
          )}
        </div>
      </header>

      <GatewayAccessCard config={config} gateway={gateway} />

      <SnapshotCard
        node={data?.node}
        loading={loading && !data}
        connected={gateway.status === 'on'}
      />

      <div className="ov-stat-row">
        <StatTile
          title="COST"
          value={data?.usage?.totalCost != null
            ? `${data.usage.currency || '$'}${data.usage.totalCost.toFixed(2)}`
            : '—'}
          hint={data?.usage
            ? `${compactNumber(data.usage.totalTokens ?? 0)} tokens · ${compactNumber(data.usage.messages ?? 0)} msgs`
            : 'No usage data'}
          state={data?.errors?.usage ? 'unknown' : null}
        />
        <StatTile
          title="SESSIONS"
          value={data?.sessions != null ? compactNumber(data.sessions.length) : '—'}
          hint="Recent session keys tracked by the gateway."
        />
        <StatTile
          title="SKILLS"
          value={data?.skills?.total != null
            ? `${data.skills.active ?? 0}/${data.skills.total}`
            : '—'}
          hint={data?.skills?.active != null ? `${data.skills.active} active` : 'No skills data'}
          state={data?.errors?.skills ? 'unknown' : null}
        />
        <StatTile
          title="CRON"
          value={data?.cron?.count != null ? `${data.cron.count} jobs` : '—'}
          hint={cronHint(data?.cron)}
          state={data?.errors?.cron ? 'unknown' : null}
        />
        <StatTile
          title="CHANNELS"
          value={data?.channels?.total != null
            ? `${data.channels.okCount}/${data.channels.total} linked`
            : '—'}
          hint={channelsHint(data?.channels)}
          state={data?.errors?.channels
            ? 'unknown'
            : data?.channels?.errored ? 'warn' : null}
        />
      </div>

      <RecentSessions sessions={data?.sessions ?? []} models={data?.models ?? []} />

      <EventLog gateway={gateway} />

      <footer className="ov-foot">
        {error && <span className="ov-err">{error}</span>}
        {!error && lastAt && <span>Updated {ago(lastAt)} · auto-refresh every 30 s</span>}
        {!error && !lastAt && gateway.status !== 'on' && (
          <span>Gateway is {gateway.status}. Connect to load data.</span>
        )}
      </footer>
    </div>
  );
}

// ── Gateway Access ────────────────────────────────────────────────────────

function GatewayAccessCard({ config, gateway }) {
  const [showToken, setShowToken] = useState(false);
  const wsUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws`;
  }, []);

  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <h2>Gateway Access</h2>
        <p>Where the dashboard connects and how it authenticates.</p>
      </div>

      <div className="ov-form">
        <Field label="WebSocket URL" wide>
          <input className="ov-input" value={wsUrl} readOnly />
        </Field>

        <Field label="Gateway Token">
          <div className="ov-input-wrap">
            <input
              className="ov-input"
              type={showToken ? 'text' : 'password'}
              value={config.token || ''}
              onChange={(e) => config.setToken(e.target.value)}
            />
            <button
              type="button"
              className="ov-eye"
              onClick={() => setShowToken((v) => !v)}
              title={showToken ? 'Hide' : 'Show'}
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        <Field label="Default Session Key">
          <input
            className="ov-input"
            value={`agent:${config.agentId || 'main'}:web:default`}
            readOnly
          />
        </Field>

        <Field label="Agent ID">
          <input
            className="ov-input"
            value={config.agentId || ''}
            onChange={(e) => config.setAgentId(e.target.value)}
          />
        </Field>
      </div>

    </section>
  );
}

function Field({ label, children, wide }) {
  return (
    <div className={`ov-field${wide ? ' wide' : ''}`}>
      <label className="ov-label">{label}</label>
      {children}
    </div>
  );
}

// ── Snapshot ──────────────────────────────────────────────────────────────

function SnapshotCard({ node, loading, connected }) {
  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <h2>Snapshot</h2>
        <p>Latest gateway handshake information.</p>
      </div>

      <div className="ov-stat-row ov-stat-row--inset">
        <StatTile
          title="STATUS"
          value={!connected ? 'OFF' : (node?.status?.toUpperCase() ?? (loading ? '…' : 'OK'))}
          state={!connected ? 'bad' : (node?.status === 'ok' || !node?.status) ? 'good' : 'warn'}
          big
        />
        <StatTile
          title="UPTIME"
          value={formatDuration(node?.uptimeMs)}
          big
        />
        <StatTile
          title="TICK INTERVAL"
          value={formatDuration(node?.tickIntervalMs, { compact: true })}
          big
        />
        <StatTile
          title="LAST CHANNELS REFRESH"
          value={node?.lastRefreshAt ? ago(node.lastRefreshAt) : 'just now'}
          big
        />
      </div>

      <p className="ov-card-note">
        Use Channels to link WhatsApp, Telegram, Discord, Signal, or iMessage.
      </p>
    </section>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────────

function StatTile({ title, value, hint, state, big }) {
  return (
    <div className={`ov-tile${big ? ' ov-tile--big' : ''} ${state ? 'ov-tile--' + state : ''}`}>
      <div className="ov-tile-title">{title}</div>
      <div className="ov-tile-value">{value}</div>
      {hint && <div className="ov-tile-hint">{hint}</div>}
    </div>
  );
}

// ── Recent Sessions ───────────────────────────────────────────────────────

function RecentSessions({ sessions }) {
  if (!sessions?.length) {
    return (
      <section className="ov-card">
        <div className="ov-card-head"><h2>Recent Sessions</h2></div>
        <div className="ov-empty">No sessions yet.</div>
      </section>
    );
  }
  const rows = [...sessions]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 8);

  return (
    <section className="ov-card">
      <div className="ov-card-head"><h2>Recent Sessions</h2></div>
      <ul className="ov-session-list">
        {rows.map((s) => {
          const parsed = parseSessionKey(s.key ?? '');
          const meta   = channelMeta(parsed.channel);
          return (
            <li key={s.key} className="ov-session-row">
              <div className="ov-session-left">
                <span className="ov-session-channel">{meta.label}</span>
                <span className="ov-session-peer">{s.displayName ?? parsed.peer}</span>
              </div>
              <div className="ov-session-right">
                {s.model && <code className="ov-session-model">{s.model}</code>}
                {s.updatedAt && <span className="ov-session-time">{ago(s.updatedAt)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Live Event Log ────────────────────────────────────────────────────────

function EventLog({ gateway }) {
  const events = gateway.events ?? [];
  return (
    <section className="ov-card">
      <div className="ov-card-head ov-card-head--row">
        <div>
          <h2><Activity size={14} /> Event Log</h2>
          <p>Tail of recent gateway state transitions and server events.</p>
        </div>
        <span className="ov-badge">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="ov-empty">Listening…</div>
      ) : (
        <ul className="ov-event-list">
          {events.map((e, i) => (
            <li key={e.ts + ':' + i} className={`ov-event ov-event--${e.kind}`}>
              <span className="ov-event-time">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="ov-event-kind">{e.kind}</span>
              <span className="ov-event-msg">{e.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function formatDuration(ms, { compact } = {}) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const s = Math.floor(ms / 1000);
  if (compact) {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${(s / 3600).toFixed(1)}h`;
  }
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function cronHint(cron) {
  if (!cron) return 'No cron data';
  if (!cron.count) return 'No scheduled jobs';
  if (!cron.next) return `${cron.count} job${cron.count === 1 ? '' : 's'}`;
  const when = new Date(cron.next._next);
  const diff = when.getTime() - Date.now();
  const inH  = Math.round(diff / 3600000);
  return `Next wake ${when.toLocaleString()}${inH > 0 ? ` (in ${inH}h)` : ''}`;
}

function channelsHint(ch) {
  if (!ch) return 'No channels data';
  if (!ch.total) return 'No channels configured';
  if (ch.errored) {
    const e = ch.firstError;
    const provider = e?.provider ?? e?.accountId ?? 'a channel';
    return `${ch.errored} with errors · ${provider}: ${truncate(e?.lastError, 40)}`;
  }
  return ch.okCount === ch.total
    ? 'All channels connected'
    : `${ch.total - ch.okCount} not yet linked`;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── Restart-gateway confirm + progress dialog ────────────────────────────
//
// Four visual states driven by the parent's `state` prop:
//   confirm    — preflight loaded, ask user to confirm
//   restarting — request sent, waiting for socket cycle (off → on)
//   done       — gateway is back; show success briefly
//   error      — preflight or request failed; show message
//
// We deliberately show the preflight blockers (active tasks, queue size)
// so the user understands what's happening — same info the CLI prints.
function RestartDialog({ state, preflight, error, gatewayStatus, onConfirm, onCancel }) {
  const counts = preflight?.counts;
  const blockers = preflight?.blockers ?? [];
  const safe     = preflight?.safe;

  return (
    <div className="dialog-overlay" onClick={state === 'restarting' ? undefined : onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 420 }}>
        <h3>
          {state === 'confirm'    && 'Restart gateway?'}
          {state === 'restarting' && 'Restarting gateway…'}
          {state === 'done'       && 'Gateway restarted ✓'}
          {state === 'error'      && 'Restart failed'}
        </h3>

        {state === 'confirm' && (
          <>
            <p style={{ marginBottom: 12, fontSize: 13.5, color: 'var(--text-muted)' }}>
              {safe
                ? 'No active work — restart will be immediate.'
                : 'Some work is in progress. The gateway will defer the restart until safe.'}
            </p>

            {counts && (
              <div className="ov-stat-row" style={{ marginBottom: 12 }}>
                <Mini label="Queue"   value={counts.queueSize} />
                <Mini label="Pending" value={counts.pendingReplies} />
                <Mini label="Runs"    value={counts.embeddedRuns} />
                <Mini label="Tasks"   value={counts.activeTasks} />
              </div>
            )}

            {blockers.length > 0 && (
              <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-muted)' }}>
                {blockers.map((b, i) => <li key={i}>{b.message}</li>)}
              </ul>
            )}

            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              The WS will drop briefly; you'll see <code className="page-mono">connecting</code> then
              <code className="page-mono"> on</code> when it's ready again.
            </p>
          </>
        )}

        {state === 'restarting' && (
          <>
            <p style={{ marginBottom: 8, fontSize: 13.5 }}>
              Gateway is restarting. Current socket status:
              <span className={`status-chip status-chip--${gatewayStatus}`} style={{ marginLeft: 8 }}>
                <span className="ov-dot" /> {gatewayStatus}
              </span>
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              Waiting for reconnect — this usually takes a few seconds.
            </p>
          </>
        )}

        {state === 'done' && (
          <p style={{ margin: 0, fontSize: 13.5 }}>
            Gateway is back online and reconnected.
          </p>
        )}

        {state === 'error' && (
          <p className="page-toast page-toast--error" style={{ margin: 0 }}>
            {error || 'Unknown error'}
          </p>
        )}

        <div className="dialog-actions" style={{ marginTop: 18 }}>
          {state === 'confirm' && (
            <>
              <button className="dialog-cancel" onClick={onCancel}>Cancel</button>
              <button className="dialog-confirm" onClick={onConfirm}>
                {safe ? 'Restart now' : 'Schedule restart'}
              </button>
            </>
          )}
          {(state === 'done' || state === 'error') && (
            <button className="dialog-confirm" onClick={onCancel}>Close</button>
          )}
          {state === 'restarting' && (
            <button className="dialog-cancel" disabled>Restarting…</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div className="ov-tile" style={{ padding: '10px 14px' }}>
      <div className="ov-tile-title" style={{ fontSize: 10 }}>{label}</div>
      <div className="ov-tile-value" style={{ fontSize: 18 }}>{value ?? 0}</div>
    </div>
  );
}
