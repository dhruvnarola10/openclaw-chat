// Top filter bar for the Usage dashboard. Pure controlled component —
// owns no state of its own.

import { Pin, RefreshCw } from 'lucide-react';
import { compactNumber, formatCost, toIsoDate } from '../../utils/format.js';

const RANGES = [
  { id: 'today', label: 'Today',     days: 0  },
  { id: '7d',    label: '7d',        days: 6  },
  { id: '30d',   label: '30d',       days: 29 },
];

export default function UsageFilters({
  range, from, to, mode, loading,
  onRangeChange, onFromChange, onToChange, onModeChange, onRefresh,
  totals, sessionCount,
}) {
  return (
    <div className="usage-filters">
      <div className="usage-filters-top">
        <h2 className="usage-filters-title">Filters</h2>
        <div className="usage-filters-summary">
          <Stat label="Tokens"   value={compactNumber(totals?.tokens)} />
          <Stat label="Cost"     value={formatCost(totals?.cost)} />
          <Stat label="sessions" value={sessionCount ?? 0} />
          <button className="usage-pin"   title="Pin filters"><Pin size={12} /> Pin</button>
          <button className="usage-export" title="Export">Export ▾</button>
        </div>
      </div>

      <div className="usage-filters-row">
        {RANGES.map((r) => (
          <button
            key={r.id}
            className={`pill-btn${range === r.id ? ' active' : ''}`}
            onClick={() => onRangeChange(r.id, r.days)}
          >
            {r.label}
          </button>
        ))}

        <input
          type="date"
          className="usage-date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
        />
        <span className="usage-to">to</span>
        <input
          type="date"
          className="usage-date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
        />

        <select className="usage-tz">
          <option>Local</option>
          <option>UTC</option>
        </select>

        <div className="usage-toggle">
          <button
            className={`toggle-pill${mode === 'tokens' ? ' active' : ''}`}
            onClick={() => onModeChange('tokens')}
          >
            Tokens
          </button>
          <button
            className={`toggle-pill${mode === 'cost' ? ' active' : ''}`}
            onClick={() => onModeChange('cost')}
          >
            Cost
          </button>
        </div>

        <button className="refresh-pill" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spinning' : ''} />
          Refresh
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <span className="usage-summary-stat">
      <strong>{value}</strong> <span>{label}</span>
    </span>
  );
}

// Helper: convert a "Today/7d/30d" preset to from/to ISO dates.
export function presetToDates(daysBack) {
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysBack);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}
