import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  publicMarkdownDocs,
  publicPrivacyDocs,
  publicScreenshotDirs,
} from './public-doc-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const minimumCaptureWidth = 500;
const minimumCaptureHeight = 80;
const minimumVisualColorBuckets = 4;
const minimumVisualLumaStdev = 3;

type SensitiveMatch = {
  file: string;
  label: string;
  value: string;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectPngFiles(dir: string): Promise<string[]> {
  const absoluteDir = path.join(repoRoot, dir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => path.join(absoluteDir, entry.name))
    .sort();
}

async function collectPublicPngFiles(): Promise<string[]> {
  return (await Promise.all(publicScreenshotDirs.map(collectPngFiles))).flat();
}

function collectSensitiveTextMatches(file: string, text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  const addMatches = (label: string, pattern: RegExp, allow?: (value: string) => boolean) => {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (allow?.(value)) continue;
      matches.push({ file, label, value });
    }
  };

  addMatches(
    'real email address',
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    (value) => value.toLowerCase().endsWith('@example.com'),
  );
  addMatches('absolute Windows path', /\b[A-Z]:\\[^\s`"')\]]+/gi);
  addMatches('absolute Unix user path', /\/Users\/[^\s`"')\]]+/gi);
  addMatches('OpenAI-style secret key', /\bsk-[A-Za-z0-9_-]{16,}\b/g);
  addMatches(
    'bearer token value',
    /\bBearer\s+(?!<redacted>|token\b|your_token\b)[A-Za-z0-9._-]{12,}/gi,
  );
  addMatches(
    'raw OAuth token value',
    /\b(?:access|refresh|id)_token["']?\s*[:=]\s*["']?(?!<redacted>|redacted|null\b)[A-Za-z0-9._-]{12,}/gi,
  );
  addMatches(
    'Code Buddy API key value',
    /\bcb_sk_[A-Za-z0-9_-]{3,}\b/g,
    (value) => value === 'cb_sk_placeholder',
  );
  addMatches(
    'non-placeholder API key assignment',
    /\b(?:OPENAI|GROK|ANTHROPIC|GEMINI|CODEBUDDY_FLEET)_API_KEY\s*=\s*(?!your_|<redacted>|redacted\b)[^\s`'"]+/gi,
  );

  return matches;
}

function collectMarkdownImageRefs(markdown: string): string[] {
  const refs: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    if (match[1]) refs.push(match[1].trim());
  }
  for (const match of markdown.matchAll(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) refs.push(match[1].trim());
  }
  return refs;
}

function collectMarkdownPngRefs(markdown: string): string[] {
  const refs = new Set<string>();
  for (const match of markdown.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    if (match[1]) refs.add(match[1].trim());
  }
  for (const match of markdown.matchAll(/<(?:a|img)\s+[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) refs.add(match[1].trim());
  }
  return [...refs]
    .map((ref) => ref.replace(/^<|>$/g, '').split('#')[0]?.split('?')[0]?.trim() ?? '')
    .filter((ref) => ref.endsWith('.png'));
}

function splitNullTerminatedFields(buffer: Buffer, start: number): Array<{ value: Buffer; next: number }> {
  const fields: Array<{ value: Buffer; next: number }> = [];
  let offset = start;
  while (offset <= buffer.length) {
    const nextNull = buffer.indexOf(0, offset);
    if (nextNull === -1) break;
    fields.push({ value: buffer.subarray(offset, nextNull), next: nextNull + 1 });
    offset = nextNull + 1;
  }
  return fields;
}

function collectPngMetadataText(buffer: Buffer): string[] {
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== pngSignature) return [];

  const chunks: string[] = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) break;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'tEXt' || type === 'eXIf') {
      chunks.push(data.toString('latin1'));
    } else if (type === 'zTXt') {
      const fields = splitNullTerminatedFields(data, 0);
      const keyword = fields[0]?.value.toString('latin1') ?? '';
      const compressionMethodOffset = fields[0]?.next;
      if (compressionMethodOffset !== undefined && compressionMethodOffset < data.length) {
        try {
          const compressedText = data.subarray(compressionMethodOffset + 1);
          chunks.push(`${keyword}\n${inflateSync(compressedText).toString('latin1')}`);
        } catch {
          chunks.push(keyword);
        }
      }
    } else if (type === 'iTXt') {
      const fields = splitNullTerminatedFields(data, 0);
      const keyword = fields[0]?.value.toString('latin1') ?? '';
      const compressionFlagOffset = fields[0]?.next;
      if (compressionFlagOffset !== undefined && compressionFlagOffset + 2 <= data.length) {
        const compressionFlag = data[compressionFlagOffset];
        const languageTag = fields[1]?.value.toString('latin1') ?? '';
        const translatedKeyword = fields[2]?.value.toString('latin1') ?? '';
        const textOffset = fields[2]?.next ?? compressionFlagOffset + 2;
        const textBytes = data.subarray(textOffset);
        try {
          const text = compressionFlag === 1 ? inflateSync(textBytes).toString('latin1') : textBytes.toString('latin1');
          chunks.push(`${keyword}\n${languageTag}\n${translatedKeyword}\n${text}`);
        } catch {
          chunks.push(`${keyword}\n${languageTag}\n${translatedKeyword}`);
        }
      }
    }

    offset = dataEnd + 4;
  }

  return chunks;
}

async function getVisualSignal(imagePath: string): Promise<{ colorBuckets: number; lumaStdev: number }> {
  const { data, info } = await sharp(imagePath)
    .removeAlpha()
    .resize({ width: 96, height: 96, fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colorBuckets = new Set<string>();
  const lumas: number[] = [];

  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    colorBuckets.add(`${red >> 4},${green >> 4},${blue >> 4}`);
    lumas.push((0.2126 * red) + (0.7152 * green) + (0.0722 * blue));
  }

  const mean = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
  const variance = lumas.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / lumas.length;
  return { colorBuckets: colorBuckets.size, lumaStdev: Math.sqrt(variance) };
}

describe('public screenshot documentation privacy', () => {
  it('keeps public QA and screenshot docs free of private account, token, and local path strings', async () => {
    const findings: SensitiveMatch[] = [];

    for (const publicDocPath of publicPrivacyDocs) {
      const absolutePath = path.join(repoRoot, publicDocPath);
      const content = await fs.readFile(absolutePath, 'utf8');
      findings.push(...collectSensitiveTextMatches(publicDocPath, content));
    }

    expect(findings).toEqual([]);
  });

  it('keeps screenshot references relative and present in GitHub-rendered docs', async () => {
    const missingRefs: string[] = [];
    const unsafeRefs: string[] = [];

    for (const docPath of publicMarkdownDocs) {
      const absoluteDocPath = path.join(repoRoot, docPath);
      const docDir = path.dirname(absoluteDocPath);
      const markdown = await fs.readFile(absoluteDocPath, 'utf8');
      const refs = collectMarkdownImageRefs(markdown)
        .filter((ref) => ref.endsWith('.png'));

      for (const ref of refs) {
        if (ref.startsWith('http://') || ref.startsWith('https://') || path.isAbsolute(ref)) {
          unsafeRefs.push(`${docPath}: ${ref}`);
          continue;
        }
        const targetPath = path.resolve(docDir, ref);
        if (!targetPath.startsWith(repoRoot) || !(await pathExists(targetPath))) {
          missingRefs.push(`${docPath}: ${ref}`);
        }
      }
    }

    expect(unsafeRefs).toEqual([]);
    expect(missingRefs).toEqual([]);
  });

  it('keeps every tracked public PNG capture discoverable from public docs', async () => {
    const discoverableRefs = new Set<string>();

    for (const docPath of publicMarkdownDocs) {
      const absoluteDocPath = path.join(repoRoot, docPath);
      const docDir = path.dirname(absoluteDocPath);
      const markdown = await fs.readFile(absoluteDocPath, 'utf8');
      const refs = collectMarkdownPngRefs(markdown);

      for (const ref of refs) {
        if (ref.startsWith('http://') || ref.startsWith('https://') || path.isAbsolute(ref)) continue;
        const targetPath = path.resolve(docDir, ref);
        if (targetPath.startsWith(repoRoot)) {
          discoverableRefs.add(path.relative(repoRoot, targetPath));
        }
      }
    }

    const orphanedCaptures = (await collectPublicPngFiles())
      .map((imagePath) => path.relative(repoRoot, imagePath))
      .filter((relativePath) => !discoverableRefs.has(relativePath));

    expect(orphanedCaptures).toEqual([]);
  });

  it('keeps tracked public PNG captures free of embedded private metadata strings', async () => {
    const imagePaths = await collectPublicPngFiles();
    const findings: SensitiveMatch[] = [];
    const metadataFindings: string[] = [];

    expect(imagePaths.length).toBeGreaterThan(0);

    for (const imagePath of imagePaths) {
      const relativePath = path.relative(repoRoot, imagePath);
      const metadata = await sharp(imagePath).metadata();
      if (metadata.format !== 'png') {
        metadataFindings.push(`${relativePath}: expected png, got ${metadata.format ?? 'unknown'}`);
      }
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width < minimumCaptureWidth || height < minimumCaptureHeight) {
        metadataFindings.push(
          `${relativePath}: expected at least ${minimumCaptureWidth}x${minimumCaptureHeight}, got ${width}x${height}`,
        );
      }
      if (metadata.exif || metadata.iptc || metadata.xmp) {
        metadataFindings.push(`${relativePath}: contains private metadata block`);
      }

      const bytes = await fs.readFile(imagePath);
      for (const chunkText of collectPngMetadataText(bytes)) {
        findings.push(...collectSensitiveTextMatches(relativePath, chunkText));
      }
    }

    expect(metadataFindings).toEqual([]);
    expect(findings).toEqual([]);
  });

  it('keeps tracked public PNG captures visually non-blank', async () => {
    const imagePaths = await collectPublicPngFiles();
    const blankFindings: string[] = [];

    expect(imagePaths.length).toBeGreaterThan(0);

    for (const imagePath of imagePaths) {
      const relativePath = path.relative(repoRoot, imagePath);
      const signal = await getVisualSignal(imagePath);
      if (
        signal.colorBuckets < minimumVisualColorBuckets
        || signal.lumaStdev < minimumVisualLumaStdev
      ) {
        blankFindings.push(
          `${relativePath}: expected visual signal >= ${minimumVisualColorBuckets} color buckets and ${minimumVisualLumaStdev} luma stdev, got ${signal.colorBuckets} and ${signal.lumaStdev.toFixed(2)}`,
        );
      }
    }

    expect(blankFindings).toEqual([]);
  });
});
