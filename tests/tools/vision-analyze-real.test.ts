import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { BrowserVisionTool, VisionAnalyzeTool } from '../../src/tools/registry/vision-tools.js';
import { serveTestPages, type TestPageServer } from '../helpers/browser-test-page.js';

let tempWorkspace: string;
let originalCwd: string;
let idCounter: number;
let browserTool: BrowserVisionTool | undefined;
let pages: TestPageServer | undefined;

function fixedNow(): Date {
  return new Date('2026-05-30T20:00:00.000Z');
}

function nextId(): string {
  idCounter += 1;
  return `vision-real-${idCounter}`;
}

function parseToolOutput<T>(result: { success: boolean; output?: string; error?: string }): T {
  expect(result.success, result.error).toBe(true);
  expect(result.output).toBeTruthy();
  return JSON.parse(result.output as string) as T;
}

describe('Hermes vision tools real integrations', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-vision-real-'));
    idCounter = 0;
    process.chdir(tempWorkspace);
  });

  afterEach(async () => {
    await browserTool?.dispose();
    browserTool = undefined;
    await pages?.close();
    pages = undefined;
    process.chdir(originalCwd);
    await fs.rm(tempWorkspace, { recursive: true, force: true });
  });

  it('analyzes a real image file and writes a durable vision report', async () => {
    const imagePath = path.join(tempWorkspace, 'red-square.png');
    await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 4,
        background: { r: 240, g: 16, b: 24, alpha: 1 },
      },
    }).png().toFile(imagePath);

    const tool = new VisionAnalyzeTool({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: nextId,
    });
    const result = await tool.execute({ image_path: imagePath });
    const payload = parseToolOutput<{
      kind: string;
      ok: boolean;
      imagePath: string;
      reportPath: string;
      metadata: { width: number; height: number; format: string; sizeBytes: number };
      colors: { dominant: { r: number; g: number; b: number } };
      labels: string[];
    }>(result);

    expect(payload).toMatchObject({
      kind: 'vision_analyze_result',
      ok: true,
      imagePath,
      metadata: {
        width: 64,
        height: 32,
        format: 'png',
      },
    });
    expect(payload.metadata.sizeBytes).toBeGreaterThan(0);
    expect(payload.colors.dominant.r).toBeGreaterThan(payload.colors.dominant.g);
    expect(payload.colors.dominant.r).toBeGreaterThan(payload.colors.dominant.b);
    expect(payload.labels).toEqual(expect.arrayContaining(['image', 'png', 'landscape']));
    await expect(fs.readFile(payload.reportPath, 'utf8')).resolves.toContain('"kind": "vision_analyze_result"');
  });

  it('captures and analyzes a real Playwright browser screenshot', async () => {
    pages = await serveTestPages(
      [
        '<!doctype html>',
        '<html><head><title>Hermes Vision Fixture</title></head>',
        '<body style="margin:0;font-family:sans-serif;background:#123456;color:white">',
        '<main style="padding:32px">',
        '<h1>Hermes Vision Real Page</h1>',
        '<button>Inspect me</button>',
        '</main>',
        '</body></html>',
      ].join(''),
    );

    browserTool = new BrowserVisionTool({
      rootDir: tempWorkspace,
      now: fixedNow,
      createId: nextId,
    });
    const result = await browserTool.execute({
      url: pages.url,
      include_snapshot: true,
      full_page: false,
      headless: true,
    }, { cwd: tempWorkspace });
    const payload = parseToolOutput<{
      kind: string;
      ok: boolean;
      screenshotPath: string;
      analysis: { metadata: { width: number; height: number; format: string }; source: string };
      snapshot?: string;
    }>(result);

    expect(payload.kind).toBe('browser_vision_result');
    expect(payload.ok).toBe(true);
    expect(payload.analysis.source).toBe('browser_screenshot');
    expect(payload.analysis.metadata.width).toBeGreaterThan(0);
    expect(payload.analysis.metadata.height).toBeGreaterThan(0);
    expect(payload.analysis.metadata.format).toBe('png');
    expect(payload.snapshot).toContain('Hermes Vision Fixture');
    expect(payload.snapshot).toContain('Inspect me');
    await expect(fs.stat(payload.screenshotPath)).resolves.toBeTruthy();
  });

  it('marks official Hermes vision tools as exact local tools', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T20:00:00.000Z');
    expect(manifest.tools).toContainEqual(expect.objectContaining({
      name: 'vision_analyze',
      status: 'exact',
      detectedCodeBuddyTools: expect.arrayContaining(['vision_analyze']),
    }));
    expect(manifest.tools).toContainEqual(expect.objectContaining({
      name: 'browser_vision',
      status: 'exact',
      detectedCodeBuddyTools: expect.arrayContaining(['browser_vision']),
    }));
  });
});
