// Generic card primitive used throughout the Usage view.

export function StatCard({ title, value, hint, accent }) {
  return (
    <div className="ucard">
      <div className="ucard-title">{title}</div>
      <div className={`ucard-value${accent ? ` accent-${accent}` : ''}`}>{value}</div>
      {hint && <div className="ucard-hint">{hint}</div>}
    </div>
  );
}

/**
 * RankCard — a "Top X" list with name + numeric value + secondary text.
 * Each row: `{ id, name, value, sub }`
 */
export function RankCard({ title, rows, valueFormat }) {
  const fmt = valueFormat ?? ((v) => v ?? '—');
  return (
    <div className="ucard ucard-rank">
      <div className="ucard-title">{title}</div>
      {rows.length === 0 && <div className="ucard-empty">No data</div>}
      <ul className="ucard-list">
        {rows.map((r) => (
          <li key={r.id} className="ucard-row">
            <span className="ucard-name" title={r.name}>{r.name}</span>
            <span className="ucard-row-right">
              <span className="ucard-value-sm">{fmt(r.value)}</span>
              {r.sub && <span className="ucard-sub">{r.sub}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
