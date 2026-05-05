// Renders attachments that ride along with a sent / received message.
// Images become inline thumbnails (click to open full); other files
// become a one-line chip with name + size.

import { Download } from 'lucide-react';
import { fileIconChar, formatBytes, isImage } from '../../utils/files.js';

export default function MessageAttachments({ attachments }) {
  if (!attachments?.length) return null;

  const images = attachments.filter(isImage);
  const others = attachments.filter((a) => !isImage(a));

  return (
    <div className="msg-att">
      {images.length > 0 && (
        <div className={`msg-att-images cols-${Math.min(images.length, 3)}`}>
          {images.map((a) => (
            <a
              key={a.id}
              href={a.dataUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="msg-att-img-wrap"
              title={`${a.name} · ${formatBytes(a.size)}`}
            >
              <img src={a.preview ?? a.dataUrl} alt={a.name} className="msg-att-img" />
            </a>
          ))}
        </div>
      )}
      {others.map((a) => (
        <a
          key={a.id}
          href={a.dataUrl}
          download={a.name}
          className="msg-att-file"
        >
          <span className="msg-att-icon">{fileIconChar(a)}</span>
          <span className="msg-att-info">
            <span className="msg-att-name">{a.name}</span>
            <span className="msg-att-size">{formatBytes(a.size)}</span>
          </span>
          <Download size={13} className="msg-att-dl" />
        </a>
      ))}
    </div>
  );
}
