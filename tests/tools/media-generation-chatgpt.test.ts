import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateImage,
  editImage,
  getImageEditCapabilities,
  resolveImageProvider,
  parseChatGptImageResponse,
  type MediaGenerationRuntime,
} from '../../src/tools/media-generation-tool.js';
import * as codexOAuth from '../../src/providers/codex-oauth.js';

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==';

const SAMPLE_SSE_STREAM = [
  'event: response.created',
  'data: {"type":"response.created","response":{"id":"resp_123"}}',
  '',
  'event: response.output_item.added',
  'data: {"type":"response.output_item.added","item":{"id":"ig_123","type":"image_generation_call","status":"in_progress"}}',
  '',
  'event: response.output_item.done',
  `data: {"type":"response.output_item.done","item":{"id":"ig_123","type":"image_generation_call","status":"completed","revised_prompt":"A vibrant red sphere","result":"${SAMPLE_PNG_BASE64}"}}`,
  '',
  'event: response.completed',
  'data: {"type":"response.completed","response":{"status":"completed"}}',
  '',
].join('\n');

describe('ChatGPT image generation provider', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-chatgpt-img-'));
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  describe('resolveImageProvider', () => {
    it('selects chatgpt when explicitly requested with CODEBUDDY_IMAGE_PROVIDER=chatgpt', () => {
      const config = resolveImageProvider(
        { CODEBUDDY_IMAGE_PROVIDER: 'chatgpt' },
        { hasAuthOverride: true },
      );
      expect(config.provider).toBe('chatgpt');
      expect(config.model).toBe('gpt-image-2.5-flare');
      expect(config.baseUrl).toContain('https://chatgpt.com/backend-api/codex/responses');
    });

    it('throws a helpful message when chatgpt is requested but no credentials exist', () => {
      vi.spyOn(codexOAuth, 'hasCodexCredentials').mockReturnValue(false);
      expect(() =>
        resolveImageProvider({ CODEBUDDY_IMAGE_PROVIDER: 'chatgpt' }, { hasAuthOverride: false }),
      ).toThrowError(/No ChatGPT credentials found for provider chatgpt\. Run `buddy login`/);
    });

    it('auto-selects chatgpt when no API keys are present and codex credentials exist', () => {
      const config = resolveImageProvider(
        {
          OPENAI_API_KEY: '',
          XAI_API_KEY: '',
          FAL_KEY: '',
          CODEBUDDY_IMAGE_PROVIDER: '',
        },
        { hasAuthOverride: true },
      );
      expect(config.provider).toBe('chatgpt');
      expect(config.model).toBe('gpt-image-2.5-flare');
    });

    it('preserves openai provider when OPENAI_API_KEY is present without explicit provider', () => {
      const config = resolveImageProvider(
        {
          OPENAI_API_KEY: 'sk-openai-test-key',
          CODEBUDDY_IMAGE_PROVIDER: '',
        },
        { hasAuthOverride: true },
      );
      expect(config.provider).toBe('openai');
      expect(config.apiKey).toBe('sk-openai-test-key');
    });

    it('preserves xai provider when XAI_API_KEY is present and CODEBUDDY_IMAGE_PROVIDER=xai', () => {
      const config = resolveImageProvider(
        {
          XAI_API_KEY: 'xai-test-key',
          CODEBUDDY_IMAGE_PROVIDER: 'xai',
        },
        { hasAuthOverride: true },
      );
      expect(config.provider).toBe('xai');
      expect(config.apiKey).toBe('xai-test-key');
    });
  });

  describe('parseChatGptImageResponse', () => {
    it('extracts base64 and revised prompt from SSE event stream', () => {
      const parsed = parseChatGptImageResponse(SAMPLE_SSE_STREAM);
      expect(parsed.b64).toBe(SAMPLE_PNG_BASE64);
      expect(parsed.revisedPrompt).toBe('A vibrant red sphere');
    });

    it('extracts base64 from direct JSON response', () => {
      const jsonResponse = JSON.stringify({
        created: 123456789,
        data: [{ b64_json: SAMPLE_PNG_BASE64, revised_prompt: 'Direct JSON prompt' }],
      });
      const parsed = parseChatGptImageResponse(jsonResponse);
      expect(parsed.b64).toBe(SAMPLE_PNG_BASE64);
      expect(parsed.revisedPrompt).toBe('Direct JSON prompt');
    });

    it('throws clear error when SSE stream contains error event', () => {
      const errorStream = [
        'event: response.failed',
        'data: {"type":"response.failed","response":{"error":{"message":"Safety policy violation"}}}',
      ].join('\n');
      expect(() => parseChatGptImageResponse(errorStream)).toThrowError(
        /ChatGPT image response failed: Safety policy violation/,
      );
    });

    it('throws when payload has no image data', () => {
      const emptyStream = 'data: {"type":"response.output_item.done","item":{"type":"message"}}\n';
      expect(() => parseChatGptImageResponse(emptyStream)).toThrowError(
        /ChatGPT image generation response did not contain image data/,
      );
    });
  });

  describe('generateImage with mock fetch', () => {
    it('sends correct headers and body to /responses and saves generated PNG and sidecar', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: Record<string, unknown> = {};

      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(SAMPLE_SSE_STREAM, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }) as unknown as typeof fetch;

      const runtime: MediaGenerationRuntime = {
        rootDir: tempDir,
        fetch: mockFetch,
        chatGptAuth: {
          access_token: 'fake-access-token-123',
          account_id: 'fake-account-id-456',
        },
        env: {
          CODEBUDDY_IMAGE_PROVIDER: 'chatgpt',
        },
      };

      const result = await generateImage(
        { prompt: 'A red circle', aspectRatio: 'square' },
        runtime,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(capturedUrl).toContain('https://chatgpt.com/backend-api/codex/responses');
      expect(capturedHeaders['Authorization']).toBe('Bearer fake-access-token-123');
      expect(capturedHeaders['ChatGPT-Account-ID']).toBe('fake-account-id-456');
      expect(capturedHeaders['originator']).toBe('codex_cli_rs');
      expect(capturedHeaders['Accept']).toBe('text/event-stream');

      // Verify request payload shape
      expect(capturedBody.store).toBe(false);
      expect(capturedBody.stream).toBe(true);
      expect(capturedBody.tools).toEqual([{ type: 'image_generation', model: 'gpt-image-2.5-flare' }]);
      const input = capturedBody.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(1);
      expect(input[0]?.type).toBe('message');
      expect(input[0]?.role).toBe('user');
      const content = input[0]?.content as Array<{ type: string; text?: string }>;
      expect(content[0]?.type).toBe('input_text');
      expect(content[0]?.text).toContain('A red circle');
      expect(content[0]?.text).toContain('square 1:1');

      // Verify generated result
      expect(result.success).toBe(true);
      expect(result.provider).toBe('chatgpt');
      expect(result.model).toBe('gpt-image-2.5-flare');
      expect(result.aspect_ratio).toBe('square');
      expect(result.revised_prompt).toBe('A vibrant red sphere');
      expect(result.outputPath).toBeDefined();

      // Verify saved file on disk
      const fileBytes = await fs.readFile(result.outputPath!);
      expect(fileBytes.length).toBeGreaterThan(0);

      // Verify sidecar .meta.json
      const metaPath = `${result.outputPath}.meta.json`;
      const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      expect(metaContent.provider).toBe('chatgpt');
      expect(metaContent.model).toBe('gpt-image-2.5-flare');
      expect(metaContent.aspect_ratio).toBe('square');
      expect(metaContent.prompt).toBe('A red circle');
    });

    it('retries once on 401 when refreshChatGptAuth succeeds', async () => {
      let callCount = 0;
      const mockFetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify({ error: { message: 'token_expired' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(SAMPLE_SSE_STREAM, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }) as unknown as typeof fetch;

      vi.spyOn(codexOAuth, 'refreshChatGptAuth').mockResolvedValue({
        access_token: 'refreshed-token-xyz',
        account_id: 'fake-account-id-456',
      });

      const runtime: MediaGenerationRuntime = {
        rootDir: tempDir,
        fetch: mockFetch,
        chatGptAuth: {
          access_token: 'initial-expired-token',
        },
        env: {
          CODEBUDDY_IMAGE_PROVIDER: 'chatgpt',
        },
      };

      const result = await generateImage({ prompt: 'Retry test' }, runtime);
      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
      expect(codexOAuth.refreshChatGptAuth).toHaveBeenCalledTimes(1);
    });

    it('throws friendly rate limit message on 429', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({ error: { message: 'Monthly image generation quota exceeded' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      const runtime: MediaGenerationRuntime = {
        rootDir: tempDir,
        fetch: mockFetch,
        chatGptAuth: { access_token: 'test-token' },
        env: { CODEBUDDY_IMAGE_PROVIDER: 'chatgpt' },
      };

      await expect(generateImage({ prompt: 'Rate limit test' }, runtime)).rejects.toThrowError(
        /ChatGPT image generation rate limit reached \(429\): Monthly image generation quota exceeded/,
      );
    });
  });

  describe('editImage with mock fetch', () => {
    it('sends input_image and input_text in user message and saves edited image', async () => {
      let capturedBody: Record<string, unknown> = {};

      const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(SAMPLE_SSE_STREAM, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }) as unknown as typeof fetch;

      const runtime: MediaGenerationRuntime = {
        rootDir: tempDir,
        fetch: mockFetch,
        chatGptAuth: { access_token: 'test-token' },
        env: { CODEBUDDY_IMAGE_PROVIDER: 'chatgpt' },
      };

      const sourceDataUrl = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;
      const result = await editImage(
        {
          prompt: 'Make it blue',
          imageUrl: sourceDataUrl,
          selections: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }],
        },
        runtime,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const input = capturedBody.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(1);
      const content = input[0]?.content as Array<Record<string, string>>;
      expect(content).toHaveLength(2);
      expect(content[0]?.type).toBe('input_text');
      expect(content[0]?.text).toContain('Make it blue');
      expect(content[0]?.text).toContain('Preserve everything outside');
      expect(content[1]?.type).toBe('input_image');
      expect(content[1]?.image_url).toBe(sourceDataUrl);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('chatgpt');
      expect(result.model).toBe('gpt-image-2.5-flare');
      expect(result.maskMode).toBe('region-prompt');
      expect(result.outputPath).toBeDefined();

      const metaPath = `${result.outputPath}.meta.json`;
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      expect(meta.provider).toBe('chatgpt');
      expect(meta.model).toBe('gpt-image-2.5-flare');
      expect(meta.maskMode).toBe('region-prompt');
    });

    it('reports edit capabilities correctly for chatgpt', async () => {
      const caps = await getImageEditCapabilities({
        chatGptAuth: { access_token: 'token' },
        env: { CODEBUDDY_IMAGE_PROVIDER: 'chatgpt' },
      });
      expect(caps.provider).toBe('chatgpt');
      expect(caps.available).toBe(true);
      expect(caps.alphaMasking).toBe(false);
    });
  });

  describe('Live test with real backend (gated by CODEBUDDY_LIVE_CHATGPT_IMAGE)', () => {
    const isLive = process.env.CODEBUDDY_LIVE_CHATGPT_IMAGE === 'true';
    const hasCreds = codexOAuth.hasCodexCredentials();

    it.runIf(isLive && hasCreds)(
      'generates a real image via chatgpt backend and outputs a valid PNG (>1000 bytes)',
      async () => {
        const result = await generateImage({
          prompt: 'A small red cube on white background',
          aspectRatio: 'square',
        });

        expect(result.success).toBe(true);
        expect(result.provider).toBe('chatgpt');
        expect(result.model).toBe('gpt-image-2.5-flare');
        expect(result.outputPath).toBeDefined();

        const stat = await fs.stat(result.outputPath!);
        expect(stat.size).toBeGreaterThan(1000);

        // Check PNG signature
        const fd = await fs.open(result.outputPath!, 'r');
        const header = Buffer.alloc(8);
        await fd.read(header, 0, 8, 0);
        await fd.close();
        expect(header[0]).toBe(0x89);
        expect(header[1]).toBe(0x50); // P
        expect(header[2]).toBe(0x4e); // N
        expect(header[3]).toBe(0x47); // G

        const metaPath = `${result.outputPath}.meta.json`;
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        expect(meta.provider).toBe('chatgpt');
        expect(meta.model).toBe('gpt-image-2.5-flare');
      },
      120_000,
    );
  });
});
