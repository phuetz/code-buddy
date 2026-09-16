/**
 * Regression (companion selfie, 2026-09-06): the companion installs declare a
 * primary ComfyUI box that is frequently off plus reachable fallback endpoints.
 *
 * Provider auto-detection used to look at `COMFYUI_URL` only, so an install
 * left with fallbacks alone dropped to the cloud image provider and threw
 * "No image generation credentials configured for provider openai" — Lisa then
 * told the user the image backend was "not configured" while a local ComfyUI
 * was answering all along. The endpoint chain also read a single env spelling,
 * ignoring the shorter `COMFYUI_FALLBACK_URLS` that sits next to `COMFYUI_URL`.
 *
 * Real local HTTP servers speak ComfyUI's /prompt → /history/{id} → /view
 * contract; no mocks.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateImage } from '../../src/tools/media-generation-tool.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==',
  'base64',
);

let tempWorkspace: string;

describe('ComfyUI fallback endpoints are part of provider availability', () => {
  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-comfy-fallback-'));
  });

  afterEach(async () => {
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('auto-detects ComfyUI when only fallback endpoints are declared', async () => {
    const fallback = await startComfyServer('fallback-only', 'only.png');
    try {
      const env = baseEnv();
      env.COMFYUI_FALLBACK_URLS = fallback.origin;

      const result = await generateImage(
        { prompt: 'Lisa portrait', aspectRatio: 'portrait' },
        { env, rootDir: tempWorkspace },
      );

      expect(result.success).toBe(true);
      expect(result.provider).toBe('comfyui');
      expect(result.outputPath).toBeTruthy();
    } finally {
      await fallback.close();
    }
  });

  it('honours the short COMFYUI_FALLBACK_URLS spelling when the primary is down', async () => {
    const primary = await startDeadServer();
    const fallback = await startComfyServer('short-spelling', 'short.png');
    try {
      const env = baseEnv();
      env.CODEBUDDY_IMAGE_PROVIDER = 'comfyui';
      env.COMFYUI_URL = primary.origin;
      env.COMFYUI_FALLBACK_URLS = fallback.origin;

      const result = await generateImage(
        { prompt: 'Lisa portrait', aspectRatio: 'portrait' },
        { env, rootDir: tempWorkspace },
      );

      expect(result.success).toBe(true);
      expect(result.provider).toBe('comfyui');
    } finally {
      await Promise.all([primary.close(), fallback.close()]);
    }
  });

  it('still prefers an explicitly requested cloud provider over declared fallbacks', async () => {
    const env = baseEnv();
    env.CODEBUDDY_IMAGE_PROVIDER = 'xai';
    env.COMFYUI_FALLBACK_URLS = 'http://127.0.0.1:1';

    await expect(
      generateImage({ prompt: 'x' }, { env, rootDir: tempWorkspace }),
    ).rejects.toThrow(/credentials configured for provider xai/i);
  });
});

/**
 * A process env with every ComfyUI/image knob cleared, so the test declares
 * them. Keys the module reads through its `env()` helper fall back to
 * `process.env` when absent, so they are blanked rather than deleted — that
 * keeps the test hermetic on a workstation that exports them for real.
 */
function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  for (const key of [
    'CODEBUDDY_IMAGE_PROVIDER',
    'CODEBUDDY_IMAGE_BASE_URL',
    'CODEBUDDY_IMAGE_API_KEY',
    'CODEBUDDY_IMAGE_MODEL',
    'COMFYUI_URL',
    'COMFYUI_CHECKPOINT',
    'CODEBUDDY_LORA_INFER_CHECKPOINT',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'XAI_API_KEY',
    'XAI_BASE_URL',
  ]) {
    delete env[key];
  }
  for (const key of [
    'COMFYUI_FALLBACK_URLS',
    'CODEBUDDY_COMFYUI_FALLBACK_URLS',
    'CODEBUDDY_COMFYUI_FALLBACK_MODEL',
    'CODEBUDDY_COMFYUI_FALLBACK_LORA',
    'CODEBUDDY_COMFYUI_LORA',
  ]) {
    env[key] = '';
  }
  return env;
}

async function startComfyServer(promptId: string, filename: string) {
  return startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/prompt') {
      return json(res, { prompt_id: promptId });
    }
    if (req.url === `/history/${promptId}`) {
      return json(res, {
        [promptId]: {
          outputs: { '9': { images: [{ filename, subfolder: '', type: 'output' }] } },
        },
      });
    }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(ONE_PIXEL_PNG);
  });
}

async function startDeadServer() {
  return startServer(async (_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'GPU node unavailable' }));
  });
}

function json(res: http.ServerResponse, payload: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error: unknown) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
