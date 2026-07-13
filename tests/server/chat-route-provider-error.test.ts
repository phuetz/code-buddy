import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDatabaseManager } from '../../src/database/database-manager.js';

vi.mock('../../src/server/agent-adapter.js', async () => {
  const currentModel = 'qa-provider-error-model';
  const processUserMessage = vi.fn(async (input: string) => [
    { type: 'assistant', content: `SERVER_PROVIDER_ERROR_OK:${input}` },
  ]);
  const processUserMessageStream = vi.fn(async function* (input: string) {
    if (input.includes('QA_STREAM_RATE_LIMIT')) {
      const error = new Error('qa stream provider rate limit') as Error & {
        statusCode?: number;
        retryAfter?: number;
      };
      error.statusCode = 429;
      error.retryAfter = 19;
      throw error;
    }
    yield { type: 'content', content: `SERVER_PROVIDER_STREAM_OK:${input}` };
  });

  function makeProviderError(input: string): Error | null {
    if (input.includes('QA_PROVIDER_RATE_LIMIT')) {
      const error = new Error('qa provider 429 rate limit') as Error & {
        code?: string;
        statusCode?: number;
        retryAfter?: number;
      };
      error.code = 'RATE_LIMIT_EXCEEDED';
      error.statusCode = 429;
      error.retryAfter = 17;
      return error;
    }
    if (input.includes('QA_PROVIDER_UNAVAILABLE')) {
      const error = new Error('qa provider 503 unavailable') as Error & {
        statusCode?: number;
      };
      error.statusCode = 503;
      return error;
    }
    return null;
  }

  return {
    createServerAgent: vi.fn(async () => ({
      processUserMessage,
      processUserMessageStream,
      getChatHistory: () => [],
      getCurrentModel: () => currentModel,
      setModel: vi.fn(),
      executeToolByName: vi.fn(),
      systemPromptReady: Promise.resolve(),
    })),
    listServerModels: vi.fn(() => [
      {
        id: currentModel,
        object: 'model',
        created: 1_779_000_000,
        owned_by: 'qa-fixture',
      },
    ]),
    runAgentCompletion: vi.fn(async (_agent: unknown, input: string) => {
      const error = makeProviderError(input);
      if (error) {
        throw error;
      }
      return {
        content: `SERVER_PROVIDER_ERROR_OK:${input}`,
        finishReason: 'stop',
      };
    }),
    streamAgentDeltas: vi.fn(async function* (_agent: unknown, input: string) {
      if (input.includes('QA_STREAM_RATE_LIMIT')) {
        const error = new Error('qa stream provider rate limit') as Error & {
          statusCode?: number;
          retryAfter?: number;
        };
        error.statusCode = 429;
        error.retryAfter = 19;
        throw error;
      }
      yield `SERVER_PROVIDER_STREAM_OK:${input}`;
    }),
  };
});

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('chat routes provider error statuses', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-provider-error-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();
  });

  afterEach(async () => {
    if (started) {
      await new Promise<void>((resolve, reject) => {
        started?.server.close((error) => (error ? reject(error) : resolve()));
      });
      started = null;
    }
    resetDatabaseManager();
    if (previousHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = previousHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  async function start(options: { rateLimit?: boolean } = {}): Promise<string> {
    const { startServer } = await import('../../src/server/index.js');
    const keyPrefix = `qa-provider-error-${Date.now()}-${Math.random()}`;
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: false,
      logging: false,
      rateLimit: options.rateLimit ?? false,
      rateLimitMax: 100,
      rateLimitWindow: 60_000,
      routeRateLimits: {
        '/api/chat': {
          maxRequests: 1,
          windowMs: 60_000,
          keyPrefix,
        },
      },
      cors: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = started.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it('returns a structured 429 for provider rate limits on /api/chat', async () => {
    const baseUrl = await start();

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'QA_PROVIDER_RATE_LIMIT' }],
      }),
    });
    const body = (await response.json()) as {
      code: string;
      status: number;
      message: string;
      details?: { providerStatus?: number; retryAfter?: number };
    };

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.status).toBe(429);
    expect(body.message).toContain('qa provider 429 rate limit');
    expect(body.details).toMatchObject({
      providerStatus: 429,
      retryAfter: 17,
    });
  }, 30_000);

  it('returns OpenAI-compatible 503 metadata for upstream provider failures', async () => {
    const baseUrl = await start();

    const response = await fetch(`${baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qa-openai-provider-status-model',
        messages: [{ role: 'user', content: 'QA_PROVIDER_UNAVAILABLE' }],
      }),
    });
    const body = (await response.json()) as {
      error: {
        message: string;
        type: string;
        code: string;
        details?: { providerStatus?: number };
      };
    };

    expect(response.status).toBe(503);
    expect(body.error.message).toContain('qa provider 503 unavailable');
    expect(body.error.type).toBe('server_error');
    expect(body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(body.error.details).toMatchObject({ providerStatus: 503 });
  }, 15_000);

  it('returns OpenAI-compatible 429 metadata for upstream provider rate limits', async () => {
    const baseUrl = await start();

    const response = await fetch(`${baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qa-openai-rate-limit-model',
        messages: [{ role: 'user', content: 'QA_PROVIDER_RATE_LIMIT' }],
      }),
    });
    const body = (await response.json()) as {
      error: {
        message: string;
        type: string;
        code: string;
        details?: { providerStatus?: number; retryAfter?: number };
      };
    };

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(body.error.message).toContain('qa provider 429 rate limit');
    expect(body.error.type).toBe('rate_limit_error');
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.details).toMatchObject({
      providerStatus: 429,
      retryAfter: 17,
    });
  }, 15_000);

  it('keeps server-side route rate limits distinct from provider limits', async () => {
    const baseUrl = await start({ rateLimit: true });
    const payload = {
      messages: [{ role: 'user', content: 'QA_PROVIDER_SUCCESS' }],
    };

    const first = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await second.json()) as {
      code: string;
      status: number;
      details?: { limit?: number; retryAfter?: number; route?: string };
    };

    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
    expect(second.headers.get('x-ratelimit-limit')).toBe('1');
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.status).toBe(429);
    expect(body.details).toMatchObject({
      limit: 1,
      route: '/api/chat',
    });
  }, 15_000);
});
