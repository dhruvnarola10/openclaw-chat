// Shared header used by every dashboard page.

import { RefreshCw } from 'lucide-react';

export default function PageHeader({ title, subtitle, onRefresh, refreshing, gatewayStatus, right }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1 className="page-h1">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      <div className="page-head-actions">
        {right}
        {gatewayStatus && (
          <span className={`ov-status ov-status--${gatewayStatus}`}>
            <span className="ov-dot" /> {gatewayStatus}
          </span>
        )}
        {onRefresh && (
          <button
            className="ov-refresh"
            onClick={onRefresh}
            disabled={refreshing || gatewayStatus !== 'on'}
            title="Refresh"
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            <span>{refreshing ? 'Loading…' : 'Refresh'}</span>
          </button>
        )}
      </div>
    </header>
  );
}
