// Cron page — full CRUD on the gateway's scheduled jobs.
//
// Uses these gateway methods directly via WS:
//   cron.list    — list jobs (with pagination + filters)
//   cron.add     — create a new job
//   cron.update  — patch an existing job
//   cron.remove  — delete a job
//   cron.run     — trigger a job immediately (mode: "force"|"due")
//   cron.runs    — historical run log per job
//
// The schema (CronJobSchema in openclaw) requires:
//   name, schedule (one of: at | every | cron),
//   sessionTarget (main|isolated|current|session:<key>),
//   wakeMode (next-heartbeat|now),
//   payload (systemEvent {text} | agentTurn {message, model?, ...})
// — everything else is optional.

import { useCallback, useMemo, useState } from 'react';
import {
  Clock, MessageSquare, Pencil, Play, Plus, Power, RefreshCw,
  Trash2, History, X,
} from 'lucide-react';
import { useGatewayResource } from '../../hooks/useGatewayResource.js';
import { ago } from '../../utils/format.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function CronView({ gateway, onOpenSession }) {
  const list = useGatewayResource({
    gateway,
    method:     'cron.list',
    params:     { includeDisabled: true, sortBy: 'nextRunAtMs', sortDir: 'asc' },
    intervalMs: 30_000,
  });

  const [busyId,    setBusyId]    = useState(null);
  const [toast,     setToast]     = useState('');
  const [creating,  setCreating]  = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [historyOf, setHistoryOf] = useState(null);

  const jobs = useMemo(() => {
    const raw = list.data?.jobs ?? list.data?.crons ?? list.data?.items
             ?? (Array.isArray(list.data) ? list.data : []);
    return Array.isArray(raw) ? raw : [];
  }, [list.data]);

  const totals = useMemo(() => {
    const total   = jobs.length;
    const active  = jobs.filter((j) => j.enabled !== false).length;
    const failing = jobs.filter((j) => (j.state?.lastRunStatus ?? j.lastStatus) === 'error').length;
    const due     = jobs.filter((j) => {
      const next = j.state?.nextRunAtMs ?? j.nextRunAt;
      return typeof next === 'number' && next < Date.now();
    }).length;
    return { total, active, failing, due };
  }, [jobs]);

  const showError = (e) => setToast(e.message || String(e));

  const callGateway = useCallback(async (method, params) => {
    try { return await gateway.request(method, params); }
    catch (e) { showError(e); throw e; }
  }, [gateway]);

  const toggleEnabled = async (j) => {
    setBusyId(j.id); setToast('');
    try {
      await callGateway('cron.update', { id: j.id, patch: { enabled: !(j.enabled !== false) } });
      list.refresh();
    } finally { setBusyId(null); }
  };

  const runNow = async (j) => {
    setBusyId(j.id); setToast('');
    try {
      await callGateway('cron.run', { id: j.id, mode: 'force' });
      setToast(`Triggered "${j.name}"`);
      list.refresh();
    } finally { setBusyId(null); }
  };

  const remove = async (j) => {
    if (!confirm(`Delete cron job "${j.name}"?`)) return;
    setBusyId(j.id); setToast('');
    try {
      await callGateway('cron.remove', { id: j.id });
      list.refresh();
    } finally { setBusyId(null); }
  };

  return (
    <div className="ov-view">
      <PageHeader
        title="Cron"
        subtitle="Scheduled jobs the gateway runs in the background."
        gatewayStatus={gateway.status}
        refreshing={list.loading}
        onRefresh={list.refresh}
        right={
          <button className="ov-btn ov-btn--primary"
            disabled={gateway.status !== 'on'}
            onClick={() => setCreating(true)}>
            <Plus size={14} /> New cron job
          </button>
        }
      />

      {toast && (
        <div className="page-toast page-toast--error">
          {toast}
          <button className="page-toast-close" onClick={() => setToast('')}>×</button>
        </div>
      )}

      <div className="ov-stat-row">
        <div className="ov-tile">
          <div className="ov-tile-title">TOTAL</div>
          <div className="ov-tile-value">{totals.total}</div>
        </div>
        <div className="ov-tile ov-tile--good">
          <div className="ov-tile-title">ENABLED</div>
          <div className="ov-tile-value">{totals.active}</div>
        </div>
        <div className={`ov-tile${totals.failing ? ' ov-tile--bad' : ''}`}>
          <div className="ov-tile-title">FAILING</div>
          <div className="ov-tile-value">{totals.failing}</div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">DUE NOW</div>
          <div className="ov-tile-value">{totals.due}</div>
        </div>
      </div>

      <section className="ov-card">
        {!jobs.length ? (
          <EmptyState
            icon={Clock}
            title={gateway.status !== 'on' ? 'Gateway offline' : 'No scheduled jobs'}
            message={gateway.status !== 'on'
              ? 'Connect from Overview.'
              : 'Click "+ New cron job" to schedule one.'}
            error={list.error}
            onRetry={list.refresh}
          />
        ) : (
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Schedule</th>
                  <th>Payload</th>
                  <th>Next run</th>
                  <th>Last run</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const enabled = j.enabled !== false;
                  const next    = j.state?.nextRunAtMs ?? j.nextRunAt;
                  const last    = j.state?.lastRunAtMs ?? j.lastRunAt;
                  const lastSt  = j.state?.lastRunStatus ?? j.lastStatus;
                  const chip    = !enabled ? 'paused' : (lastSt === 'error' ? 'bad' : (lastSt === 'ok' ? 'on' : 'warn'));
                  return (
                    <tr key={j.id}>
                      <td>
                        <div className="page-stack">
                          <span className="page-strong">{j.name}</span>
                          {j.description && <span className="page-muted">{j.description}</span>}
                          <code className="page-mono">{j.id}</code>
                        </div>
                      </td>
                      <td><code className="page-mono">{formatSchedule(j.schedule)}</code></td>
                      <td><span className="page-muted">{formatPayload(j.payload)}</span></td>
                      <td>
                        {next
                          ? <span title={new Date(next).toLocaleString()}>{relTime(next)}</span>
                          : <span className="page-muted">—</span>}
                      </td>
                      <td>
                        {last ? <span title={new Date(last).toLocaleString()}>{ago(last)}</span> : <span className="page-muted">never</span>}
                        {j.state?.lastError && <div className="page-muted" style={{ fontSize: 11 }}>{String(j.state.lastError).slice(0, 60)}</div>}
                      </td>
                      <td>
                        <span className={`status-chip status-chip--${chip}`}>
                          {!enabled ? 'disabled' : (lastSt ?? 'pending')}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="row-action" onClick={() => runNow(j)}
                            disabled={busyId === j.id} title="Run now">
                            <Play size={12} />
                          </button>
                          <button className="row-action" onClick={() => toggleEnabled(j)}
                            disabled={busyId === j.id}
                            title={enabled ? 'Disable' : 'Enable'}>
                            <Power size={12} />
                          </button>
                          <button className="row-action" onClick={() => setHistoryOf(j)} title="Run history">
                            <History size={12} />
                          </button>
                          <button className="row-action" onClick={() => setEditing(j)} title="Edit">
                            <Pencil size={12} />
                          </button>
                          <button className="row-action row-action--danger"
                            disabled={busyId === j.id}
                            onClick={() => remove(j)} title="Delete">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <CronModal
          title="New cron job"
          onCancel={() => setCreating(false)}
          onSubmit={async (vals) => {
            await callGateway('cron.add', vals);
            setCreating(false);
            list.refresh();
          }}
        />
      )}
      {editing && (
        <CronModal
          title={`Edit "${editing.name}"`}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSubmit={async (patch) => {
            await callGateway('cron.update', { id: editing.id, patch });
            setEditing(null);
            list.refresh();
          }}
        />
      )}
      {historyOf && (
        <CronHistoryModal
          gateway={gateway}
          job={historyOf}
          onClose={() => setHistoryOf(null)}
          onOpenSession={onOpenSession}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Modal: create / edit a cron job
// ───────────────────────────────────────────────────────────────────────────

const SESSION_TARGETS = ['main', 'isolated', 'current'];
const WAKE_MODES      = ['next-heartbeat', 'now'];

function CronModal({ title, initial, onCancel, onSubmit }) {
  const isEdit = !!initial;

  // Schedule
  const initialSchedule = initial?.schedule ?? { kind: 'cron', expr: '0 * * * *' };
  const [schedKind, setSchedKind] = useState(initialSchedule.kind || 'cron');
  const [cronExpr,  setCronExpr]  = useState(initialSchedule.kind === 'cron' ? (initialSchedule.expr ?? '') : '0 * * * *');
  const [cronTz,    setCronTz]    = useState(initialSchedule.kind === 'cron' ? (initialSchedule.tz ?? '') : '');
  const [everyMs,   setEveryMs]   = useState(initialSchedule.kind === 'every' ? initialSchedule.everyMs : 60_000);
  const [atIso,     setAtIso]     = useState(initialSchedule.kind === 'at' ? initialSchedule.at : isoLocal(Date.now() + 60_000));

  // Payload
  const initialPayload = initial?.payload ?? { kind: 'systemEvent', text: 'wake-up' };
  const [payloadKind, setPayloadKind] = useState(initialPayload.kind || 'systemEvent');
  const [systemText,  setSystemText]  = useState(initialPayload.kind === 'systemEvent' ? (initialPayload.text ?? '') : '');
  const [agentMsg,    setAgentMsg]    = useState(initialPayload.kind === 'agentTurn' ? (initialPayload.message ?? '') : '');
  const [agentModel,  setAgentModel]  = useState(initialPayload.kind === 'agentTurn' ? (initialPayload.model ?? '') : '');
  const [agentTimeout,setAgentTimeout]= useState(initialPayload.kind === 'agentTurn' ? (initialPayload.timeoutSeconds ?? '') : '');

  // Identity / behavior
  const [name,           setName]           = useState(initial?.name ?? '');
  const [description,    setDescription]    = useState(initial?.description ?? '');
  const [enabled,        setEnabled]        = useState(initial ? initial.enabled !== false : true);
  const [deleteAfterRun, setDeleteAfterRun] = useState(!!initial?.deleteAfterRun);
  const [agentId,        setAgentId]        = useState(initial?.agentId ?? '');
  const [sessionTarget,  setSessionTarget]  = useState(initial?.sessionTarget ?? 'main');
  const [wakeMode,       setWakeMode]       = useState(initial?.wakeMode ?? 'next-heartbeat');

  // Delivery
  const initialDelivery = initial?.delivery ?? { mode: 'none' };
  const [deliveryMode, setDeliveryMode] = useState(initialDelivery.mode ?? 'none');
  const [deliveryTo,   setDeliveryTo]   = useState(initialDelivery.to ?? '');

  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const valid = name.trim()
    && (payloadKind !== 'systemEvent' || systemText.trim())
    && (payloadKind !== 'agentTurn'   || agentMsg.trim())
    && (schedKind   !== 'cron'        || cronExpr.trim())
    && (schedKind   !== 'every'       || (Number(everyMs) >= 1))
    && (schedKind   !== 'at'          || atIso);

  const buildSchedule = () => {
    if (schedKind === 'cron') {
      const o = { kind: 'cron', expr: cronExpr.trim() };
      if (cronTz.trim()) o.tz = cronTz.trim();
      return o;
    }
    if (schedKind === 'every') return { kind: 'every', everyMs: Number(everyMs) };
    return { kind: 'at', at: new Date(atIso).toISOString() };
  };

  const buildPayload = () => {
    if (payloadKind === 'systemEvent') return { kind: 'systemEvent', text: systemText.trim() };
    const o = { kind: 'agentTurn', message: agentMsg.trim() };
    if (agentModel.trim()) o.model = agentModel.trim();
    if (String(agentTimeout).trim()) o.timeoutSeconds = Number(agentTimeout);
    return o;
  };

  const buildDelivery = () => {
    if (deliveryMode === 'none')  return { mode: 'none' };
    if (deliveryMode === 'webhook') return { mode: 'webhook', to: deliveryTo.trim() };
    return { mode: 'announce' };
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog dialog--lg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>

        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr('');
          try {
            const payload = {
              name:          name.trim(),
              description:   description.trim() || undefined,
              enabled,
              deleteAfterRun: deleteAfterRun || undefined,
              agentId:       agentId.trim() || undefined,
              schedule:      buildSchedule(),
              sessionTarget,
              wakeMode,
              payload:       buildPayload(),
              delivery:      buildDelivery(),
            };
            // Strip undefined keys before sending
            for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
            await onSubmit(payload);
          } catch (x) { setErr(x.message); }
          finally   { setBusy(false); }
        }}>

          {/* ── BASIC ────────────────────────────────────────────── */}
          <div className="agent-section">
            <div className="agent-section-title">BASIC</div>
            <div className="agent-grid">
              <div className="ov-field">
                <label className="ov-label">Name *</label>
                <input className="ov-input" autoFocus
                  placeholder="e.g. nightly-summary"
                  value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="ov-field">
                <label className="ov-label">Agent ID</label>
                <input className="ov-input"
                  placeholder="(optional) main"
                  value={agentId} onChange={(e) => setAgentId(e.target.value)} />
              </div>
            </div>
            <div className="ov-field wide" style={{ marginTop: 10 }}>
              <label className="ov-label">Description</label>
              <input className="ov-input"
                placeholder="What does this job do?"
                value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="agent-grid" style={{ marginTop: 10 }}>
              <div className="ov-field">
                <label className="ov-label">Session target</label>
                <select className="ov-input" value={sessionTarget}
                  onChange={(e) => setSessionTarget(e.target.value)}>
                  {SESSION_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="ov-field">
                <label className="ov-label">Wake mode</label>
                <select className="ov-input" value={wakeMode}
                  onChange={(e) => setWakeMode(e.target.value)}>
                  {WAKE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="ov-field wide" style={{ marginTop: 10 }}>
              <label className="ov-label">
                <input type="checkbox" checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  style={{ marginRight: 8 }} />
                Enabled
              </label>
            </div>
            <div className="ov-field wide">
              <label className="ov-label">
                <input type="checkbox" checked={deleteAfterRun}
                  onChange={(e) => setDeleteAfterRun(e.target.checked)}
                  style={{ marginRight: 8 }} />
                Delete after first successful run
              </label>
            </div>
          </div>

          {/* ── SCHEDULE ─────────────────────────────────────────── */}
          <div className="agent-section">
            <div className="agent-section-title">SCHEDULE</div>
            <div className="agent-tabs">
              <button type="button"
                className={`agent-tab${schedKind === 'cron' ? ' agent-tab--active' : ''}`}
                onClick={() => setSchedKind('cron')}>Cron expression</button>
              <button type="button"
                className={`agent-tab${schedKind === 'every' ? ' agent-tab--active' : ''}`}
                onClick={() => setSchedKind('every')}>Every…</button>
              <button type="button"
                className={`agent-tab${schedKind === 'at' ? ' agent-tab--active' : ''}`}
                onClick={() => setSchedKind('at')}>One-shot at…</button>
            </div>

            {schedKind === 'cron' && (
              <div className="agent-grid">
                <div className="ov-field">
                  <label className="ov-label">Expression *</label>
                  <input className="ov-input" placeholder="0 9 * * *  (every day at 09:00)"
                    value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} />
                </div>
                <div className="ov-field">
                  <label className="ov-label">Timezone</label>
                  <input className="ov-input" placeholder="(optional) Asia/Kolkata"
                    value={cronTz} onChange={(e) => setCronTz(e.target.value)} />
                </div>
              </div>
            )}
            {schedKind === 'every' && (
              <div className="agent-grid">
                <div className="ov-field">
                  <label className="ov-label">Interval</label>
                  <input className="ov-input" type="number" min={1}
                    value={everyMs} onChange={(e) => setEveryMs(e.target.value)} />
                  <span className="page-muted" style={{ fontSize: 11.5 }}>milliseconds</span>
                </div>
                <div className="ov-field">
                  <label className="ov-label">Quick presets</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <PresetBtn onClick={() => setEveryMs(60_000)}>1m</PresetBtn>
                    <PresetBtn onClick={() => setEveryMs(300_000)}>5m</PresetBtn>
                    <PresetBtn onClick={() => setEveryMs(900_000)}>15m</PresetBtn>
                    <PresetBtn onClick={() => setEveryMs(3_600_000)}>1h</PresetBtn>
                    <PresetBtn onClick={() => setEveryMs(86_400_000)}>1d</PresetBtn>
                  </div>
                </div>
              </div>
            )}
            {schedKind === 'at' && (
              <div className="ov-field wide">
                <label className="ov-label">Run once at *</label>
                <input className="ov-input" type="datetime-local"
                  value={atIso} onChange={(e) => setAtIso(e.target.value)} />
              </div>
            )}
          </div>

          {/* ── PAYLOAD ──────────────────────────────────────────── */}
          <div className="agent-section">
            <div className="agent-section-title">PAYLOAD</div>
            <div className="agent-tabs">
              <button type="button"
                className={`agent-tab${payloadKind === 'systemEvent' ? ' agent-tab--active' : ''}`}
                onClick={() => setPayloadKind('systemEvent')}>System event</button>
              <button type="button"
                className={`agent-tab${payloadKind === 'agentTurn' ? ' agent-tab--active' : ''}`}
                onClick={() => setPayloadKind('agentTurn')}>Agent turn</button>
            </div>
            {payloadKind === 'systemEvent' && (
              <div className="ov-field wide">
                <label className="ov-label">Event text *</label>
                <input className="ov-input" placeholder="wake-up"
                  value={systemText} onChange={(e) => setSystemText(e.target.value)} />
                <span className="page-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                  A literal system event the agent receives — useful for HEARTBEAT-style polling.
                </span>
              </div>
            )}
            {payloadKind === 'agentTurn' && (
              <>
                <div className="ov-field wide">
                  <label className="ov-label">Message to send *</label>
                  <textarea className="ov-input" rows={3}
                    placeholder="Summarize today's open PRs and post the result."
                    value={agentMsg} onChange={(e) => setAgentMsg(e.target.value)} />
                </div>
                <div className="agent-grid" style={{ marginTop: 10 }}>
                  <div className="ov-field">
                    <label className="ov-label">Model</label>
                    <input className="ov-input" placeholder="(optional) claude-opus-4-7"
                      value={agentModel} onChange={(e) => setAgentModel(e.target.value)} />
                  </div>
                  <div className="ov-field">
                    <label className="ov-label">Timeout (s)</label>
                    <input className="ov-input" type="number" min={0}
                      value={agentTimeout} onChange={(e) => setAgentTimeout(e.target.value)} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── DELIVERY ─────────────────────────────────────────── */}
          <div className="agent-section">
            <div className="agent-section-title">DELIVERY</div>
            <div className="agent-grid">
              <div className="ov-field">
                <label className="ov-label">Mode</label>
                <select className="ov-input" value={deliveryMode}
                  onChange={(e) => setDeliveryMode(e.target.value)}>
                  <option value="none">none — don't deliver result</option>
                  <option value="announce">announce — to last channel</option>
                  <option value="webhook">webhook — POST to URL</option>
                </select>
              </div>
              {deliveryMode === 'webhook' && (
                <div className="ov-field">
                  <label className="ov-label">Webhook URL *</label>
                  <input className="ov-input" placeholder="https://…"
                    value={deliveryTo} onChange={(e) => setDeliveryTo(e.target.value)} />
                </div>
              )}
            </div>
          </div>

          {err && <p className="page-toast page-toast--error" style={{ marginTop: 10 }}>{err}</p>}

          <div className="dialog-actions" style={{ marginTop: 16 }}>
            <button type="button" className="dialog-cancel" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="dialog-confirm"
              disabled={busy || !valid}>
              {busy ? 'Saving…' : (isEdit ? 'Save' : 'Create cron job')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PresetBtn({ onClick, children }) {
  return (
    <button type="button" className="ov-btn" onClick={onClick}
      style={{ padding: '4px 10px', fontSize: 12 }}>{children}</button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Modal: run history for one job
// ───────────────────────────────────────────────────────────────────────────

function CronHistoryModal({ gateway, job, onClose, onOpenSession }) {
  // `intervalMs: 10_000` → poll every 10s while the modal is open so new
  // runs appear without manually refreshing. The hook also fetches once
  // on mount, so the user always opens to fresh data. The Refresh button
  // forces an immediate fetch on top of that.
  const runs = useGatewayResource({
    gateway,
    method:     'cron.runs',
    params:     { scope: 'job', id: job.id, limit: 50, sortDir: 'desc' },
    intervalMs: 10_000,
  });
  const items = runs.data?.runs ?? runs.data?.items ?? (Array.isArray(runs.data) ? runs.data : []);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--lg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Runs of "{job.name}"</h3>
            <span className="page-muted" style={{ fontSize: 11.5 }}>
              auto-refresh every 10s · {items.length} run{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="row-action" onClick={runs.refresh} disabled={runs.loading} title="Refresh now">
              <RefreshCw size={13} className={runs.loading ? 'spin' : ''} />
            </button>
            <button className="row-action" onClick={onClose} title="Close"><X size={14} /></button>
          </div>
        </div>

        {runs.loading && !items.length && <p className="page-muted">Loading…</p>}
        {runs.error && <p className="page-toast page-toast--error">{runs.error}</p>}
        {!runs.loading && !items.length && <p className="page-muted">No runs recorded yet. Click "Run now" on the row to trigger one.</p>}
        {!!items.length && (
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Delivery</th>
                  <th>Summary / error</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => {
                  const status = r.status ?? 'unknown';
                  const chip   = status === 'ok' ? 'on' : (status === 'error' ? 'bad' : 'warn');
                  const sk     = r.sessionKey;
                  return (
                    <tr key={r.runId ?? `${r.ts}-${i}`}>
                      <td><span title={new Date(r.ts).toLocaleString()}>{ago(r.ts)}</span></td>
                      <td><span className={`status-chip status-chip--${chip}`}>{status}</span></td>
                      <td>{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                      <td>{r.deliveryStatus ?? '—'}</td>
                      <td className="page-muted" style={{ maxWidth: 380 }}>
                        {r.error
                          ? <span style={{ color: '#f87171' }}>{r.error}</span>
                          : (r.summary ?? '—')}
                      </td>
                      <td>
                        {sk && onOpenSession && (
                          <button className="ov-btn"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            onClick={() => { onOpenSession(sk); onClose(); }}
                            title="Open this run's chat session">
                            <MessageSquare size={11} /> Open in chat
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function formatSchedule(s) {
  if (!s) return '—';
  if (typeof s === 'string') return s;
  if (s.kind === 'cron')  return `${s.expr}${s.tz ? ` (${s.tz})` : ''}`;
  if (s.kind === 'every') {
    const ms = s.everyMs;
    if (ms >= 86_400_000) return `every ${Math.round(ms / 86_400_000)}d`;
    if (ms >= 3_600_000)  return `every ${Math.round(ms / 3_600_000)}h`;
    if (ms >= 60_000)     return `every ${Math.round(ms / 60_000)}m`;
    return `every ${ms}ms`;
  }
  if (s.kind === 'at')    return `at ${new Date(s.at).toLocaleString()}`;
  return JSON.stringify(s);
}

function formatPayload(p) {
  if (!p) return '—';
  if (p.kind === 'systemEvent') return `event: ${p.text}`;
  if (p.kind === 'agentTurn')   return `turn: ${(p.message ?? '').slice(0, 50)}${p.message?.length > 50 ? '…' : ''}`;
  return p.kind ?? '—';
}

function relTime(ms) {
  const diff = ms - Date.now();
  if (diff < 0)            return ago(ms);
  if (diff < 60_000)       return `in ${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000)    return `in ${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000)   return `in ${Math.round(diff / 3_600_000)}h`;
  return new Date(ms).toLocaleString();
}

// "yyyy-MM-ddTHH:mm" in local time, suitable for <input type="datetime-local">.
function isoLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
