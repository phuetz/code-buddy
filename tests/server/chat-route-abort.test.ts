import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDatabaseManager } from '../../src/database/database-manager.js';

const streamControls = vi.hoisted(() => ({
  abortCalls: vi.fn(),
  started: vi.fn(),
  finalized: vi.fn(),
  release: null as (() => void) | null,
}));

const adapterMocks = vi.hoisted(() => ({
  createServerAgent: vi.fn(),
}));

vi.mock('../../src/server/agent-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/server/agent-adapter.js')>(
    '../../src/server/agent-adapter.js',
  );

  function emptyState() {
    return {
      messages: [],
      chatHistory: [],
      sessionCost: 0,
      routingSessionCost: 0,
      workingDirectory: process.cwd(),
      contextManagerState: {
        summaries: [], systemMessage: null, triggeredWarnings: [], lastTokenCount: 0,
        lastEnhancedResult: null, sessionId: 'abort-neutral', peakMessageCount: 0,
        compressionCount: 0, totalTokensSaved: 0, lastCompressionTime: null,
        snapshotCount: 0, enhancedCompression: null,
      },
    };
  }

  adapterMocks.createServerAgent.mockImplementation(async () => {
    let state = emptyState();
    return {
      processUserMessage: vi.fn(async (input: string) => [
        { type: 'assistant', content: `NEXT_OK:${input}` },
      ]),
      processUserMessageStream: vi.fn(async function* (input: string) {
        if (input === 'BLOCK_UNTIL_ABORT') {
          streamControls.started();
          try {
            yield { type: 'content', content: 'STREAM_STARTED' };
            await new Promise<void>((resolve) => {
              streamControls.release = resolve;
            });
          } finally {
            streamControls.finalized();
          }
          return;
        }
        yield { type: 'content', content: `STREAM_OK:${input}` };
      }),
      getChatHistory: () => structuredClone(state.chatHistory),
      getCurrentModel: () => 'abort-test-model',
      setModel: vi.fn(),
      setRecoverySessionId: vi.fn(),
      addToHistory: (message: never) => state.messages.push(message),
      exportConversationState: () => structuredClone(state),
      importConversationState: (next: ReturnType<typeof emptyState>) => {
        state = structuredClone(next);
      },
      abortCurrentOperation: () => {
        streamControls.abortCalls();
        streamControls.release?.();
      },
      executeToolByName: vi.fn(async () => ({ success: true })),
      systemPromptReady: Promise.resolve(),
      dispose: vi.fn(),
    };
  });

  return {
    ...actual,
    createServerAgent: adapterMocks.createServerAgent,
  };
});

import { __resetHttpAgentSessionCacheForTests } from '../../src/server/http-agent-sessions.js';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('HTTP SSE disconnect cancellation', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-chat-abort-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    streamControls.abortCalls.mockClear();
    streamControls.started.mockClear();
    streamControls.finalized.mockClear();
    streamControls.release = null;
    adapterMocks.createServerAgent.mockClear();
    resetDatabaseManager();
  });

  afterEach(async () => {
    await __resetHttpAgentSessionCacheForTests();
    if (started) {
      await new Promise<void>((resolve, reject) => {
        started?.server.close((error) => (error ? reject(error) : resolve()));
      });
      started = null;
    }
    resetDatabaseManager();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
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

  it('aborts a blocked stream, closes its iterator, and releases the next session', async () => {
    const baseUrl = await start();
    const controller = new AbortController();
    const blockedResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        sessionId: 'blocked-session',
        messages: [{ role: 'user', content: 'BLOCK_UNTIL_ABORT' }],
      }),
      signal: controller.signal,
    });
    const reader = blockedResponse.body?.getReader();
    expect(reader).toBeDefined();
    const firstChunk = await reader!.read();
    expect(new TextDecoder().decode(firstChunk.value)).toContain('STREAM_STARTED');

    controller.abort();
    await vi.waitFor(() => expect(streamControls.abortCalls).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(streamControls.finalized).toHaveBeenCalledTimes(1));

    const nextResponse = await Promise.race([
      fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'next-session',
          messages: [{ role: 'user', content: 'NEXT_REQUEST' }],
        }),
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('next HTTP session remained blocked')), 2_000);
      }),
    ]);
    const nextBody = (await nextResponse.json()) as { content: string };
    expect(nextResponse.status).toBe(200);
    expect(nextBody.content).toBe('NEXT_OK:NEXT_REQUEST');
    expect(adapterMocks.createServerAgent).toHaveBeenCalledTimes(2);
  }, 15_000);
});
