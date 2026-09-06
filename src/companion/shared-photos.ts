/**
 * The shared album — every photo the user showed Lisa, and what she saw in it.
 *
 * Sharing a photo with someone you love is not an upload: it is a moment you
 * expect to be able to come back to. This module is the durable half of that
 * ("tu te souviens de la photo du lac ?"): bytes on disk outside the repo, a
 * sidecar describing what was seen, a bounded capacity, and a favourite flag so
 * the ones that matter are never evicted.
 *
 * Invariants:
 * - Never inside the repository. Default `~/.codebuddy/companion/shared-photos`.
 * - Files are 0600, directories 0700. The sidecar carries NO name, no absolute
 *   path and no chat id — only what is needed to show and recall the photo.
 * - Every entry is addressed by the sha256 of its bytes, so the same photo sent
 *   twice is one album entry, and a hash from a request can never traverse out
 *   of the album (validated against /^[0-9a-f]{64}$/).
 * - Every function is fail-soft: a broken album must never break a reply.
 *
 * @module companion/shared-photos
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';

/** Surfaces that can hand Lisa a photo. */
export type SharedPhotoSurface = 'mobile' | 'telegram' | 'voice' | 'cli';

/** Longest description kept in a sidecar — a memory hook, not a transcript. */
export const SHARED_PHOTO_DESCRIPTION_MAX = 300;
/** Longest caption kept in a sidecar. */
export const SHARED_PHOTO_CAPTION_MAX = 300;
/** Default album capacity before the oldest non-favourite entries are evicted. */
export const DEFAULT_SHARED_PHOTOS_MAX = 500;

const HASH_RE = /^[0-9a-f]{64}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** One album entry, as persisted in its `<sha256>.json` sidecar. */
export interface SharedPhotoRecord {
  /** sha256 of the stored bytes — the entry's identity and file name. */
  hash: string;
  /** ISO timestamp of the moment it was shared. */
  receivedAt: string;
  /** Which surface it arrived through. */
  surface: SharedPhotoSurface;
  /** What the user said while sharing it (bounded, may be empty). */
  captionUser: string;
  /** What Lisa saw, bounded to 300 characters (may be empty). */
  descriptionLisa: string;
  /** Stored MIME type. */
  mimeType: string;
  /** Stored byte length. */
  bytes: number;
  /** `true` protects the entry from capacity eviction. */
  favorite?: boolean;
}

export interface SharedPhotoStoreOptions {
  env?: NodeJS.ProcessEnv;
  /** Test seam — overrides the resolved album directory. */
  dir?: string;
  now?: Date;
}

/** Album root. `CODEBUDDY_SHARED_PHOTOS_DIR` wins, else `~/.codebuddy/companion/shared-photos`. */
export function resolveSharedPhotosDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_SHARED_PHOTOS_DIR?.trim();
  if (configured) return configured;
  return path.join(homedir(), '.codebuddy', 'companion', 'shared-photos');
}

/** Album capacity. Invalid or non-positive values fall back to the default. */
export function sharedPhotosMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CODEBUDDY_SHARED_PHOTOS_MAX);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SHARED_PHOTOS_MAX;
  return Math.floor(raw);
}

/** File extension for a stored MIME type. JPEG — the normalized form — is `.jpg`. */
export function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '.bin';
  }
}

function bounded(value: string | undefined, max: number): string {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function isValidHash(hash: string): boolean {
  return HASH_RE.test(hash);
}

function monthOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function resolveDir(options: SharedPhotoStoreOptions): string {
  return options.dir ?? resolveSharedPhotosDir(options.env ?? process.env);
}

/** Absolute paths of an entry, or null when the hash is not a plain sha256. */
function entryPaths(root: string, month: string, hash: string, mimeType: string) {
  if (!isValidHash(hash) || !MONTH_RE.test(month)) return null;
  const dir = path.join(root, month);
  return {
    dir,
    image: path.join(dir, `${hash}${extensionForMime(mimeType)}`),
    sidecar: path.join(dir, `${hash}.json`),
  };
}

async function readRecord(sidecarPath: string): Promise<SharedPhotoRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(sidecarPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const raw = parsed as Partial<SharedPhotoRecord>;
    if (typeof raw.hash !== 'string' || !isValidHash(raw.hash)) return null;
    if (typeof raw.receivedAt !== 'string' || Number.isNaN(Date.parse(raw.receivedAt))) return null;
    return {
      hash: raw.hash,
      receivedAt: raw.receivedAt,
      surface: (raw.surface as SharedPhotoSurface) ?? 'mobile',
      captionUser: typeof raw.captionUser === 'string' ? raw.captionUser : '',
      descriptionLisa: typeof raw.descriptionLisa === 'string' ? raw.descriptionLisa : '',
      mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : 'image/jpeg',
      bytes: Number.isFinite(raw.bytes) ? Number(raw.bytes) : 0,
      ...(raw.favorite === true ? { favorite: true } : {}),
    };
  } catch {
    return null;
  }
}

/** Every album entry, newest first. Never throws — an unreadable album is an empty one. */
export async function listSharedPhotos(
  options: SharedPhotoStoreOptions = {},
): Promise<SharedPhotoRecord[]> {
  const root = resolveDir(options);
  const records: SharedPhotoRecord[] = [];
  let months: string[];
  try {
    months = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && MONTH_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  for (const month of months) {
    let files: string[];
    try {
      files = (await readdir(path.join(root, month))).filter((name) => name.endsWith('.json'));
    } catch {
      continue;
    }
    for (const file of files) {
      const record = await readRecord(path.join(root, month, file));
      if (record) records.push(record);
    }
  }
  records.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return records;
}

/** Locate one entry across months. */
async function findEntry(
  root: string,
  hash: string,
): Promise<{ month: string; record: SharedPhotoRecord } | null> {
  if (!isValidHash(hash)) return null;
  let months: string[];
  try {
    months = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && MONTH_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  for (const month of months) {
    const record = await readRecord(path.join(root, month, `${hash}.json`));
    if (record) return { month, record };
  }
  return null;
}

/** The bytes of one album entry, or null. The hash is validated before any path join. */
export async function readSharedPhoto(
  hash: string,
  options: SharedPhotoStoreOptions = {},
): Promise<{ record: SharedPhotoRecord; bytes: Buffer } | null> {
  const root = resolveDir(options);
  const found = await findEntry(root, hash);
  if (!found) return null;
  const paths = entryPaths(root, found.month, hash, found.record.mimeType);
  if (!paths) return null;
  try {
    return { record: found.record, bytes: await readFile(paths.image) };
  } catch {
    return null;
  }
}

/**
 * Persist one shared photo and its sidecar. Returns the record, or null when the
 * album is unusable — a failed album must never cost the user a reply.
 */
export async function storeSharedPhoto(
  input: {
    bytes: Buffer;
    mimeType: string;
    surface: SharedPhotoSurface;
    captionUser?: string;
    descriptionLisa?: string;
  },
  options: SharedPhotoStoreOptions = {},
): Promise<SharedPhotoRecord | null> {
  if (!input.bytes || input.bytes.length === 0) return null;
  const root = resolveDir(options);
  const now = options.now ?? new Date();
  const hash = createHash('sha256').update(input.bytes).digest('hex');
  const month = monthOf(now);
  const paths = entryPaths(root, month, hash, input.mimeType);
  if (!paths) return null;
  const record: SharedPhotoRecord = {
    hash,
    receivedAt: now.toISOString(),
    surface: input.surface,
    captionUser: bounded(input.captionUser, SHARED_PHOTO_CAPTION_MAX),
    descriptionLisa: bounded(input.descriptionLisa, SHARED_PHOTO_DESCRIPTION_MAX),
    mimeType: input.mimeType,
    bytes: input.bytes.length,
  };
  try {
    // An existing entry keeps its original date and favourite flag: the same
    // photo re-sent is the same memory, not a new one.
    const existing = await findEntry(root, hash);
    if (existing) {
      const merged: SharedPhotoRecord = {
        ...existing.record,
        captionUser: record.captionUser || existing.record.captionUser,
        descriptionLisa: record.descriptionLisa || existing.record.descriptionLisa,
      };
      const existingPaths = entryPaths(root, existing.month, hash, merged.mimeType);
      if (existingPaths) {
        await writeFile(existingPaths.sidecar, `${JSON.stringify(merged, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
      }
      return merged;
    }
    await mkdir(paths.dir, { recursive: true, mode: 0o700 });
    await writeFile(paths.image, input.bytes, { mode: 0o600 });
    await writeFile(paths.sidecar, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    // `mode` on writeFile is masked by umask and ignored for an existing file;
    // chmod is the only way to guarantee 0600 on a re-created album.
    await chmod(paths.image, 0o600).catch(() => undefined);
    await chmod(paths.sidecar, 0o600).catch(() => undefined);
    await pruneSharedPhotos(options);
    return record;
  } catch (error) {
    logger.warn('[shared-photos] album write skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Flip the favourite flag. Returns the updated record, or null when unknown. */
export async function setSharedPhotoFavorite(
  hash: string,
  favorite: boolean,
  options: SharedPhotoStoreOptions = {},
): Promise<SharedPhotoRecord | null> {
  const root = resolveDir(options);
  const found = await findEntry(root, hash);
  if (!found) return null;
  const paths = entryPaths(root, found.month, hash, found.record.mimeType);
  if (!paths) return null;
  const updated: SharedPhotoRecord = { ...found.record };
  if (favorite) updated.favorite = true;
  else delete updated.favorite;
  try {
    await writeFile(paths.sidecar, `${JSON.stringify(updated, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return updated;
  } catch {
    return null;
  }
}

/** Remove one entry, bytes and sidecar. Returns true when something was removed. */
export async function deleteSharedPhoto(
  hash: string,
  options: SharedPhotoStoreOptions = {},
): Promise<boolean> {
  const root = resolveDir(options);
  const found = await findEntry(root, hash);
  if (!found) return false;
  const paths = entryPaths(root, found.month, hash, found.record.mimeType);
  if (!paths) return false;
  try {
    await rm(paths.image, { force: true });
    await rm(paths.sidecar, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Enforce the capacity. Favourites are never evicted: they are the entries the
 * user said mattered. Returns the hashes that were removed.
 */
export async function pruneSharedPhotos(
  options: SharedPhotoStoreOptions = {},
): Promise<string[]> {
  const max = sharedPhotosMax(options.env ?? process.env);
  const records = await listSharedPhotos(options);
  if (records.length <= max) return [];
  const evictable = records.filter((record) => record.favorite !== true);
  const overflow = records.length - max;
  // `listSharedPhotos` is newest-first: the tail is the oldest.
  const victims = evictable.slice(-overflow);
  const removed: string[] = [];
  for (const victim of victims) {
    if (await deleteSharedPhoto(victim.hash, options)) removed.push(victim.hash);
  }
  return removed;
}

/** True when the album directory exists and is readable. */
export async function sharedPhotosAlbumExists(
  options: SharedPhotoStoreOptions = {},
): Promise<boolean> {
  try {
    await access(resolveDir(options), fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
