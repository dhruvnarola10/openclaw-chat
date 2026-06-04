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

// ── Inbound attachment parsing ──────────────────────────────────────────
//
// Assistant replies arrive as `payload.message.content[]`. The agent /
// gateway may emit images and files in several shapes (Anthropic-style,
// OpenAI-style, OpenClaw file refs). Normalise them to the same shape
// MessageAttachments already understands.
//
//   { id, name, type, url, dataUrl?, unavailable?, error? }
//
// Anything we can't resolve to a viewable url/dataUrl becomes an
// `unavailable` chip with the filename — matches OpenClaw's
// "File not found / Unavailable" UX.

const IMAGE_MIME_PREFIX = 'image/';

function mimeFromName(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  if (!ext) return 'application/octet-stream';
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg';
  if (['png','gif','webp','heic','heif'].includes(ext)) return `image/${ext}`;
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'json') return 'application/json';
  if (ext === 'csv') return 'text/csv';
  if (['txt','md','html'].includes(ext)) return `text/${ext === 'md' ? 'markdown' : ext}`;
  return 'application/octet-stream';
}

function dataUrlFromSource(src) {
  if (!src || typeof src !== 'object') return null;
  if (src.type === 'base64' && src.data) {
    const media = src.media_type || src.mediaType || 'application/octet-stream';
    return `data:${media};base64,${src.data}`;
  }
  if (typeof src.url === 'string') return src.url;
  return null;
}

function partToAttachment(part, i) {
  if (!part || typeof part !== 'object') return null;
  const baseId = part.id || part.file_id || part.fileId || `att-${i}`;

  // Anthropic-style { type:'image', source:{type:'base64',media_type,data} | {type:'url',url} }
  // AND OpenClaw message-tool style { type:'image', path, mimeType, name } —
  // same `type:'image'` but different field set.
  if (part.type === 'image') {
    const fromSource = part.source ? dataUrlFromSource(part.source) : null;
    const path       = part.path || part.file_path || part.fileSource;
    const media      = part.source?.media_type || part.source?.mediaType || part.mimeType || part.media_type || 'image/png';
    const name       = part.name || (typeof path === 'string' ? path.split('/').pop() : null) || `image-${i}.${media.split('/')[1] || 'png'}`;
    if (fromSource) {
      return { id: baseId, name, type: media, url: fromSource, dataUrl: fromSource.startsWith('data:') ? fromSource : undefined };
    }
    if (typeof path === 'string' && path.length) {
      // http(s) → render directly. Anything else (absolute fs path, MEDIA: ref) → assistant-media route.
      return /^https?:/i.test(path)
        ? { id: baseId, name, type: media, url: path }
        : { id: baseId, name, type: media, mediaSource: path };
    }
    return { id: baseId, name, type: media, unavailable: true };
  }

  // OpenAI: { type:'image_url', image_url:{url} } or { type:'output_image', image_url:{url} }
  if ((part.type === 'image_url' || part.type === 'output_image') && part.image_url) {
    const url  = typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
    const name = part.image_url?.name || part.name || `image-${i}.png`;
    return url
      ? { id: baseId, name, type: 'image/*', url }
      : { id: baseId, name, type: 'image/*', unavailable: true };
  }

  // OpenClaw / generic file refs: { type:'file' | 'attachment', fileId, name, url?, mediaType? }
  if (part.type === 'file' || part.type === 'attachment' || part.type === 'input_file' || part.type === 'output_file') {
    const url  = part.url || dataUrlFromSource(part.source);
    const name = part.name || part.filename || part.file_name || baseId;
    const type = part.mediaType || part.media_type || part.source?.media_type || mimeFromName(name);
    return url
      ? { id: baseId, name, type, url, dataUrl: url.startsWith('data:') ? url : undefined }
      : { id: baseId, name, type, unavailable: true };
  }

  return null;
}

/**
 * Walk `payload.message.content[]` (or any equivalent array) and pull out
 * a list of inbound attachments. Returns [] when there are none.
 */
export function extractAttachmentsFromContent(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (let i = 0; i < content.length; i++) {
    const a = partToAttachment(content[i], i);
    if (a) out.push(a);
  }
  return out;
}

// ── Inline MEDIA: tokens from assistant text ────────────────────────────
//
// OpenClaw's `image_generate` (and other media-producing tools) emit the
// path of the generated file straight into the assistant text as
// `MEDIA:<path>`. The Control UI parses these out and fetches each via
// /__openclaw__/assistant-media. We do the same:
//
//   in:  "Here's the image: MEDIA:/home/.../foo.jpg"
//   out: { cleanedText: "Here's the image:", attachments: [{ mediaSource, ... }] }
//
// The regex tolerates the path going to end-of-line OR up to whitespace —
// some agents wrap MEDIA: in code fences, others leave it bare.
const MEDIA_TOKEN_RE = /MEDIA:(\S+)/g;

export function extractMediaTokens(text) {
  if (typeof text !== 'string' || !text.includes('MEDIA:')) {
    return { cleanedText: text, attachments: [] };
  }
  const attachments = [];
  const seen = new Set();
  const cleanedText = text.replace(MEDIA_TOKEN_RE, (_, rawPath) => {
    const path = rawPath.replace(/[.,;:)]+$/, '');   // trim trailing punctuation
    if (seen.has(path)) return '';
    seen.add(path);
    const name = path.split('/').pop() || 'media';
    attachments.push({
      id:          `media:${path}`,
      name,
      type:        mimeFromName(name),
      mediaSource: path,
    });
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { cleanedText, attachments };
}

// OpenClaw's completion agent delivers the visible reply by calling the
// `message` tool with shape:
//
//   { action: "send",
//     message: "Here is the image you requested:",
//     attachments: [{ type:"image", mimeType, name, path }] }
//
// The gateway then routes that to the channel and the original sessionKey
// sees a "Sent visible reply…" tool-output, but no follow-up chat delta
// with a MEDIA: token. So if we only look at chat text, the image
// disappears. The built-in dashboard reads the args directly — match it.
export function attachmentsFromMessageToolArgs(args) {
  if (!args || typeof args !== 'object') return [];
  const list = Array.isArray(args.attachments) ? args.attachments : [];
  const out = [];
  // OpenClaw's message tool accepts the media reference under any of these
  // keys (src/agents/tools/message-tool.ts → readStructuredAttachmentMediaParams).
  // `media` is the canonical one — different models populate different aliases.
  const MEDIA_KEYS = ['media', 'mediaUrl', 'path', 'filePath', 'fileUrl', 'url'];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i] ?? {};
    let ref = null;
    for (const k of MEDIA_KEYS) {
      const v = raw[k];
      if (typeof v === 'string' && v.length) { ref = v; break; }
    }
    // Also accept a top-level buffer (base64 data URL) when the agent
    // inlines bytes instead of referencing a file path.
    const inline = typeof raw.buffer === 'string' && raw.buffer.length ? raw.buffer : null;

    const name = raw.name || raw.filename
      || (typeof ref === 'string' ? ref.split('/').pop() : null)
      || `attachment-${i}`;
    const type = raw.mimeType || raw.contentType || raw.media_type || raw.mediaType
      || (raw.type === 'image' ? mimeFromName(name) : null)
      || mimeFromName(name);

    if (inline) {
      const dataUrl = inline.startsWith('data:') ? inline : `data:${type};base64,${inline}`;
      out.push({ id: `msgtool:${name}:${i}`, name, type, url: dataUrl, dataUrl });
      continue;
    }
    if (!ref) {
      out.push({ id: `msgtool:${name}:${i}`, name, type, unavailable: true });
      continue;
    }
    out.push({
      id:   `msgtool:${ref}`,
      name,
      type,
      // Absolute fs paths and MEDIA: refs go through the assistant-media
      // route. http(s) URLs are used as-is.
      ...(/^https?:/i.test(ref) ? { url: ref } : { mediaSource: ref }),
    });
  }
  return out;
}

/** Treat any attachment whose `type` starts with image/ as renderable inline. */
export function isInlineImage(att) {
  return typeof att?.type === 'string' && att.type.startsWith(IMAGE_MIME_PREFIX);
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
