import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDatabaseManager } from '../../src/database/database-manager.js';

const REAL_SERVER_GPT55_ENABLED = process.env.CODEBUDDY_REAL_GPT55_SERVER === '1';
const MODEL = 'gpt-5.5';
const CHAT_MARKER = 'REAL-GPT55-SERVER-CHAT-ROUTE';
const COMPAT_MARKER = 'REAL-GPT55-SERVER-COMPAT-ROUTE';
const STREAM_MARKER = 'REAL-GPT55-SERVER-STREAM-ROUTE';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

async function readSseData(response: Response): Promise<string[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => chunk.slice('data: '.length));
}

function containsMarker(value: string, marker: string): boolean {
  return value.replace(/\s+/g, '').includes(marker);
}

function joinLegacySseDeltas(events: string[]): string {
  return events
    .filter((event) => event !== '[DONE]')
    .map((event) => {
      const parsed = JSON.parse(event) as { delta?: string };
      return parsed.delta ?? '';
    })
    .join('');
}

describe.skipIf(!REAL_SERVER_GPT55_ENABLED)('chat routes with real ChatGPT gpt-5.5 provider', () => {
  let tmpHome = '';
  let started: StartedServer | null = null;
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ['CODEBUDDY_HOME', 'CODEBUDDY_PROVIDER', 'CHATGPT_MODEL', 'GROK_MODEL']) {
      previousEnv.set(key, process.env[key]);
    }
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-real-gpt55-server-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    process.env.CHATGPT_MODEL = MODEL;
    process.env.GROK_MODEL = MODEL;
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
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  async function start(): Promise<string> {
    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = started.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it('serves real /api/chat, SSE, completions, and model listing through ChatGPT OAuth', async () => {
    const baseUrl = await start();

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        sessionId: 'real-gpt55-server-chat',
        messages: [{ role: 'user', content: `Reply exactly: ${CHAT_MARKER}` }],
      }),
    });
    const chatBody = (await chatResponse.json()) as { content: string; model: string; latency: number };
    expect(chatResponse.status).toBe(200);
    expect(containsMarker(chatBody.content, CHAT_MARKER)).toBe(true);
    expect(chatBody.model).toBe(MODEL);
    expect(chatBody.latency).toBeGreaterThanOrEqual(0);

    const streamResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [{ role: 'user', content: `Reply exactly: ${STREAM_MARKER}` }],
      }),
    });
    const streamEvents = await readSseData(streamResponse);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');
    expect(containsMarker(joinLegacySseDeltas(streamEvents), STREAM_MARKER)).toBe(true);
    expect(streamEvents.at(-1)).toBe('[DONE]');

    const completionResponse = await fetch(`${baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: `Reply exactly: ${COMPAT_MARKER}` }],
      }),
    });
    const completionBody = (await completionResponse.json()) as {
      object: string;
      model: string;
      choices: Array<{ message: { content: string } }>;
      usage: { total_tokens: number };
    };
    expect(completionResponse.status).toBe(200);
    expect(completionBody.object).toBe('chat.completion');
    expect(completionBody.model).toBe(MODEL);
    expect(containsMarker(completionBody.choices[0].message.content, COMPAT_MARKER)).toBe(true);
    expect(completionBody.usage.total_tokens).toBeGreaterThan(0);

    const modelsResponse = await fetch(`${baseUrl}/api/chat/models`);
    const modelsBody = (await modelsResponse.json()) as { data: Array<{ id: string; owned_by: string }> };
    expect(modelsResponse.status).toBe(200);
    expect(modelsBody.data[0]).toMatchObject({ id: MODEL, owned_by: 'chatgpt' });
  }, 240_000);
});
