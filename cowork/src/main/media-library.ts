/**
 * media-library — index of every media file the agent generated, across all
 * session working directories (ChatGPT-library parity: one place to browse,
 * reuse and export generated images/videos/audio).
 *
 * Generated media lands under `<cwd>/.codebuddy/media-generation/{images,videos}`
 * for whichever cwd the generating session used, plus loose audio files at the
 * cwd root (TTS outputs). This module scans the distinct roots the session
 * manager knows about; pure helpers are exported for tests.
 */
import * as fs from 'fs';
import * as path from 'path';

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaItem {
  path: string;
  kind: MediaKind;
  size: number;
  mtimeMs: number;
  /** The session working directory this media belongs to. */
  root: string;
  /** Original generation prompt (from the `<file>.meta.json` sidecar). */
  prompt?: string;
  /** Generation model (sidecar). */
  model?: string;
  /** Generation provider (sidecar). */
  provider?: string;
  /** The conversation that generated this media (linked in media.list). */
  sessionId?: string;
}

const EXT_TO_KIND: Record<string, MediaKind> = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.wav': 'audio',
  '.mp3': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
};

/** Read the generation sidecar (`<file>.meta.json`) if present — fail-open. */
function readSidecar(filePath: string): { prompt?: string; model?: string; provider?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(`${filePath}.meta.json`, 'utf-8')) as Record<string, unknown>;
    return {
      ...(typeof raw.prompt === 'string' ? { prompt: raw.prompt } : {}),
      ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
      ...(typeof raw.provider === 'string' ? { provider: raw.provider } : {}),
    };
  } catch {
    return {};
  }
}

export function kindOf(filePath: string): MediaKind | null {
  return EXT_TO_KIND[path.extname(filePath).toLowerCase()] ?? null;
}

/** Allow a YouTube sidecar only when its exact source video is exported with it. */
export function isExportableMediaBundlePath(filePath: string, selectedPaths: readonly string[]): boolean {
  if (kindOf(filePath)) return true;
  const suffix = '.youtube.json';
  if (!filePath.toLowerCase().endsWith(suffix)) return false;
  const sourceVideo = filePath.slice(0, -suffix.length);
  return kindOf(sourceVideo) === 'video' && selectedPaths.includes(sourceVideo);
}

/** Resolve a renderer selection to regular files confined to known media workspaces. */
export async function resolveExportableMediaBundlePaths(
  selectedPaths: readonly string[],
  roots: readonly string[],
): Promise<string[]> {
  if (!Array.isArray(selectedPaths) || selectedPaths.length === 0 || selectedPaths.length > 100) {
    throw new Error('invalid media export selection');
  }
  const trustedRoots = (await Promise.all([...new Set(roots)].map(async (root) => {
    try {
      const canonical = await fs.promises.realpath(root);
      return (await fs.promises.stat(canonical)).isDirectory()
        ? { lexical: path.resolve(root), canonical }
        : null;
    } catch {
      return null;
    }
  }))).filter((root): root is { lexical: string; canonical: string } => Boolean(root));
  const canonicalRoots = [...new Set(trustedRoots.map((root) => root.canonical))];
  if (!canonicalRoots.length) throw new Error('no trusted media workspace is available');

  const indexedMedia = new Set<string>();
  for (const root of canonicalRoots) {
    for (const item of scanRoot(root)) {
      try {
        const canonical = await fs.promises.realpath(item.path);
        await requireNoSymlinkDescendants(root, canonical);
        indexedMedia.add(canonical);
      } catch {
        // The media library is a discovery surface, not an authority. Entries
        // that changed or crossed a symlink since discovery are not exportable.
      }
    }
  }

  const canonicalPaths: string[] = [];
  for (const selected of [...new Set(selectedPaths)]) {
    if (typeof selected !== 'string' || !path.isAbsolute(selected) || selected.includes('\0')) {
      throw new Error('media export path is invalid');
    }
    const lexical = await fs.promises.lstat(selected);
    if (lexical.isSymbolicLink() || !lexical.isFile()) {
      throw new Error('media export accepts regular non-symlink files only');
    }
    const lexicalRoot = trustedRoots.find((root) => isWithin(path.resolve(selected), root.lexical));
    if (lexicalRoot) await requireNoSymlinkDescendants(lexicalRoot.lexical, path.resolve(selected));
    const canonical = await fs.promises.realpath(selected);
    const trustedRoot = canonicalRoots.find((root) => isWithin(canonical, root));
    if (!trustedRoot) {
      throw new Error('media export path is outside trusted workspaces');
    }
    await requireNoSymlinkDescendants(trustedRoot, canonical);
    canonicalPaths.push(canonical);
  }
  for (const candidate of canonicalPaths) {
    if (kindOf(candidate)) {
      if (!indexedMedia.has(candidate)) throw new Error('media export path is not indexed by the media library');
      continue;
    }
    const suffix = '.youtube.json';
    if (!candidate.toLowerCase().endsWith(suffix)) throw new Error('unsupported media bundle file');
    const video = candidate.slice(0, -suffix.length);
    if (kindOf(video) !== 'video' || !indexedMedia.has(video) || !canonicalPaths.includes(video)) {
      throw new Error('YouTube metadata must be exported with its exact source video');
    }
  }
  const exportNames = new Set<string>();
  for (const candidate of canonicalPaths) {
    const name = path.basename(candidate).toLocaleLowerCase('en');
    if (exportNames.has(name)) throw new Error(`media export contains a duplicate filename: ${path.basename(candidate)}`);
    exportNames.add(name);
  }
  return canonicalPaths;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function requireNoSymlinkDescendants(root: string, target: string): Promise<void> {
  const child = path.relative(root, target);
  if (!child || child === '..' || child.startsWith(`..${path.sep}`) || path.isAbsolute(child)) {
    throw new Error('media export path escapes its trusted workspace');
  }
  let cursor = root;
  for (const segment of child.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const info = await fs.promises.lstat(cursor);
    if (info.isSymbolicLink()) throw new Error('media export path contains a symbolic link');
  }
}

function scanDirRecursive(dir: string, root: string, out: MediaItem[], depth = 0): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirRecursive(full, root, out, depth + 1);
    } else if (entry.isFile()) {
      const kind = kindOf(entry.name);
      if (!kind) continue;
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, kind, size: stat.size, mtimeMs: stat.mtimeMs, root, ...readSidecar(full) });
      } catch {
        /* raced deletion — skip */
      }
    }
  }
}

/**
 * Scan one session root: `.codebuddy/media-generation/**` (recursive) plus
 * loose media files at the root itself (TTS wav outputs — non-recursive so a
 * source tree is never crawled).
 */
export function scanRoot(root: string): MediaItem[] {
  const out: MediaItem[] = [];
  scanDirRecursive(path.join(root, '.codebuddy', 'media-generation'), root, out);
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const kind = kindOf(entry.name);
      if (kind !== 'audio') continue;
      const full = path.join(root, entry.name);
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, kind, size: stat.size, mtimeMs: stat.mtimeMs, root, ...readSidecar(full) });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* root gone — fine */
  }
  return out;
}

/** Scan distinct roots, newest first, deduplicated by path, capped. */
export function scanMediaLibrary(roots: string[], cap = 500): MediaItem[] {
  const seen = new Set<string>();
  const all: MediaItem[] = [];
  for (const root of [...new Set(roots)].filter(Boolean)) {
    for (const item of scanRoot(root)) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      all.push(item);
    }
  }
  return all.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, cap);
}
