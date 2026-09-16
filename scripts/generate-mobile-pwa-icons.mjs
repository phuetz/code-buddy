#!/usr/bin/env node
/**
 * Generate simple PNG icons for the mobile PWA (96 / 192 / 512).
 * Pure zlib + CRC — no image library, no hand-made binaries.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

/**
 * Dark studio disc (Lisa amber) on a near-black square.
 * @param {number} size
 */
export function buildPwaIconPng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outer = size * 0.38;
  const inner = size * 0.16;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const offset = 1 + x * 3;
      let r = 0x0a;
      let g = 0x0a;
      let b = 0x0f;
      if (d <= outer && d >= inner) {
        r = 0xf5;
        g = 0xa6;
        b = 0x23;
      } else if (d < inner) {
        r = 0x06;
        g = 0xb6;
        b = 0xd4;
      }
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
    }
    rows.push(row);
  }

  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writeMobilePwaIcons(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const sizes = [96, 192, 512];
  const written = [];
  for (const size of sizes) {
    const file = join(targetDir, `icon-${size}.png`);
    writeFileSync(file, buildPwaIconPng(size));
    written.push(file);
  }
  return written;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dest = process.argv[2] || join(root, 'src', 'server', 'mobile', 'assets');
  const files = writeMobilePwaIcons(dest);
  console.log(`generate-mobile-pwa-icons: ${files.length} PNG(s) → ${dest}`);
}
