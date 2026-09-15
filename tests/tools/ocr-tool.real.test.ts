/**
 * Real OCR runtime test (no mocks): the host Tesseract CLI reads a PNG rendered
 * locally by sharp. Excluded from the default suite (`*real*.test.ts`); run with
 * RUN_REAL_TESTS=1. Requires `tesseract` with local `eng` data and `sharp`;
 * missing prerequisites are reported as a skip, never as a pass.
 *
 * tesseract.js is disabled through the loader seam because it fetches language
 * data from a CDN on first use; this test must stay offline.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OCRTool } from '../../src/tools/ocr-tool.js';

function tesseractHasEnglish(): boolean {
  try {
    return /\beng\b/.test(execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    return false;
  }
}

async function loadSharp(): Promise<((input: Buffer) => { png: () => { toFile: (p: string) => Promise<unknown> } }) | null> {
  try {
    return (await import('sharp')).default as never;
  } catch {
    return null;
  }
}

const sharp = await loadSharp();
const ready = tesseractHasEnglish() && sharp !== null;

describe.skipIf(!ready)('OCRTool with the local Tesseract CLI (real)', () => {
  let dir: string;
  let image: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-real-'));
    image = path.join(dir, 'fixture.png');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160"><rect width="100%" height="100%" fill="white"/>'
      + '<text x="20" y="100" font-family="DejaVu Sans, sans-serif" font-size="64" fill="black">HELLO OCR 42</text></svg>';
    await sharp!(Buffer.from(svg)).png().toFile(image);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts the rendered text through the CLI engine without downloading language data', async () => {
    const tesseractJs = async () => { throw new Error('tesseract.js disabled: would fetch language data'); };
    const tool = new OCRTool({ platform: 'linux', loadTesseractJs: tesseractJs as never });

    const result = await tool.extractText(image, { language: 'eng' });

    expect(result.success).toBe(true);
    const data = result.data as { text: string; confidence?: number; language?: string };
    expect(data.text.replace(/\s+/g, ' ')).toContain('HELLO OCR 42');
    expect(data.language).toBe('eng');
    expect(result.output).toContain('HELLO OCR 42');
  }, 60_000);
});
