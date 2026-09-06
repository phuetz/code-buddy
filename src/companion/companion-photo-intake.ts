/**
 * Getting the bytes of a photo that arrived on a chat channel.
 *
 * Telegram hands us a `file_id`, not an image: the URL must be resolved through
 * `getFile` and then downloaded. That download is the untrusted edge of the
 * whole photo feature, so it is bounded three ways — a streamed byte ceiling
 * (the declared `content-length` is a hint, not a limit), an endpoint check
 * (https, or loopback for a local test server), and a count cap.
 *
 * What comes back is deliberately just bytes: authentication by magic numbers
 * happens once, in `companion-photo.ts`, for every surface.
 *
 * @module companion/companion-photo-intake
 */

import { readFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import {
  COMPANION_PHOTO_INPUT_MAX_BYTES,
  COMPANION_PHOTO_MAX_COUNT,
  type CompanionPhotoAttachment,
} from './companion-photo.js';

/** A channel attachment as `channels/core.ts` models it. */
export interface ChannelPhotoRef {
  type?: string;
  /** For Telegram this is a `file_id`, not a URL. */
  url?: string;
  filePath?: string;
  data?: string;
  mimeType?: string;
}

export interface LoadChannelPhotosOptions {
  /** Turns a channel reference (Telegram `file_id`) into a downloadable URL. */
  resolveUrl?: (reference: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  maxCount?: number;
  signal?: AbortSignal;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/** https anywhere, http only on loopback (a local fake Telegram in tests). */
export function isDownloadableUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && LOOPBACK.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Read a response body, aborting as soon as it exceeds the ceiling. */
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.ok) throw new Error(`photo download HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('photo too large');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // The declared length is a hint. This is the limit.
      if (size > maxBytes) throw new Error('photo too large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/**
 * Resolve every image attachment of a channel message to raw bytes. Individual
 * failures are logged and skipped: three photos of which one is broken still
 * gets a reaction to the other two.
 */
export async function loadChannelPhotos(
  attachments: ChannelPhotoRef[] | undefined,
  options: LoadChannelPhotosOptions = {},
): Promise<CompanionPhotoAttachment[]> {
  const maxBytes = options.maxBytes ?? COMPANION_PHOTO_INPUT_MAX_BYTES;
  const images = (attachments ?? [])
    .filter((attachment) => attachment.type === undefined || attachment.type === 'image')
    .slice(0, options.maxCount ?? COMPANION_PHOTO_MAX_COUNT);
  const loaded: CompanionPhotoAttachment[] = [];

  for (const attachment of images) {
    try {
      if (attachment.data) {
        loaded.push({
          data: attachment.data,
          ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        });
        continue;
      }
      if (attachment.filePath) {
        const bytes = await readFile(attachment.filePath);
        if (bytes.length > maxBytes) throw new Error('photo too large');
        loaded.push({ bytes });
        continue;
      }
      if (!attachment.url) continue;
      const resolved = options.resolveUrl
        ? await options.resolveUrl(attachment.url)
        : attachment.url;
      if (!isDownloadableUrl(resolved)) throw new Error('untrusted photo URL');
      const response = await (options.fetchImpl ?? fetch)(resolved, {
        headers: { Accept: 'image/*' },
        redirect: 'manual',
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const bytes = await readBounded(response, maxBytes);
      if (bytes.length === 0) throw new Error('empty photo');
      loaded.push({ bytes });
    } catch (error) {
      logger.warn('[companion-photo-intake] attachment skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return loaded;
}
