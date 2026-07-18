/**
 * ComfyUI local image provider — real integration test (no mocks): a real local
 * HTTP server mimics ComfyUI's /prompt → /history/{id} → /view contract exactly
 * as observed on a live ComfyUI 0.22 instance, and we drive generateImage()
 * against it end-to-end (submit → poll → download → save to disk).
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
let originalEnv: NodeJS.ProcessEnv;

describe('ComfyUI local image provider (real HTTP)', () => {
  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-comfy-'));
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tempWorkspace, { recursive: true, force: true });
  });

  it('submits a workflow, polls history, downloads the PNG and saves it', async () => {
    let submittedWorkflow: Record<string, unknown> | undefined;
    let viewQuery = '';
    const promptId = 'test-prompt-1';

    const server = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/prompt') {
        const body = await readJson(req);
        submittedWorkflow = body.prompt as Record<string, unknown>;
        return json(res, { prompt_id: promptId });
      }
      if (req.method === 'GET' && req.url === `/history/${promptId}`) {
        return json(res, {
          [promptId]: {
            status: { status_str: 'success', completed: true },
            outputs: {
              '9': { images: [{ filename: 'codebuddy_00001_.png', subfolder: '', type: 'output' }] },
            },
          },
        });
      }
      if (req.method === 'GET' && req.url?.startsWith('/view')) {
        viewQuery = req.url;
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(ONE_PIXEL_PNG);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const env = {
        ...process.env,
        CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
        COMFYUI_URL: server.origin,
      } as NodeJS.ProcessEnv;

      const result = await generateImage(
        { prompt: 'a person at a desk', aspectRatio: 'landscape' },
        { env, rootDir: tempWorkspace },
      );

      expect(result.success).toBe(true);
      expect(result.provider).toBe('comfyui');
      expect(result.model).toBe('sd_turbo.safetensors');
      expect(result.outputPath).toBeTruthy();
      // File was actually written to disk under the workspace.
      const bytes = await fs.readFile(result.outputPath!);
      expect(bytes.equals(ONE_PIXEL_PNG)).toBe(true);
      expect(result.mediaPath).toBe(`MEDIA:${result.outputPath}`);

      // The submitted graph is a valid txt2img workflow tuned for the turbo ckpt.
      const wf = submittedWorkflow!;
      expect((wf['4'] as any).inputs.ckpt_name).toBe('sd_turbo.safetensors');
      expect((wf['3'] as any).inputs.steps).toBe(4); // turbo → few-step
      expect((wf['3'] as any).inputs.cfg).toBe(1.0);
      expect((wf['6'] as any).inputs.text).toBe('a person at a desk');
      // SD Turbo is 512-native; non-square latents tend to tile portraits into
      // duplicate faces, so even the fallback landscape request stays square.
      expect((wf['5'] as any).inputs.width).toBe(512);
      expect((wf['5'] as any).inputs.height).toBe(512);
      // /view was called with the returned filename.
      expect(viewQuery).toContain('filename=codebuddy_00001_.png');
    } finally {
      await server.close();
    }
  });

  it('tunes steps/cfg for a non-turbo checkpoint (sd 1.5)', async () => {
    let wf: Record<string, unknown> | undefined;
    const promptId = 'p2';
    const server = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/prompt') {
        wf = (await readJson(req)).prompt as Record<string, unknown>;
        return json(res, { prompt_id: promptId });
      }
      if (req.url === `/history/${promptId}`) {
        return json(res, {
          [promptId]: { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } },
        });
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(ONE_PIXEL_PNG);
    });
    try {
      const env = {
        ...process.env,
        CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
        COMFYUI_URL: server.origin,
        CODEBUDDY_IMAGE_MODEL: 'v1-5-pruned-emaonly.safetensors',
      } as NodeJS.ProcessEnv;
      await generateImage({ prompt: 'x', aspectRatio: 'square' }, { env, rootDir: tempWorkspace });
      expect((wf!['3'] as any).inputs.steps).toBe(20);
      expect((wf!['3'] as any).inputs.cfg).toBe(7.0);
      expect((wf!['5'] as any).inputs.width).toBe(768); // square
    } finally {
      await server.close();
    }
  });

  it('fails closed when the workflow is rejected (no prompt_id)', async () => {
    const server = await startServer(async (req, res) => {
      if (req.url === '/prompt') {
        return json(res, { error: { type: 'invalid_prompt', message: 'bad node' } });
      }
      res.writeHead(404);
      res.end();
    });
    try {
      const env = {
        ...process.env,
        CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
        COMFYUI_URL: server.origin,
      } as NodeJS.ProcessEnv;
      await expect(
        generateImage({ prompt: 'x' }, { env, rootDir: tempWorkspace }),
      ).rejects.toThrow(/rejected the workflow/i);
    } finally {
      await server.close();
    }
  });

  it('falls back to the next ComfyUI endpoint when the primary is unavailable', async () => {
    let primaryAttempts = 0;
    let fallbackAttempts = 0;
    let fallbackWorkflow: Record<string, any> | undefined;
    const primary = await startServer(async (_req, res) => {
      primaryAttempts += 1;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Darkstar unavailable' }));
    });
    const promptId = 'fallback-prompt';
    const fallback = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/prompt') {
        fallbackAttempts += 1;
        fallbackWorkflow = (await readJson(req)).prompt as Record<string, any>;
        return json(res, { prompt_id: promptId });
      }
      if (req.url === `/history/${promptId}`) {
        return json(res, {
          [promptId]: {
            outputs: {
              '9': { images: [{ filename: 'fallback.png', subfolder: '', type: 'output' }] },
            },
          },
        });
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(ONE_PIXEL_PNG);
    });
    try {
      const env = {
        ...process.env,
        CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
        COMFYUI_URL: primary.origin,
        CODEBUDDY_COMFYUI_FALLBACK_URLS: fallback.origin,
        CODEBUDDY_IMAGE_MODEL: 'krea2_turbo_fp8_scaled.safetensors',
        CODEBUDDY_COMFYUI_LORA: 'lisa-krea2.safetensors',
        CODEBUDDY_COMFYUI_FALLBACK_MODEL: 'sd_turbo.safetensors',
        CODEBUDDY_COMFYUI_FALLBACK_LORA: 'none',
      } as NodeJS.ProcessEnv;
      const result = await generateImage(
        { prompt: 'Lisa portrait', aspectRatio: 'portrait' },
        { env, rootDir: tempWorkspace },
      );
      expect(result.success).toBe(true);
      expect(primaryAttempts).toBe(1);
      expect(fallbackAttempts).toBe(1);
      expect(result.model).toBe('sd_turbo.safetensors');
      expect(fallbackWorkflow?.['4']?.class_type).toBe('CheckpointLoaderSimple');
      expect(fallbackWorkflow?.['4']?.inputs.ckpt_name).toBe('sd_turbo.safetensors');
      expect(fallbackWorkflow?.['10']).toBeUndefined();
    } finally {
      await Promise.all([primary.close(), fallback.close()]);
    }
  });

  it('falls back when the primary endpoint times out', async () => {
    const primary = await startServer(async (_req, _res) => {
      // Intentionally leave the request open until the client endpoint timeout.
    });
    const promptId = 'timeout-fallback';
    const fallback = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/prompt') {
        return json(res, { prompt_id: promptId });
      }
      if (req.url === `/history/${promptId}`) {
        return json(res, {
          [promptId]: {
            outputs: {
              '9': { images: [{ filename: 'timeout-fallback.png', subfolder: '', type: 'output' }] },
            },
          },
        });
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(ONE_PIXEL_PNG);
    });
    try {
      const env = {
        ...process.env,
        CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
        COMFYUI_URL: primary.origin,
        CODEBUDDY_COMFYUI_FALLBACK_URLS: fallback.origin,
        CODEBUDDY_COMFYUI_ENDPOINT_TIMEOUT_MS: '250',
      } as NodeJS.ProcessEnv;
      const result = await generateImage(
        { prompt: 'Lisa portrait', aspectRatio: 'portrait' },
        { env, rootDir: tempWorkspace },
      );
      expect(result.success).toBe(true);
    } finally {
      await Promise.all([primary.close(), fallback.close()]);
    }
  });

  it('fails closed on timeout when history never produces an output', async () => {
    const promptId = 'never';
    const server = await startServer(async (req, res) => {
      if (req.url === '/prompt') return json(res, { prompt_id: promptId });
      if (req.url === `/history/${promptId}`) return json(res, {}); // never completes
      res.writeHead(404);
      res.end();
    });
    try {
      const env = {
        ...process.env,
        CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
        COMFYUI_URL: server.origin,
        CODEBUDDY_COMFYUI_TIMEOUT_MS: '0',
      } as NodeJS.ProcessEnv;
      await expect(
        generateImage({ prompt: 'x' }, { env, rootDir: tempWorkspace }),
      ).rejects.toThrow(/timed out/i);
    } finally {
      await server.close();
    }
  });
});

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

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}
