/**
 * Mean Rec. 601 luma of a still image (0..255).
 *
 * Used by the SENSE1 darkness door: frames darker than
 * `DARK_SCENE_LUMA_THRESHOLD` must not be sent to a VLM (they invent
 * furniture in the black). PNG is decoded in-process so tests and the
 * camera_analyze file path stay hermetic; other formats try optional `sharp`.
 */
import { inflateSync } from 'node:zlib';
import fs from 'fs/promises';

import { loadSharp } from './load-sharp.js';

/** Same floor as buddy-vision `BUDDY_VISION_MIN_LUMA` / vision-reaction. */
export const DARK_SCENE_LUMA_THRESHOLD = 12;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function meanLumaOfImage(imagePath: string): Promise<number | undefined> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(imagePath);
  } catch {
    return undefined;
  }
  const fromPng = meanLumaFromPng(bytes);
  if (fromPng !== undefined) return fromPng;
  return meanLumaFromSharp(bytes);
}

export function meanLumaFromPng(bytes: Buffer): number | undefined {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIG)) return undefined;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return undefined;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (data.length < 13) return undefined;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (compression !== 0 || filter !== 0 || interlace !== 0) return undefined;
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width < 1 || height < 1 || width > 8192 || height > 8192) return undefined;
  if (bitDepth !== 8) return undefined;
  const channels = pngChannels(colorType);
  if (channels === undefined) return undefined;

  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch {
    return undefined;
  }

  const stride = width * channels;
  const expected = height * (1 + stride);
  if (inflated.length < expected) return undefined;

  const recon = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[y * (1 + stride)] ?? 0;
    const src = y * (1 + stride) + 1;
    const dst = y * stride;
    const prev = y === 0 ? undefined : recon.subarray((y - 1) * stride, y * stride);
    unfilterRow(
      filterType,
      inflated.subarray(src, src + stride),
      recon.subarray(dst, dst + stride),
      prev,
      channels,
    );
  }

  let sum = 0;
  const pixels = width * height;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * channels;
    if (colorType === 0) {
      sum += recon[o] ?? 0;
    } else {
      const r = recon[o] ?? 0;
      const g = recon[o + 1] ?? 0;
      const b = recon[o + 2] ?? 0;
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return Math.round((sum / pixels) * 1000) / 1000;
}

async function meanLumaFromSharp(bytes: Buffer): Promise<number | undefined> {
  try {
    const sharp = await loadSharp();
    const { data, info } = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels ?? 3;
    if (channels < 1 || data.length < channels) return undefined;
    const pixels = Math.floor(data.length / channels);
    if (pixels < 1) return undefined;
    let sum = 0;
    for (let i = 0; i < pixels; i += 1) {
      const o = i * channels;
      if (channels === 1) {
        sum += data[o] ?? 0;
      } else {
        sum += 0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0);
      }
    }
    return Math.round((sum / pixels) * 1000) / 1000;
  } catch {
    return undefined;
  }
}

function pngChannels(colorType: number): number | undefined {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return undefined;
  }
}

function unfilterRow(
  filterType: number,
  src: Buffer,
  dst: Buffer,
  prev: Buffer | undefined,
  bpp: number,
): void {
  for (let i = 0; i < src.length; i += 1) {
    const x = src[i] ?? 0;
    const a = i >= bpp ? (dst[i - bpp] ?? 0) : 0;
    const b = prev ? (prev[i] ?? 0) : 0;
    const c = prev && i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    let val: number;
    switch (filterType) {
      case 1:
        val = (x + a) & 0xff;
        break;
      case 2:
        val = (x + b) & 0xff;
        break;
      case 3:
        val = (x + ((a + b) >> 1)) & 0xff;
        break;
      case 4:
        val = (x + paeth(a, b, c)) & 0xff;
        break;
      default:
        val = x;
        break;
    }
    dst[i] = val;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
