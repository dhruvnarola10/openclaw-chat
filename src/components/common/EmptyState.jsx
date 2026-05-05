// Standard empty / error state for dashboard pages.

import { AlertTriangle, Inbox } from 'lucide-react';

export default function EmptyState({ icon: Icon = Inbox, title, message, error, onRetry }) {
  return (
    <div className="page-empty">
      <div className="page-empty-icon">
        {error ? <AlertTriangle size={28} /> : <Icon size={28} />}
      </div>
      <h3>{title ?? (error ? 'Something went wrong' : 'No data')}</h3>
      {message && <p>{message}</p>}
      {error && <pre className="page-empty-pre">{error}</pre>}
      {onRetry && <button className="ov-btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}
