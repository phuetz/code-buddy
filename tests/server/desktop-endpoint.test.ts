/**
 * Desktop WebSocket Endpoint integration test (`/desktop`).
 *
 * Simulates a real Cowork client over a real WebSocket connection against a
 * real server (port 0). Only the LLM/provider is mocked — the entire WS path
 * (handshake auth, origin/upgrade routing, ClientEvent validation, agent
 * stream → ServerEvent mapping) runs for real.
 *
 * Proves:
 *  - a `session.start` round-trip yields the expected ServerEvent sequence
 *    (session.update → session.status running → stream.partial → stream.thinking
 *     → trace.step/update → stream.message → stream.done → session.status idle)
 *  - the connection is rejected at the HTTP upgrade when no token is presented
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { generateToken } from '../../src/server/auth/jwt.js';

// Mock ONLY the LLM-backed agent. The agent's processUserMessageStream emits a
// scripted set of StreamingChunks so no provider is hit. Everything else
// (WS server, mapping, validation) is the real code under test.
vi.mock('../../src/server/agent-adapter.js', async () => {
  const processUserMessageStream = vi.fn(async function* (_input: string) {
    yield { type: 'content', content: 'Hello ' };
    yield { type: 'reasoning', reasoning: 'thinking about it' };
    yield { type: 'content', content: 'world' };
    yield {
      type: 'tool_calls',
      toolCalls: [
        { id: 'call_1', type: 'function', function: { name: 'view_file', arguments: '{"path":"a.ts"}' } },
      ],
    };
    yield {
      type: 'tool_result',
      toolCall: { id: 'call_1', type: 'function', function: { name: 'view_file', arguments: '{}' } },
      toolResult: { success: true, output: 'file contents' },
    };
    yield { type: 'done' };
  });

  return {
    createServerAgent: vi.fn(async () => ({
      processUserMessage: vi.fn(async () => []),
      processUserMessageStream,
      getChatHistory: () => [],
      getCurrentModel: () => 'mock-model',
      setModel: vi.fn(),
      executeToolByName: vi.fn(),
      systemPromptReady: Promise.resolve(),
    })),
    listServerModels: vi.fn(() => []),
    runAgentCompletion: vi.fn(),
    streamAgentDeltas: vi.fn(),
  };
});

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;
type ServerEvent = { type: string; payload?: Record<string, unknown> };

const JWT_SECRET = 'desktop-endpoint-test-secret';

describe('desktop WebSocket endpoint (/desktop)', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let previousSecret: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    previousSecret = process.env.JWT_SECRET;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-desktop-ws-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    process.env.JWT_SECRET = JWT_SECRET;
    resetDatabaseManager();
  });

  afterEach(async () => {
    if (started) {
      const { stopServer } = await import('../../src/server/index.js');
      await stopServer(started.server);
      started = null;
    }
    resetDatabaseManager();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  async function start(): Promise<string> {
    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      jwtSecret: JWT_SECRET,
      websocketEnabled: true,
      logging: false,
      rateLimit: false,
      cors: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = started.server.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}`;
  }

  async function startNoAuth(): Promise<string> {
    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: true,
      logging: false,
      rateLimit: false,
      cors: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = started.server.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}`;
  }

  function mintToken(): string {
    return generateToken({ sub: 'cowork-user', scopes: ['chat'], type: 'user' }, JWT_SECRET, '1h');
  }

  it('runs a session.start round-trip and emits the expected ServerEvents', async () => {
    const wsBase = await start();
    const token = mintToken();

    const events: ServerEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsBase}/desktop?token=${encodeURIComponent(token)}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`timed out; received: ${events.map((e) => e.type).join(', ')}`));
      }, 10_000);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'session.start',
            payload: { title: 'Test', prompt: 'hi there' },
          })
        );
      });

      ws.on('message', (data) => {
        const event = JSON.parse(data.toString()) as ServerEvent;
        events.push(event);
        // The final terminal event is session.status idle.
        if (event.type === 'session.status' && event.payload?.status === 'idle') {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const types = events.map((e) => e.type);

    // Session metadata is announced first (gives the client the canonical id).
    expect(types).toContain('session.update');
    // Running before idle.
    const runningIdx = events.findIndex(
      (e) => e.type === 'session.status' && e.payload?.status === 'running'
    );
    const idleIdx = events.findIndex(
      (e) => e.type === 'session.status' && e.payload?.status === 'idle'
    );
    expect(runningIdx).toBeGreaterThanOrEqual(0);
    expect(idleIdx).toBeGreaterThan(runningIdx);

    // Content was streamed as stream.partial deltas.
    const partials = events.filter((e) => e.type === 'stream.partial');
    expect(partials.length).toBeGreaterThanOrEqual(2);
    expect(partials.map((e) => e.payload?.delta).join('')).toBe('Hello world');

    // Reasoning mapped to stream.thinking.
    const thinking = events.filter((e) => e.type === 'stream.thinking');
    expect(thinking.length).toBe(1);
    expect(thinking[0]?.payload?.delta).toBe('thinking about it');

    // Tool call mapped to trace.step (running) then trace.update (completed).
    const traceStep = events.find((e) => e.type === 'trace.step');
    expect(traceStep?.payload?.step).toMatchObject({ toolName: 'view_file', status: 'running' });
    const traceUpdate = events.find((e) => e.type === 'trace.update');
    expect(traceUpdate?.payload?.updates).toMatchObject({ status: 'completed', isError: false });

    // Final assistant message + stream.done.
    const streamMessage = events.find((e) => e.type === 'stream.message');
    expect(streamMessage).toBeDefined();
    const message = streamMessage?.payload?.message as
      | { role: string; content: Array<{ type: string; text?: string }> }
      | undefined;
    expect(message?.role).toBe('assistant');
    const text = message?.content.find((b) => b.type === 'text');
    expect(text?.text).toBe('Hello world');

    const doneIdx = types.indexOf('stream.done');
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeLessThan(idleIdx);
  }, 20_000);

  it('rejects the upgrade with 401 when no token is presented', async () => {
    const wsBase = await start();

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const ws = new WebSocket(`${wsBase}/desktop`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('expected upgrade rejection but connection stayed open'));
      }, 8_000);

      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error('connection unexpectedly opened without a token'));
      });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        resolve(res.statusCode);
      });
      ws.on('error', () => {
        // Fallback: a rejected handshake may surface as a socket error before
        // the response is parsed. The connection still never opened.
        clearTimeout(timer);
        resolve(undefined);
      });
    });

    // When the response was parseable it must be a 401 (missing token).
    if (status !== undefined) {
      expect(status).toBe(401);
    }
  }, 15_000);

  it('leaves the existing /ws endpoint working (no regression)', async () => {
    const wsBase = await start();

    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`${wsBase}/ws`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('timed out waiting for /ws response'));
      }, 8_000);

      ws.on('open', () => {
        // The /ws handler sends a `connected` frame on open, then answers ping.
        ws.send(JSON.stringify({ type: 'ping' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === 'pong') {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    expect(reply.type).toBe('pong');
  }, 15_000);

  it('blocks proxied no-auth desktop and generic agent chat while preserving the WS peer transport', async () => {
    const wsBase = await startNoAuth();
    const headers = { 'X-Forwarded-For': '127.0.0.1' };

    const desktopStatus = await new Promise<number | undefined>((resolve, reject) => {
      const ws = new WebSocket(`${wsBase}/desktop`, { headers });
      const timer = setTimeout(() => reject(new Error('desktop upgrade stayed open')), 8_000);
      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error('proxied anonymous desktop unexpectedly opened'));
      });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        resolve(res.statusCode);
      });
      ws.on('error', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
    if (desktopStatus !== undefined) expect(desktopStatus).toBe(403);

    const chatError = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`${wsBase}/ws`, { headers });
      const timer = setTimeout(() => reject(new Error('timed out waiting for chat denial')), 8_000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'chat', payload: { message: 'read .env' } }));
      });
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type === 'error') {
          clearTimeout(timer);
          ws.close();
          resolve(message);
        }
      });
      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    expect(chatError.error).toMatchObject({ code: 'REMOTE_AUTH_REQUIRED' });
  }, 20_000);
});
