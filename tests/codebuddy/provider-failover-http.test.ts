/**
 * Integration: declared failover against loopback OpenAI-compat fakes.
 * No openai module mock — the real SDK talks HTTP.
 */
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { getGlobalEventBus, resetEventBus } from '../../src/events/event-bus.js';
import {
  readProviderHealthSnapshot,
  resetProviderHealthStoreForTests,
  setProviderHealthPathForTests,
} from '../../src/providers/provider-health.js';

const QA_TMP = path.join(process.cwd(), '_qa', 'fb', 'tmp');

const ENV_KEYS = [
  'CODEBUDDY_PROVIDER_FALLBACK',
  'CODEBUDDY_FALLBACK_CHAIN',
  'CODEBUDDY_FALLBACK_PROVIDERS',
  'CODEBUDDY_LOCAL_ONLY',
  'CODEBUDDY_STREAM_RETRY',
  'OLLAMA_HOST',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const;

function okBody(content = 'OK'): string {
  return JSON.stringify({
    id: 'chatcmpl-fb',
    object: 'chat.completion',
    created: 1,
    model: 'backup',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function quotaBody(): string {
  return JSON.stringify({
    error: {
      message: 'You have reached your usage limit',
      type: 'usage_limit_reached',
      code: 'usage_limit_reached',
      resets_in_seconds: 73172,
    },
  });
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  return address.port;
}

function startFakeChat(respond: (res: http.ServerResponse) => void): Promise<{
  port: number;
  hits: { count: number };
  close: () => Promise<void>;
}> {
  const hits = { count: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(chunk as Buffer);
    });
    req.on('end', () => {
      hits.count += 1;
      if (req.method === 'POST' && (req.url ?? '').includes('/chat/completions')) {
        respond(res);
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return listen(server).then((port) => ({
    port,
    hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  }));
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('expected TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

describe('declared failover over loopback HTTP', () => {
  let tmp: string;
  let previousHome: string | undefined;
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    tmp = makeTmpDir('fb-http-', QA_TMP);
    previousHome = process.env.HOME;
    process.env.HOME = tmp;
    setProviderHealthPathForTests(path.join(tmp, '.codebuddy', 'provider-health.json'));
    resetProviderHealthStoreForTests();
    resetEventBus();
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
  });

  afterEach(() => {
    resetProviderHealthStoreForTests();
    setProviderHealthPathForTests(undefined);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    for (const key of ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEventBus();
    removeTmpDir(tmp);
  });

  it('unreachable primary (ECONNREFUSED) → ollama @url fake, emits [fallback] + OK', async () => {
    const backup = await startFakeChat((res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody());
    });
    const dead = await closedPort();
    process.env.CODEBUDDY_FALLBACK_CHAIN =
      `ollama:backup@http://127.0.0.1:${backup.port}`;

    const bus: Array<{ fromProvider?: string; toProvider?: string; resetsAt?: number }> = [];
    getGlobalEventBus().on('provider:fallback', (evt) => bus.push(evt));

    try {
      const client = new CodeBuddyClient(
        'sk-test',
        'primary-model',
        `http://127.0.0.1:${dead}/v1`,
        { enableCredentialPool: false },
      );
      const response = await client.chat([{ role: 'user', content: 'Réponds: OK' }], []);
      expect(response.choices[0]?.message.content).toBe('OK');
      expect(backup.hits.count).toBeGreaterThan(0);
      expect(bus.some((e) => e.toProvider === 'ollama' && typeof e.resetsAt === 'number')).toBe(true);
      expect(readProviderHealthSnapshot().lastFailover).toMatchObject({
        to: 'ollama',
        toModel: 'backup',
        kind: 'unreachable',
      });
    } finally {
      await backup.close();
    }
  }, 20_000);

  it('429 usage_limit_reached fake → ollama @url fake, quota_exhausted + OK', async () => {
    const quota = await startFakeChat((res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(quotaBody());
    });
    const backup = await startFakeChat((res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody());
    });
    process.env.CODEBUDDY_FALLBACK_CHAIN =
      `ollama:backup@http://127.0.0.1:${backup.port}`;

    const bus: Array<{
      fromProvider?: string;
      toProvider?: string;
      reason?: string;
      resetsAt?: number;
      resets_at?: number;
    }> = [];
    getGlobalEventBus().on('provider:fallback', (evt) => bus.push(evt));

    try {
      const client = new CodeBuddyClient(
        'sk-test',
        'gpt-4o',
        `http://127.0.0.1:${quota.port}/v1`,
        { enableCredentialPool: false },
      );
      const response = await client.chat([{ role: 'user', content: 'Réponds: OK' }], []);
      expect(response.choices[0]?.message.content).toBe('OK');
      expect(quota.hits.count).toBeGreaterThan(0);
      expect(backup.hits.count).toBeGreaterThan(0);
      expect(bus.some((e) => e.toProvider === 'ollama' && e.reason === 'quota_exhausted')).toBe(true);
      expect(bus.some((e) => typeof e.resetsAt === 'number' && e.resets_at === e.resetsAt)).toBe(true);
      expect(readProviderHealthSnapshot().lastFailover).toMatchObject({
        to: 'ollama',
        kind: 'quota_exhausted',
      });
    } finally {
      await Promise.all([quota.close(), backup.close()]);
    }
  }, 20_000);
});
