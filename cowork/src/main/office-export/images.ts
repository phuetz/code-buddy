/**
 * Local-only image loading for office export. HTTP(S) is never fetched.
 *
 * @module main/office-export/images
 */

import * as fs from 'fs';
import * as path from 'path';

export type OfficeImageType = 'png' | 'jpg' | 'gif' | 'bmp';

export interface LoadedOfficeImage {
  type: OfficeImageType;
  data: Buffer;
  width: number;
  height: number;
  resolvedPath?: string;
}

export interface ImageLoadResult {
  image?: LoadedOfficeImage;
  warning?: string;
}

const DEFAULT_SIZE = { width: 520, height: 320 };
const MAX_WIDTH = 520;
const MAX_HEIGHT = 360;

export function extensionToImageType(filePath: string): OfficeImageType | null {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  if (ext === 'jpeg') return 'jpg';
  if (ext === 'png' || ext === 'jpg' || ext === 'gif' || ext === 'bmp') return ext;
  return null;
}

function mimeToImageType(mime: string): OfficeImageType | null {
  const normalized = mime.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/bmp') return 'bmp';
  return null;
}

function readPngSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24 || data.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function readGifSize(data: Buffer): { width: number; height: number } | null {
  const signature = data.toString('ascii', 0, 6);
  if (data.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) return null;
  return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
}

function readJpegSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === undefined) break;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    const size = data.readUInt16BE(offset + 2);
    offset += 2 + size;
  }
  return null;
}

function readBmpSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 26 || data.toString('ascii', 0, 2) !== 'BM') return null;
  return {
    width: Math.abs(data.readInt32LE(18)),
    height: Math.abs(data.readInt32LE(22)),
  };
}

export function readImageDimensions(
  data: Buffer,
  type: OfficeImageType
): { width: number; height: number } {
  const parsed =
    type === 'png'
      ? readPngSize(data)
      : type === 'gif'
        ? readGifSize(data)
        : type === 'jpg'
          ? readJpegSize(data)
          : readBmpSize(data);
  return parsed ?? DEFAULT_SIZE;
}

export function fitImageBox(
  size: { width: number; height: number },
  maxWidth = MAX_WIDTH,
  maxHeight = MAX_HEIGHT
): { width: number; height: number } {
  const srcW = size.width > 0 ? size.width : DEFAULT_SIZE.width;
  const srcH = size.height > 0 ? size.height : DEFAULT_SIZE.height;
  const ratio = Math.min(maxWidth / srcW, maxHeight / srcH, 1);
  return {
    width: Math.max(1, Math.round(srcW * ratio)),
    height: Math.max(1, Math.round(srcH * ratio)),
  };
}

function isRemoteSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function parseDataUri(src: string): LoadedOfficeImage | null {
  const match = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const type = mimeToImageType(match[1] ?? '');
  if (!type) return null;
  try {
    const data = Buffer.from((match[2] ?? '').replace(/\s+/g, ''), 'base64');
    if (data.length === 0) return null;
    const dims = readImageDimensions(data, type);
    return { type, data, width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

function resolveLocalPath(src: string, baseDir: string): string | null {
  const unquoted = src.replace(/^["']|["']$/g, '');
  if (!unquoted || unquoted.includes('\0')) return null;
  const candidate = path.isAbsolute(unquoted) ? unquoted : path.resolve(baseDir, unquoted);
  const normalized = path.normalize(candidate);
  try {
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) return null;
  } catch {
    return null;
  }
  return normalized;
}

export function loadLocalImage(src: string, baseDir: string): ImageLoadResult {
  const trimmed = src.trim();
  if (!trimmed) {
    return { warning: 'Image sans chemin' };
  }
  if (isRemoteSrc(trimmed)) {
    return { warning: `Image distante ignorée (aucun réseau) : ${trimmed}` };
  }
  if (trimmed.startsWith('data:')) {
    const parsed = parseDataUri(trimmed);
    if (!parsed) return { warning: 'Data URI image illisible' };
    return { image: parsed };
  }

  const resolved = resolveLocalPath(trimmed, baseDir);
  if (!resolved) {
    return { warning: `Image manquante : ${trimmed}` };
  }
  const type = extensionToImageType(resolved);
  if (!type) {
    return { warning: `Format d'image non pris en charge : ${path.basename(resolved)}` };
  }
  try {
    const data = fs.readFileSync(resolved);
    const dims = readImageDimensions(data, type);
    return {
      image: {
        type,
        data,
        width: dims.width,
        height: dims.height,
        resolvedPath: resolved,
      },
    };
  } catch (err) {
    return { warning: `Lecture image impossible : ${(err as Error).message}` };
  }
}
