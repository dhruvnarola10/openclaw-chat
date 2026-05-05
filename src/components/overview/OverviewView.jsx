// Overview dashboard — gateway access, snapshot, headline stats,
// recent sessions, and a live event log.

import { useMemo, useState } from 'react';
import { Activity, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useOverview } from '../../hooks/useOverview.js';
import { ago, compactNumber, parseSessionKey } from '../../utils/format.js';
import { channelMeta } from '../../utils/channels.js';

export default function OverviewView({ config, gateway }) {
  const { data, loading, error, refresh, lastAt } = useOverview({ gateway });

  return (
    <div className="ov-view">

      <header className="ov-head">
        <div>
          <h1 className="ov-h1">Overview</h1>
          <p className="ov-sub">Status, entry points, health.</p>
        </div>
        <button
          className="ov-refresh"
          onClick={refresh}
          disabled={loading || gateway.status !== 'on'}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
        </button>
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

      <div className="ov-card-actions">
        <button
          className="ov-btn ov-btn--primary"
          onClick={gateway.reconnect}
          disabled={gateway.status === 'on'}
        >
          {gateway.status === 'on' ? 'Connected' : 'Connect'}
        </button>
        <span className={`ov-status ov-status--${gateway.status}`}>
          <span className="ov-dot" /> {gateway.status}
        </span>
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
