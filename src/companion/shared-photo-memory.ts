/**
 * Turning a shared photo into something Lisa can bring up later.
 *
 * Two durable effects, both fail-soft:
 *  - the bytes and what she saw go to the shared album (`shared-photos.ts`);
 *  - a bounded, rolling memory line goes to persistent memory under the single
 *    key `photos:recent`, the same mechanism the episodic journal uses for
 *    `episode:recent` (`sensory/episodic-journal.ts` writes it,
 *    `companion/relational-context.ts` reads it back into the prompt).
 *
 * One key, capped to a handful of lines, is deliberate: persistent memory has a
 * character budget (`MemoryConfig.projectCharLimit`), and one fact per photo
 * would evict everything else she knows about him within a week.
 *
 * @module companion/shared-photo-memory
 */

import { logger } from '../utils/logger.js';
import { photoMemoryLine, type PreparedCompanionPhoto } from './companion-photo.js';
import {
  storeSharedPhoto,
  type SharedPhotoRecord,
  type SharedPhotoStoreOptions,
  type SharedPhotoSurface,
} from './shared-photos.js';

/** Memory key holding the rolling "photos he showed me" block. */
export const SHARED_PHOTO_MEMORY_KEY = 'photos:recent';
/** How many photo lines the relational context carries. */
export const SHARED_PHOTO_MEMORY_LINES = 5;

/** Minimal surface of the persistent-memory manager this module needs. */
export interface PhotoMemoryPort {
  recall(key: string, scope?: 'project' | 'user'): string | null;
  remember(
    key: string,
    value: string,
    options?: { scope?: 'project' | 'user'; category?: string; tags?: string[] },
  ): Promise<unknown>;
}

export interface RememberSharedPhotosOptions extends SharedPhotoStoreOptions {
  surface: SharedPhotoSurface;
  caption?: string;
  /** Test seam — production resolves the real persistent-memory manager. */
  memory?: PhotoMemoryPort;
  /** `false` stores the album entry without touching persistent memory. */
  writeMemory?: boolean;
}

async function defaultMemory(): Promise<PhotoMemoryPort | null> {
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const manager = getMemoryManager();
    await manager.initialize();
    return manager as unknown as PhotoMemoryPort;
  } catch {
    return null;
  }
}

/** Prepend a line, drop duplicates, keep the block bounded. */
export function mergePhotoMemory(existing: string | null, line: string, max: number): string {
  const previous = String(existing ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry !== line);
  return [line, ...previous].slice(0, max).join('\n');
}

/**
 * Persist a batch of shared photos. Returns the album records that were
 * written. Never throws: an unwritable album or memory must not cost a reply.
 */
export async function rememberSharedPhotos(
  photos: PreparedCompanionPhoto[],
  options: RememberSharedPhotosOptions,
): Promise<SharedPhotoRecord[]> {
  if (photos.length === 0) return [];
  const now = options.now ?? new Date();
  const storeOptions: SharedPhotoStoreOptions = {
    now,
    ...(options.dir ? { dir: options.dir } : {}),
    ...(options.env ? { env: options.env } : {}),
  };

  const records: SharedPhotoRecord[] = [];
  for (const photo of photos) {
    const record = await storeSharedPhoto(
      {
        bytes: photo.bytes,
        mimeType: photo.mimeType,
        surface: options.surface,
        ...(options.caption ? { captionUser: options.caption } : {}),
        ...(photo.description ? { descriptionLisa: photo.description } : {}),
      },
      storeOptions,
    );
    if (record) records.push(record);
  }

  if (options.writeMemory === false) return records;

  const described = photos.find((photo) => photo.description?.trim());
  const line = photoMemoryLine(described?.description ?? options.caption ?? '', now);
  try {
    const memory = options.memory ?? (await defaultMemory());
    if (!memory) return records;
    const merged = mergePhotoMemory(
      memory.recall(SHARED_PHOTO_MEMORY_KEY, 'project'),
      line,
      SHARED_PHOTO_MEMORY_LINES,
    );
    await memory.remember(SHARED_PHOTO_MEMORY_KEY, merged, {
      scope: 'project',
      category: 'context',
      tags: ['companion', 'photo'],
    });
  } catch (error) {
    logger.debug('[shared-photo-memory] memory write skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return records;
}

/** Read the rolling photo block back, for the relational context. */
export async function readSharedPhotoMemory(
  memory?: PhotoMemoryPort,
): Promise<string | null> {
  try {
    const port = memory ?? (await defaultMemory());
    if (!port) return null;
    const value = port.recall(SHARED_PHOTO_MEMORY_KEY, 'project');
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}
