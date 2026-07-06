/**
 * media-attachments-model — pure extraction of local media paths from an
 * assistant message so the chat can render the generated image/video/audio
 * inline instead of a bare path. Two accepted shapes:
 *  - the media tools' explicit marker: `MEDIA:/abs/path.ext`
 *  - a bare absolute path (not part of a URL — `https://…/x.png` is ignored)
 */

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaAttachment {
  kind: MediaKind;
  path: string;
}

const EXT_TO_KIND: Record<string, MediaKind> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  wav: 'audio',
  mp3: 'audio',
  ogg: 'audio',
  flac: 'audio',
};

const EXT_ALTERNATION = Object.keys(EXT_TO_KIND).join('|');
// Marked form: the media tools reply `MEDIA:/abs/path.ext`.
const MARKED_RE = new RegExp(`MEDIA:(\\/[^\\s\`"'()]+\\.(?:${EXT_ALTERNATION}))\\b`, 'gi');
// Bare form: an absolute path not preceded by scheme/word chars (rejects URLs).
const BARE_RE = new RegExp(`(?<![\\w:/])(\\/[^\\s\`"'()]+\\.(?:${EXT_ALTERNATION}))\\b`, 'gi');

function kindOf(path: string): MediaKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? 'image';
}

/** All local media paths referenced by the text, deduplicated, in order. */
export function extractMediaPaths(text: string): MediaAttachment[] {
  const seen = new Set<string>();
  const out: MediaAttachment[] = [];
  for (const re of [MARKED_RE, BARE_RE]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const path = match[1]!;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ kind: kindOf(path), path });
    }
  }
  return out;
}

/** file:// URL for a local absolute path (spaces and accents encoded). */
export function toFileUrl(path: string): string {
  return 'file://' + path.split('/').map(encodeURIComponent).join('/');
}
