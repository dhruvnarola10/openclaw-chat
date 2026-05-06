// Channels page — accounts linked to messaging providers
// (WhatsApp/Telegram/Discord/Signal/iMessage/etc.) from `channels.status`.

import { CheckCircle2, AlertCircle, Plug, XCircle } from 'lucide-react';
import { useGatewayResource } from '../../hooks/useGatewayResource.js';
import { ago } from '../../utils/format.js';
import { channelMeta } from '../../utils/channels.js';
import PageHeader from '../common/PageHeader.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function ChannelsView({ gateway }) {
  const { data, loading, error, refresh } = useGatewayResource({
    gateway,
    method:     'channels.status',
    intervalMs: 30_000,
  });

  const accounts = flattenAccounts(data);

  const total   = accounts.length;
  const linked  = accounts.filter((a) => a.connected === true || a.linked === true).length;
  const errored = accounts.filter((a) => a.lastError).length;

  // Group by provider for cleaner UI.
  const byProvider = new Map();
  for (const a of accounts) {
    const k = a.provider ?? a.channel ?? 'unknown';
    if (!byProvider.has(k)) byProvider.set(k, []);
    byProvider.get(k).push(a);
  }
  const groups = [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="ov-view">
      <PageHeader
        title="Channels"
        subtitle="Messaging surfaces wired into your agent."
        gatewayStatus={gateway.status}
        refreshing={loading}
        onRefresh={refresh}
      />

      <div className="ov-stat-row">
        <div className="ov-tile">
          <div className="ov-tile-title">TOTAL</div>
          <div className="ov-tile-value">{total}</div>
        </div>
        <div className="ov-tile ov-tile--good">
          <div className="ov-tile-title">LINKED</div>
          <div className="ov-tile-value">{linked}</div>
          <div className="ov-tile-hint">connected and ready</div>
        </div>
        <div className={`ov-tile${errored ? ' ov-tile--bad' : ''}`}>
          <div className="ov-tile-title">ERRORS</div>
          <div className="ov-tile-value">{errored}</div>
          <div className="ov-tile-hint">need re-authentication</div>
        </div>
        <div className="ov-tile">
          <div className="ov-tile-title">PROVIDERS</div>
          <div className="ov-tile-value">{groups.length}</div>
        </div>
      </div>

      {!groups.length ? (
        <EmptyState
          icon={Plug}
          title={gateway.status !== 'on' ? 'Gateway offline' : 'No channels'}
          message={gateway.status !== 'on' ? 'Connect from Overview.' : 'Configure channel accounts in OpenClaw to see them here.'}
          error={error}
          onRetry={refresh}
        />
      ) : groups.map(([provider, list]) => {
        const meta = channelMeta(provider);
        return (
          <section key={provider} className="ov-card">
            <div className="ov-card-head ov-card-head--row">
              <div>
                <h2>{meta.label}</h2>
                <p>{list.length} account{list.length === 1 ? '' : 's'}</p>
              </div>
              <span className="ov-badge">{provider}</span>
            </div>

            <ul className="channel-list">
              {list.map((a, i) => {
                const id    = String(a.accountId ?? a.id ?? `acct-${i}`);
                const ok    = a.connected === true || a.linked === true;
                const state = a.lastError ? 'bad' : (ok ? 'good' : 'warn');
                return (
                  <li key={id} className={`channel-row channel-row--${state}`}>
                    <div className="channel-icon">
                      {state === 'good' && <CheckCircle2 size={16} />}
                      {state === 'warn' && <AlertCircle size={16} />}
                      {state === 'bad'  && <XCircle      size={16} />}
                    </div>
                    <div className="channel-body">
                      <div className="channel-row-head">
                        <span className="channel-name">{asText(a.displayName ?? a.label ?? id)}</span>
                        <code className="page-mono">{id}</code>
                      </div>
                      <div className="channel-meta">
                        {a.tokenSource && (
                          <span className="page-pill">token: {asText(a.tokenSource)}</span>
                        )}
                        {a.configured === false && (
                          <span className="page-pill page-pill--warn">not configured</span>
                        )}
                        {a.lastError && (
                          <span className="channel-error">{asText(a.lastError)}</span>
                        )}
                        {a.lastSyncAt && (
                          <span className="channel-time">synced {ago(a.lastSyncAt)}</span>
                        )}
                      </div>
                    </div>
                    <div className="channel-status">
                      <span className={`status-chip status-chip--${ok ? 'on' : 'off'}`}>
                        {ok ? 'connected' : 'offline'}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// Some OpenClaw versions return channelAccounts as an array of records;
// others return an object keyed by provider with arrays of accounts inside.
// Normalise both shapes to a flat array.
function flattenAccounts(data) {
  if (!data) return [];

  // array forms
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.channelAccounts)) return data.channelAccounts;
  if (Array.isArray(data.accounts))        return data.accounts;
  if (Array.isArray(data.items))           return data.items;

  // object-keyed-by-provider forms
  const merged = [];
  const obj = data.channelAccounts ?? data.accounts ?? data.providers ?? data;
  if (obj && typeof obj === 'object') {
    for (const [provider, val] of Object.entries(obj)) {
      if (Array.isArray(val)) {
        for (const a of val) merged.push({ ...a, provider: a.provider ?? provider });
      } else if (val && typeof val === 'object') {
        // single-account-per-provider shape
        merged.push({ ...val, provider: val.provider ?? provider });
      }
    }
  }
  return merged;
}

// Coerce arbitrary server values to renderable strings. Handles the case
// where lastError/tokenSource arrive as { code, message } objects.
function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    return v.message ?? v.text ?? v.label ?? v.code ?? v.kind
        ?? (() => { try { return JSON.stringify(v); } catch { return '[object]'; } })();
  }
  return String(v);
}
