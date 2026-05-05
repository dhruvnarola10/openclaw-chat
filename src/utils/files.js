// File-handling helpers used by the attachment feature.

// Per OpenClaw OpenResponses API limits
export const MAX_IMAGE_BYTES  = 10 * 1024 * 1024;   // 10 MB per image
export const MAX_FILE_BYTES   =  5 * 1024 * 1024;   //  5 MB per file
export const MAX_TOTAL_BYTES  = 20 * 1024 * 1024;   // 20 MB total body
export const MAX_FILE_COUNT   = 10;

// Supported MIME types per OpenClaw spec
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif',
  'image/webp', 'image/heic', 'image/heif',
]);
const SUPPORTED_FILE_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/html', 'text/csv',
  'application/json', 'application/pdf',
]);

export const isImage = (file) => SUPPORTED_IMAGE_TYPES.has(file?.type ?? '');
export const isFile  = (file) => SUPPORTED_FILE_TYPES.has(file?.type ?? '');
export const isSupported = (file) => isImage(file) || isFile(file);

export const SUPPORTED_ACCEPT = [
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_FILE_TYPES,
].join(',');

export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    r.readAsDataURL(file);
  });
}

/**
 * Convert a list of File objects to attachment descriptors enriched with
 * a base64 data URL + (for images) an object URL we can render in the
 * UI without re-encoding.
 */
export async function toAttachments(fileList) {
  const out = [];
  for (const file of fileList) {
    out.push({
      id:        Math.random().toString(36).slice(2, 10),
      name:      file.name,
      type:      file.type || 'application/octet-stream',
      size:      file.size,
      preview:   isImage(file) ? URL.createObjectURL(file) : null,
      dataUrl:   await fileToDataUrl(file),
    });
  }
  return out;
}

/**
 * Split a data URL into its components.
 * "data:image/png;base64,AAAA..." → { mediaType: 'image/png', data: 'AAAA...' }
 */
function parseDataUrl(dataUrl) {
  const m = (dataUrl ?? '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) throw new Error('Attachment has an invalid data URL');
  return { mediaType: m[1], data: m[2] };
}

/**
 * Build the OpenClaw OpenResponses-compatible `input` value.
 *
 * Plain text → string (no wrapping needed).
 * With attachments → array containing a single message item whose `content`
 * holds ContentPart objects per the spec:
 *   input_text  → { type, text }
 *   input_image → { type, source: { type:'base64', media_type, data } }
 *   input_file  → { type, source: { type:'base64', media_type, data, filename } }
 */
export function buildInputContent(text, attachments) {
  if (!attachments?.length) return text;

  const content = [];
  if (text) content.push({ type: 'input_text', text });

  for (const a of attachments) {
    const { mediaType, data } = parseDataUrl(a.dataUrl);
    if (isImage(a)) {
      content.push({
        type: 'input_image',
        source: { type: 'base64', media_type: mediaType, data },
      });
    } else {
      content.push({
        type: 'input_file',
        source: { type: 'base64', media_type: mediaType, data, filename: a.name },
      });
    }
  }

  return [{ type: 'message', role: 'user', content }];
}

/** Friendly icon character for a non-image file based on its mime/extension. */
export function fileIconChar(file) {
  const t = file.type ?? '';
  if (t.startsWith('image/'))             return '🖼';
  if (t.startsWith('audio/'))             return '🔊';
  if (t.startsWith('video/'))             return '🎬';
  if (t === 'application/pdf')            return '📕';
  if (t.startsWith('text/'))              return '📄';
  if (t.includes('zip') || t.includes('tar') || t.includes('gzip')) return '🗜';
  if (t.includes('json') || t.includes('xml')) return '⟨/⟩';
  if (t.includes('javascript') || t.includes('python') ||
      /\.(js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|sh)$/i.test(file.name ?? '')) return '⟨/⟩';
  return '📎';
}
