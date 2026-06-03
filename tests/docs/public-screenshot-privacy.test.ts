import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const publicDocPaths = [
  'README.md',
  'docs/screenshots/README.md',
  'docs/qa/code-buddy-studio/feature-qa.md',
  'docs/qa/code-buddy-studio/feature-qa-report.json',
  'docs/qa/code-buddy-studio/overnight-qa-campaign.md',
  'docs/qa/code-buddy-studio/overnight-test-datasets.json',
];

const screenshotDirs = [
  'docs/screenshots',
  'docs/qa/code-buddy-studio/screenshots',
];

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
    'non-placeholder API key assignment',
    /\b(?:OPENAI|GROK|ANTHROPIC|GEMINI)_API_KEY\s*=\s*(?!your_|<redacted>|redacted\b)[^\s`'"]+/gi,
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

describe('public screenshot documentation privacy', () => {
  it('keeps public QA and screenshot docs free of private account, token, and local path strings', async () => {
    const findings: SensitiveMatch[] = [];

    for (const publicDocPath of publicDocPaths) {
      const absolutePath = path.join(repoRoot, publicDocPath);
      const content = await fs.readFile(absolutePath, 'utf8');
      findings.push(...collectSensitiveTextMatches(publicDocPath, content));
    }

    expect(findings).toEqual([]);
  });

  it('keeps screenshot references relative and present in GitHub-rendered docs', async () => {
    const docsWithScreenshotRefs = [
      'README.md',
      'docs/screenshots/README.md',
      'docs/qa/code-buddy-studio/feature-qa.md',
    ];
    const missingRefs: string[] = [];
    const unsafeRefs: string[] = [];

    for (const docPath of docsWithScreenshotRefs) {
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

  it('keeps tracked public PNG captures free of embedded private metadata strings', async () => {
    const imagePaths = (await Promise.all(screenshotDirs.map(collectPngFiles))).flat();
    const findings: SensitiveMatch[] = [];
    const metadataFindings: string[] = [];

    expect(imagePaths.length).toBeGreaterThan(0);

    for (const imagePath of imagePaths) {
      const relativePath = path.relative(repoRoot, imagePath);
      const metadata = await sharp(imagePath).metadata();
      if (metadata.format !== 'png') {
        metadataFindings.push(`${relativePath}: expected png, got ${metadata.format ?? 'unknown'}`);
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
});
