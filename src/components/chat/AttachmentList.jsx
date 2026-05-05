// Strip of attachment chips shown above the textarea while composing.

import { X } from 'lucide-react';
import { fileIconChar, formatBytes, isImage } from '../../utils/files.js';

export default function AttachmentList({ items, error, onRemove, onClear }) {
  if (!items.length && !error) return null;

  return (
    <div className="att-list">
      {error && (
        <div className="att-error">
          {error}
          <button className="att-error-x" onClick={onClear}><X size={12} /></button>
        </div>
      )}
      {items.map((a) => (
        <Chip key={a.id} att={a} onRemove={() => onRemove(a.id)} />
      ))}
    </div>
  );
}

function Chip({ att, onRemove }) {
  const isImg = isImage(att);
  return (
    <div className={`att-chip${isImg ? ' is-image' : ''}`} title={`${att.name} · ${formatBytes(att.size)}`}>
      {isImg ? (
        <img src={att.preview} alt={att.name} className="att-thumb" />
      ) : (
        <span className="att-icon">{fileIconChar(att)}</span>
      )}
      <span className="att-meta">
        <span className="att-name">{att.name}</span>
        <span className="att-size">{formatBytes(att.size)}</span>
      </span>
      <button className="att-remove" onClick={onRemove} title="Remove">
        <X size={11} />
      </button>
    </div>
  );
}
