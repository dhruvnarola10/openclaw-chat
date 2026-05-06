// Cron page — table of all scheduled gateway jobs from `cron.list`.

import { Clock } from 'lucide-react';
import { useGatewayResource } from '../../hooks/useGatewayResource.js';
import { ago } from '../../utils/format.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function CronView({ gateway }) {
  const { data, loading, error, refresh } = useGatewayResource({
    gateway,
    method:     'cron.list',
    intervalMs: 30_000,
  });

  const jobs = data?.jobs ?? data?.crons ?? data?.items
            ?? (Array.isArray(data) ? data : []);

  const sorted = [...jobs].sort((a, b) => {
    const an = a.nextRunAt ?? a.nextWakeAt ?? a.next ?? a.runAt ?? Infinity;
    const bn = b.nextRunAt ?? b.nextWakeAt ?? b.next ?? b.runAt ?? Infinity;
    return an - bn;
  });

  return (
    <div className="ov-view">
      <PageHeader
        title="Cron"
        subtitle="Scheduled jobs the gateway runs in the background."
        gatewayStatus={gateway.status}
        refreshing={loading}
        onRefresh={refresh}
      />

      <section className="ov-card">
        {!sorted.length
          ? <EmptyState
              icon={Clock}
              title={gateway.status !== 'on' ? 'Gateway offline' : 'No scheduled jobs'}
              message={gateway.status !== 'on' ? 'Connect from Overview.' : 'Add a cron via the API or skill catalog.'}
              error={error}
              onRetry={refresh}
            />
          : (
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th>Name / ID</th>
                    <th>Schedule</th>
                    <th>Status</th>
                    <th>Next run</th>
                    <th>Last run</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((j) => {
                    const id   = j.id ?? j.name;
                    const next = j.nextRunAt ?? j.nextWakeAt ?? j.next ?? j.runAt;
                    const last = j.lastRunAt ?? j.lastRun ?? j.lastAt;
                    const status = (j.status ?? (j.enabled === false ? 'disabled' : 'active')).toLowerCase();
                    const scheduleStr = formatSchedule(j.schedule ?? j.cron ?? j.spec);
                    return (
                      <tr key={id}>
                        <td>
                          <div className="page-stack">
                            <span className="page-strong">{String(j.name ?? id ?? '—')}</span>
                            {j.name && id && j.name !== id && <code className="page-mono">{String(id)}</code>}
                          </div>
                        </td>
                        <td><code className="page-mono">{scheduleStr}</code></td>
                        <td>
                          <span className={`status-chip status-chip--${status}`}>{status}</span>
                        </td>
                        <td>
                          {next
                            ? <span title={new Date(next).toLocaleString()}>
                                {new Date(next).toLocaleString()}
                              </span>
                            : <span className="page-muted">—</span>}
                        </td>
                        <td>{last ? ago(last) : <span className="page-muted">never</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}

// OpenClaw schedule field can be either a plain cron string or a tagged
// object like { kind: "cron", expr: "0 0 * * *" } / { kind: "interval", ms: 60000 }.
// Normalise to a printable string.
function formatSchedule(s) {
  if (s == null) return '—';
  if (typeof s === 'string') return s;
  if (typeof s === 'object') {
    if (s.expr) return String(s.expr);
    if (s.ms != null) return `every ${s.ms}ms`;
    if (s.seconds != null) return `every ${s.seconds}s`;
    if (s.minutes != null) return `every ${s.minutes}m`;
    if (s.kind) return String(s.kind);
    try { return JSON.stringify(s); } catch { return '[object]'; }
  }
  return String(s);
}
