import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import {
  ImageGenerateTool,
  VideoAnalyzeTool,
  VideoGenerateTool,
} from '../../src/tools/registry/multimodal-tools.js';

const ONE_PIXEL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==';
const MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
]);

let tempWorkspace: string;
let originalEnv: NodeJS.ProcessEnv;

describe('Hermes media generation real integrations', () => {
  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-media-real-'));
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('generates and caches an image through a real HTTP image endpoint', async () => {
    const captured: Record<string, unknown>[] = [];
    const server = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/images/generations') {
        captured.push(await readJson(req));
        sendJson(res, {
          data: [{
            b64_json: ONE_PIXEL_PNG_B64,
            revised_prompt: 'A tiny generated square.',
          }],
        });
        return;
      }
      sendNotFound(res);
    });

    try {
      process.env.CODEBUDDY_IMAGE_PROVIDER = 'openai';
      process.env.CODEBUDDY_IMAGE_BASE_URL = `${server.origin}/v1`;
      process.env.CODEBUDDY_IMAGE_API_KEY = 'test-image-key';
      process.env.CODEBUDDY_IMAGE_MODEL = 'gpt-image-2-medium';

      const tool = new ImageGenerateTool({
        rootDir: tempWorkspace,
        now: () => new Date('2026-05-30T22:00:00.000Z'),
        createId: () => 'image-real',
      });
      const result = await tool.execute({
        prompt: 'A red square on a white background',
        aspect_ratio: 'square',
      }, { cwd: tempWorkspace });

      expect(result.success, result.error).toBe(true);
      const payload = parseOutput<{
        kind: string;
        success: boolean;
        image: string;
        mediaPath: string;
        outputPath: string;
        provider: string;
        model: string;
        aspect_ratio: string;
      }>(result);
      expect(payload).toMatchObject({
        kind: 'image_generate_result',
        success: true,
        provider: 'openai',
        model: 'gpt-image-2-medium',
        aspect_ratio: 'square',
      });
      expect(payload.mediaPath).toBe(`MEDIA:${payload.outputPath}`);
      expect(payload.image).toBe(payload.outputPath);
      const bytes = await fs.readFile(payload.outputPath);
      expect(bytes.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
      expect(captured[0]).toMatchObject({
        model: 'gpt-image-2-medium',
        prompt: 'A red square on a white background',
        size: '1024x1024',
        n: 1,
      });
    } finally {
      await server.close();
    }
  });

  it('generates and caches an image-to-video result through a real HTTP video endpoint', async () => {
    const captured: Record<string, unknown>[] = [];
    const server = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/videos/generations') {
        captured.push(await readJson(req));
        sendJson(res, { request_id: 'vid-1' });
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/videos/vid-1') {
        sendJson(res, {
          status: 'done',
          model: 'grok-imagine-video',
          video: {
            url: `${server.origin}/asset/video.mp4`,
            duration: 15,
          },
        });
        return;
      }
      if (req.method === 'GET' && req.url === '/asset/video.mp4') {
        res.writeHead(200, { 'Content-Type': 'video/mp4' });
        res.end(MP4_BYTES);
        return;
      }
      sendNotFound(res);
    });

    try {
      process.env.CODEBUDDY_VIDEO_PROVIDER = 'xai';
      process.env.CODEBUDDY_VIDEO_BASE_URL = `${server.origin}/v1`;
      process.env.CODEBUDDY_VIDEO_API_KEY = 'test-video-key';
      process.env.CODEBUDDY_VIDEO_MODEL = 'grok-imagine-video';
      process.env.CODEBUDDY_VIDEO_POLL_INTERVAL_MS = '100';

      const tool = new VideoGenerateTool({
        rootDir: tempWorkspace,
        now: () => new Date('2026-05-30T22:05:00.000Z'),
        createId: () => 'video-real',
      });
      const result = await tool.execute({
        prompt: 'Animate this diagram with a slow camera push',
        image_url: `${server.origin}/asset/source.png`,
        duration: 20,
        aspect_ratio: '16:9',
        resolution: '720p',
      }, { cwd: tempWorkspace });

      expect(result.success, result.error).toBe(true);
      const payload = parseOutput<{
        kind: string;
        success: boolean;
        video: string;
        mediaPath: string;
        outputPath: string;
        provider: string;
        modality: string;
        duration: number;
        request_id: string;
      }>(result);
      expect(payload).toMatchObject({
        kind: 'video_generate_result',
        success: true,
        provider: 'xai',
        modality: 'image',
        duration: 15,
        request_id: 'vid-1',
      });
      expect(payload.mediaPath).toBe(`MEDIA:${payload.outputPath}`);
      expect(payload.video).toBe(payload.outputPath);
      await expect(fs.readFile(payload.outputPath)).resolves.toEqual(MP4_BYTES);
      expect(captured[0]).toMatchObject({
        model: 'grok-imagine-video',
        prompt: 'Animate this diagram with a slow camera push',
        duration: 15,
        aspect_ratio: '16:9',
        resolution: '720p',
        image: { url: `${server.origin}/asset/source.png` },
      });
    } finally {
      await server.close();
    }
  });

  it('analyzes a local video through a real OpenAI-compatible video endpoint', async () => {
    const videoPath = path.join(tempWorkspace, 'clip.mp4');
    await fs.writeFile(videoPath, MP4_BYTES);
    const captured: Record<string, unknown>[] = [];
    const server = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        captured.push(await readJson(req));
        sendJson(res, {
          choices: [{
            message: {
              content: 'The video is a tiny MP4 fixture; no visible action is present.',
            },
          }],
        });
        return;
      }
      sendNotFound(res);
    });

    try {
      process.env.CODEBUDDY_VIDEO_ANALYSIS_BASE_URL = `${server.origin}/v1`;
      process.env.CODEBUDDY_VIDEO_ANALYSIS_API_KEY = 'test-analysis-key';
      process.env.CODEBUDDY_VIDEO_ANALYSIS_MODEL = 'gemini-video-compatible';

      const tool = new VideoAnalyzeTool({
        rootDir: tempWorkspace,
        now: () => new Date('2026-05-30T22:10:00.000Z'),
        createId: () => 'analysis-real',
      });
      const result = await tool.execute({
        video_url: videoPath,
        question: 'What happens in this clip?',
      }, { cwd: tempWorkspace });

      expect(result.success, result.error).toBe(true);
      const payload = parseOutput<{
        kind: string;
        success: boolean;
        analysis: string;
        model: string;
        mimeType: string;
        videoSizeBytes: number;
      }>(result);
      expect(payload).toMatchObject({
        kind: 'video_analyze_result',
        success: true,
        model: 'gemini-video-compatible',
        mimeType: 'video/mp4',
        videoSizeBytes: MP4_BYTES.length,
      });
      expect(payload.analysis).toContain('tiny MP4 fixture');

      const body = captured[0];
      expect(body).toMatchObject({ model: 'gemini-video-compatible' });
      const messages = body?.messages as Array<{ content: Array<Record<string, unknown>> }> | undefined;
      expect(messages?.[0]?.content?.[0]).toMatchObject({
        type: 'text',
      });
      expect(String(messages?.[0]?.content?.[0]?.text)).toContain('What happens in this clip?');
      expect(messages?.[0]?.content?.[1]).toMatchObject({
        type: 'video_url',
        video_url: {
          url: expect.stringMatching(/^data:video\/mp4;base64,/),
        },
      });
    } finally {
      await server.close();
    }
  });

  it('marks official Hermes media generation and video analysis tools as exact local tools', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T22:20:00.000Z');
    for (const name of ['image_generate', 'video_analyze', 'video_generate']) {
      expect(manifest.tools).toContainEqual(expect.objectContaining({
        name,
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining([name]),
      }));
    }
  });
});

function parseOutput<T>(result: { success: boolean; output?: string; error?: string }): T {
  expect(result.success, result.error).toBe(true);
  expect(result.output).toBeTruthy();
  return JSON.parse(result.output as string) as T;
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
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
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

function sendJson(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendNotFound(res: http.ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}
