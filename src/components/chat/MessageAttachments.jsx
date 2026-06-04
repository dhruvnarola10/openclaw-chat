// Renders attachments that ride along with a sent / received message.
//
//   • User-uploaded images       → inline thumbnail (click to open full).
//   • Assistant-returned images  → inline thumbnail from remote URL with
//                                  an onError → "Unavailable / File not
//                                  found" fallback that matches OpenClaw's
//                                  dashboard chip.
//   • Other files                → one-line chip with name + size +
//                                  download link.
//   • Already-unavailable items  → same fallback chip with no download.

import { useEffect, useState } from 'react';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { fileIconChar, formatBytes, isImage, isInlineImage } from '../../utils/files.js';
import { fetchMediaBlobUrl } from '../../api/media.js';

export default function MessageAttachments({ attachments }) {
  if (!attachments?.length) return null;

  // An item is treated as an inline image when its mime says so OR when
  // it carries a mediaSource we haven't resolved yet (we'll know its
  // mime after the meta fetch; for the rendering split we trust the
  // filename's extension via isImage/isInlineImage).
  const renderableImage = (a) =>
    !a.unavailable && (isImage(a) || isInlineImage(a)) && (a.dataUrl || a.url || a.preview || a.mediaSource);
  const images = attachments.filter(renderableImage);
  const others = attachments.filter((a) => !renderableImage(a));

  return (
    <div className="msg-att">
      {images.length > 0 && (
        <div className={`msg-att-images cols-${Math.min(images.length, 3)}`}>
          {images.map((a) => <ImageThumb key={a.id} att={a} />)}
        </div>
      )}
      {others.map((a) => (
        a.unavailable
          ? <UnavailableChip key={a.id} name={a.name} />
          : <FileChip key={a.id} att={a} />
      ))}
    </div>
  );
}

function ImageThumb({ att }) {
  // Direct sources (user upload data URL, agent-provided http URL) render
  // immediately. `mediaSource` references need a fetch through the backend
  // proxy → wrapped as a blob: URL so it goes into the DOM clean and the
  // token never appears in the rendered <img src>.
  const directSrc = att.dataUrl ?? att.url ?? att.preview ?? null;
  const [resolved, setResolved] = useState(directSrc);
  const [broken, setBroken]     = useState(false);
  const loading = !resolved && !broken && !!att.mediaSource;

  useEffect(() => {
    if (resolved || !att.mediaSource) return;
    let alive = true;
    fetchMediaBlobUrl(att.mediaSource)
      .then((u) => {
        if (!alive) return;
        if (u) setResolved(u);
        else   setBroken(true);
      })
      .catch(() => { if (alive) setBroken(true); });
    return () => { alive = false; };
  }, [att.mediaSource, resolved]);

  if (broken) return <UnavailableChip name={att.name} />;
  if (loading) {
    return (
      <div className="msg-att-img-wrap msg-att-img-loading" title={att.name}>
        <Loader2 size={16} className="spin" />
      </div>
    );
  }
  if (!resolved) return <UnavailableChip name={att.name} />;

  return (
    <a
      href={resolved}
      target="_blank"
      rel="noopener noreferrer"
      className="msg-att-img-wrap"
      title={att.size ? `${att.name} · ${formatBytes(att.size)}` : att.name}
    >
      <img src={resolved} alt={att.name} className="msg-att-img" onError={() => setBroken(true)} />
    </a>
  );
}

function FileChip({ att }) {
  return (
    <a
      href={att.dataUrl ?? att.url}
      download={att.name}
      target="_blank"
      rel="noopener noreferrer"
      className="msg-att-file"
    >
      <span className="msg-att-icon">{fileIconChar(att)}</span>
      <span className="msg-att-info">
        <span className="msg-att-name">{att.name}</span>
        {att.size && <span className="msg-att-size">{formatBytes(att.size)}</span>}
      </span>
      <Download size={13} className="msg-att-dl" />
    </a>
  );
}

// Matches OpenClaw's dashboard treatment for an attachment the gateway
// referenced but can't serve: filename on the left, red "Unavailable" pill,
// "File not found" hint on the right.
export function UnavailableChip({ name, message = 'File not found' }) {
  return (
    <div className="msg-att-missing" title={name}>
      <AlertCircle size={13} className="msg-att-missing-icon" />
      <span className="msg-att-missing-name">{name || 'attachment'}</span>
      <span className="msg-att-missing-pill">Unavailable</span>
      <span className="msg-att-missing-msg">{message}</span>
    </div>
  );
}
