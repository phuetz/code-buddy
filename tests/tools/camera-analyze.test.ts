import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  CameraAnalyzeTool,
  resolveOllamaChatEndpoint,
  extractCompletionText,
} from '../../src/tools/registry/vision-tools.js';

describe('CameraAnalyzeTool', () => {
  let tmpImage: string;

  beforeEach(async () => {
    // 1x1 transparent PNG so the tool can read + base64 a real file.
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    tmpImage = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'camera-analyze-')), 'frame.png');
    await fs.writeFile(tmpImage, pngBytes);
  });

  afterEach(async () => {
    await fs.rm(path.dirname(tmpImage), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('captures a frame, composes a data-URL image_url message, and returns the model description', async () => {
    const captureSnapshot = vi.fn(async () => ({
      success: true as const,
      path: tmpImage,
      command: 'ffmpeg ...',
    }));

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'A red mug on a wooden desk.' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const tool = new CameraAnalyzeTool(
      {},
      { fetch: fetchMock as unknown as typeof fetch, captureSnapshot, env: {} },
    );

    const result = await tool.execute({
      prompt: 'What is on the desk?',
      device: '/dev/video0',
      model: 'gemma4:12b',
    });

    // Output is the raw description text (NOT JSON).
    expect(result.success).toBe(true);
    expect(result.output).toBe('A red mug on a wooden desk.');
    expect(result.data).toMatchObject({
      imagePath: tmpImage,
      description: 'A red mug on a wooden desk.',
      model: 'gemma4:12b',
    });

    // Capture was invoked with the requested device.
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(captureSnapshot.mock.calls[0]?.[0]).toMatchObject({ device: '/dev/video0' });

    // The fetch hit the local Ollama /v1 endpoint with a real data-URL image part.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gemma4:12b');
    const content = body.messages[0].content;
    const textPart = content.find((p: { type: string }) => p.type === 'text');
    const imagePart = content.find((p: { type: string }) => p.type === 'image_url');
    expect(textPart.text).toBe('What is on the desk?');
    expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    // The data URL must carry the actual bytes we wrote to the captured frame.
    const expectedB64 = (await fs.readFile(tmpImage)).toString('base64');
    expect(imagePart.image_url.url).toBe(`data:image/png;base64,${expectedB64}`);
  });

  it('returns a clear error when the camera capture fails (no vision call attempted)', async () => {
    const captureSnapshot = vi.fn(async () => ({
      success: false as const,
      error: 'ffmpeg: /dev/video0 busy',
      command: 'ffmpeg ...',
    }));
    const fetchMock = vi.fn();

    const tool = new CameraAnalyzeTool(
      {},
      { fetch: fetchMock as unknown as typeof fetch, captureSnapshot, env: {} },
    );

    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('ffmpeg: /dev/video0 busy');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a reachable-but-failing vision model with the captured frame path', async () => {
    const captureSnapshot = vi.fn(async () => ({
      success: true as const,
      path: tmpImage,
      command: 'ffmpeg ...',
    }));
    const fetchMock = vi.fn(async () =>
      new Response('model not found', { status: 404 }),
    );

    const tool = new CameraAnalyzeTool(
      {},
      { fetch: fetchMock as unknown as typeof fetch, captureSnapshot, env: {} },
    );

    const result = await tool.execute({ model: 'no-such-model' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 404');
    expect(result.output).toContain(tmpImage);
  });

  it('surfaces a connection error when the model endpoint is unreachable', async () => {
    const captureSnapshot = vi.fn(async () => ({
      success: true as const,
      path: tmpImage,
      command: 'ffmpeg ...',
    }));
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const tool = new CameraAnalyzeTool(
      {},
      { fetch: fetchMock as unknown as typeof fetch, captureSnapshot, env: {} },
    );

    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('unreachable');
    expect(result.error).toContain('ECONNREFUSED');
  });
});

describe('resolveOllamaChatEndpoint', () => {
  it('defaults to localhost when OLLAMA_HOST is unset', () => {
    expect(resolveOllamaChatEndpoint({})).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('prepends http:// for a bare host:port and appends /v1/chat/completions', () => {
    expect(resolveOllamaChatEndpoint({ OLLAMA_HOST: '192.168.1.50:11434' })).toBe(
      'http://192.168.1.50:11434/v1/chat/completions',
    );
  });

  it('honors an explicit scheme and strips a trailing /v1 or slash', () => {
    expect(resolveOllamaChatEndpoint({ OLLAMA_HOST: 'https://gpu.local:11434/' })).toBe(
      'https://gpu.local:11434/v1/chat/completions',
    );
    expect(resolveOllamaChatEndpoint({ OLLAMA_HOST: 'http://gpu.local:11434/v1' })).toBe(
      'http://gpu.local:11434/v1/chat/completions',
    );
  });
});

describe('extractCompletionText', () => {
  it('reads string content', () => {
    expect(
      extractCompletionText({ choices: [{ message: { content: '  hi  ' } }] }),
    ).toBe('hi');
  });

  it('reads array-of-parts content', () => {
    expect(
      extractCompletionText({
        choices: [{ message: { content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] } }],
      }),
    ).toBe('line1\nline2');
  });

  it('returns undefined for empty/malformed responses', () => {
    expect(extractCompletionText({})).toBeUndefined();
    expect(extractCompletionText({ choices: [] })).toBeUndefined();
    expect(extractCompletionText(null)).toBeUndefined();
  });
});
