// Manages attachment state for one chat turn. Enforces per-file and
// total size limits; surfaces errors via a transient `error` string.

import { useCallback, useState } from 'react';
import {
  MAX_IMAGE_BYTES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILE_COUNT,
  formatBytes, isImage, isSupported, toAttachments,
} from '../utils/files.js';

export function useAttachments() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  const totalBytes = items.reduce((sum, a) => sum + a.size, 0);

  const add = useCallback(async (fileList) => {
    setError('');
    const incoming = Array.from(fileList ?? []);
    if (!incoming.length) return;

    // MIME type check — only types the OpenClaw API accepts
    const unsupported = incoming.find((f) => !isSupported(f));
    if (unsupported) {
      setError(`${unsupported.name}: unsupported type. Allowed: JPEG/PNG/GIF/WebP/HEIC images and PDF/text/CSV/JSON/HTML/Markdown files.`);
      return;
    }
    // Per-file size check (images 10 MB, files 5 MB)
    const tooLarge = incoming.find((f) =>
      isImage(f) ? f.size > MAX_IMAGE_BYTES : f.size > MAX_FILE_BYTES,
    );
    if (tooLarge) {
      const limit = isImage(tooLarge) ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      setError(`${tooLarge.name} exceeds the ${formatBytes(limit)} limit.`);
      return;
    }
    // Aggregate body cap
    const newTotal = totalBytes + incoming.reduce((s, f) => s + f.size, 0);
    if (newTotal > MAX_TOTAL_BYTES) {
      setError(`Combined attachments exceed ${formatBytes(MAX_TOTAL_BYTES)}.`);
      return;
    }
    if (items.length + incoming.length > MAX_FILE_COUNT) {
      setError(`Up to ${MAX_FILE_COUNT} files per turn.`);
      return;
    }

    try {
      const next = await toAttachments(incoming);
      setItems((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e.message);
    }
  }, [items, totalBytes]);

  const remove = useCallback((id) => {
    setItems((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      prev.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
      return [];
    });
    setError('');
  }, []);

  /** Lightweight version safe to persist into thread messages. */
  const toMessageShape = useCallback(
    () => items.map(({ id, name, type, size, dataUrl, preview }) => ({
      id, name, type, size, dataUrl, preview,
    })),
    [items],
  );

  return { items, error, totalBytes, add, remove, clear, toMessageShape };
}
