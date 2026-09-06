/**
 * The shared album, as the phone sees it.
 *
 * A couple's album has two halves: what he showed her (`companion/shared-
 * photos.ts`) and what she sent him (the Lisa selfie cache). This module merges
 * them into ONE date-ordered list, because that is what an album is.
 *
 * Two rules shape the JSON:
 * - No absolute path ever leaves the server. A selfie is addressed by the
 *   sha256 of its path RELATIVE to the cache root, and resolved by re-listing
 *   that root and matching the digest, so a client-supplied id can never be
 *   turned into a path.
 * - A shared photo is addressed by the sha256 of its bytes, which the album
 *   store already validates against `/^[0-9a-f]{64}$/`.
 *
 * @module server/mobile/album
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  listSharedPhotos,
  readSharedPhoto,
  type SharedPhotoStoreOptions,
} from '../../companion/shared-photos.js';
import { logger } from '../../utils/logger.js';

/** One tile of the album grid. */
export interface AlbumEntry {
  /** Opaque id — a sha256, never a path. */
  id: string;
  /** `shared` = he showed it to her. `selfie` = she sent it to him. */
  kind: 'shared' | 'selfie';
  /** ISO date used for the ordering. */
  at: string;
  mimeType: string;
  /** What Lisa saw (shared photos only). */
  description?: string;
  /** What he said while sharing it. */
  caption?: string;
  favorite?: boolean;
}

export interface AlbumOptions extends SharedPhotoStoreOptions {
  /** Test seam — overrides the resolved Lisa selfie cache directory. */
  selfieDir?: string;
  /** Cap on selfies merged into the grid. */
  maxSelfies?: number;
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const DEFAULT_MAX_SELFIES = 120;

function mimeForExt(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}

function idForRelativePath(relative: string): string {
  return createHash('sha256').update(`selfie:${relative}`).digest('hex');
}

async function resolveSelfieRoot(options: AlbumOptions): Promise<string | null> {
  if (options.selfieDir) return options.selfieDir;
  try {
    const { resolveSelfieCacheDir } = await import('../../companion/lisa-selfie-ingest.js');
    return resolveSelfieCacheDir(options.env ?? process.env);
  } catch {
    return null;
  }
}

/** Every image under the selfie cache, one level of nesting at a time. */
async function walkSelfies(
  root: string,
  relative = '',
  depth = 0,
  found: Array<{ relative: string; absolute: string }> = [],
): Promise<Array<{ relative: string; absolute: string }>> {
  if (depth > 3) return found;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      await walkSelfies(root, childRelative, depth + 1, found);
    } else if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
      found.push({ relative: childRelative, absolute: path.join(root, childRelative) });
    }
  }
  return found;
}

async function listSelfies(options: AlbumOptions): Promise<AlbumEntry[]> {
  const root = await resolveSelfieRoot(options);
  if (!root) return [];
  const files = await walkSelfies(root);
  const max = options.maxSelfies ?? DEFAULT_MAX_SELFIES;
  const entries: AlbumEntry[] = [];
  for (const file of files.slice(0, max)) {
    try {
      const stats = await stat(file.absolute);
      entries.push({
        id: idForRelativePath(file.relative),
        kind: 'selfie',
        at: new Date(stats.mtimeMs).toISOString(),
        mimeType: mimeForExt(path.extname(file.relative).toLowerCase()),
      });
    } catch {
      /* a selfie that vanished mid-listing is simply not in the album */
    }
  }
  return entries;
}

/** The merged album, newest first. Never throws. */
export async function listAlbum(options: AlbumOptions = {}): Promise<AlbumEntry[]> {
  const [shared, selfies] = await Promise.all([
    listSharedPhotos(options).catch(() => []),
    listSelfies(options).catch(() => []),
  ]);
  const entries: AlbumEntry[] = shared.map((record) => ({
    id: record.hash,
    kind: 'shared' as const,
    at: record.receivedAt,
    mimeType: record.mimeType,
    ...(record.descriptionLisa ? { description: record.descriptionLisa } : {}),
    ...(record.captionUser ? { caption: record.captionUser } : {}),
    ...(record.favorite ? { favorite: true } : {}),
  }));
  entries.push(...selfies);
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return entries;
}

/** Bytes for one album id, shared photo or selfie. Null when unknown. */
export async function readAlbumEntry(
  id: string,
  options: AlbumOptions = {},
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!/^[0-9a-f]{64}$/.test(id)) return null;

  const shared = await readSharedPhoto(id, options).catch(() => null);
  if (shared) return { bytes: shared.bytes, mimeType: shared.record.mimeType };

  const root = await resolveSelfieRoot(options);
  if (!root) return null;
  // Resolve by re-listing and matching the digest: the id never becomes a path.
  const files = await walkSelfies(root);
  const match = files.find((file) => idForRelativePath(file.relative) === id);
  if (!match) return null;
  try {
    return {
      bytes: await readFile(match.absolute),
      mimeType: mimeForExt(path.extname(match.relative).toLowerCase()),
    };
  } catch (error) {
    logger.debug('[album] selfie unreadable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
