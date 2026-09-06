/**
 * ComfyUI generation: remember the last healthy endpoint for 5 minutes so a
 * dead primary is not retried first on the next call.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  generateImage,
  resetHealthyComfyEndpointForTests,
} from '../../src/tools/media-generation-tool.js';

const QA = fileURLToPath(new URL('../../_qa/selfie2', import.meta.url));
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==',
  'base64',
);

let tempWorkspace: string;

describe('ComfyUI healthy endpoint memory', () => {
  beforeEach(async () => {
    resetHealthyComfyEndpointForTests();
    await fs.mkdir(QA, { recursive: true });
    tempWorkspace = await fs.mkdtemp(path.join(QA, 'comfy-'));
  });

  afterEach(async () => {
    resetHealthyComfyEndpointForTests();
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('asks the last healthy fallback first on the next call', async () => {
    const primaryHits: string[] = [];
    const fallbackHits: string[] = [];
    const primary = await startCountingServer(primaryHits, false);
    const fallback = await startCountingServer(fallbackHits, true, 'healthy.png');
    try {
      const env = baseEnv();
      env.CODEBUDDY_IMAGE_PROVIDER = 'comfyui';
      env.COMFYUI_URL = primary.origin;
      env.COMFYUI_FALLBACK_URLS = fallback.origin;
      env.CODEBUDDY_COMFYUI_ENDPOINT_TIMEOUT_MS = '500';
      env.CODEBUDDY_COMFYUI_POLL_MS = '20';

      const first = await generateImage(
        { prompt: 'a red cube', aspectRatio: 'portrait' },
        { env, rootDir: tempWorkspace },
      );
      expect(first.success).toBe(true);
      expect(primaryHits.length).toBeGreaterThan(0);
      expect(fallbackHits.length).toBeGreaterThan(0);

      const primaryAfterFirst = primaryHits.length;
      const fallbackAfterFirst = fallbackHits.length;

      const second = await generateImage(
        { prompt: 'a blue cube', aspectRatio: 'portrait' },
        { env, rootDir: tempWorkspace },
      );
      expect(second.success).toBe(true);
      expect(primaryHits.length).toBe(primaryAfterFirst);
      expect(fallbackHits.length).toBeGreaterThan(fallbackAfterFirst);
    } finally {
      await Promise.all([primary.close(), fallback.close()]);
    }
  });
});

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

async function startCountingServer(
  hits: string[],
  healthy: boolean,
  filename = 'out.png',
): Promise<{ origin: string; close: () => Promise<void> }> {
  const promptId = `p-${hits.length}`;
  return startServer(async (req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (!healthy) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GPU node unavailable' }));
      return;
    }
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
