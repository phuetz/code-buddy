import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDatabaseManager } from '../../src/database/database-manager.js';

vi.mock('../../src/server/agent-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/server/agent-adapter.js')>(
    '../../src/server/agent-adapter.js'
  );
  let currentModel = 'qa-server-default-model';
  const processUserMessage = vi.fn(async (input: string) => [
    { type: 'assistant', content: `SERVER_CHAT_REAL_HTTP:${input}` },
  ]);
  const processUserMessageStream = vi.fn(async function* (input: string) {
    yield { type: 'content', content: 'SERVER_STREAM_PART_A:' };
    yield { type: 'content', content: input };
  });

  function createConversationState() {
    return {
      messages: [],
      chatHistory: [],
      sessionCost: 0,
      routingSessionCost: 0,
      workingDirectory: process.cwd(),
      contextManagerState: {
        summaries: [], systemMessage: null, triggeredWarnings: [], lastTokenCount: 0,
        lastEnhancedResult: null, sessionId: 'real-http-neutral', peakMessageCount: 0,
        compressionCount: 0, totalTokensSaved: 0, lastCompressionTime: null,
        snapshotCount: 0, enhancedCompression: null,
      },
    };
  }

  return {
    ...actual,
    createServerAgent: vi.fn(async () => {
      let state = createConversationState();
      return {
        processUserMessage,
        processUserMessageStream,
        getChatHistory: () => [],
        getCurrentModel: () => currentModel,
        setModel: (model: string) => {
          currentModel = model;
        },
        setRecoverySessionId: vi.fn(),
        abortCurrentOperation: vi.fn(),
        addToHistory: (message: { role: string; content: string }) => {
          state.messages.push(message as never);
        },
        exportConversationState: () => structuredClone(state),
        importConversationState: (next: ReturnType<typeof createConversationState>) => {
          state = structuredClone(next);
        },
        executeToolByName: vi.fn(),
        systemPromptReady: Promise.resolve(),
      };
    }),
    listServerModels: vi.fn(() => [
      {
        id: currentModel,
        object: 'model',
        created: 1_779_000_000,
        owned_by: 'qa-fixture',
      },
    ]),
  };
});

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

async function readSseData(response: Response): Promise<string[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => chunk.slice('data: '.length));
}

describe('chat routes real HTTP integration', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-chat-route-'));
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

  it('serves /api/chat, legacy SSE, OpenAI completions and model listing over real HTTP', async () => {
    const baseUrl = await start();

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qa-chat-route-model',
        sessionId: 'qa-session',
        messages: [{ role: 'user', content: 'QA_CHAT_HTTP_OK' }],
      }),
    });
    const chatBody = (await chatResponse.json()) as { content: string; model: string; latency: number };
    expect(chatResponse.status).toBe(200);
    expect(chatBody.content).toBe('SERVER_CHAT_REAL_HTTP:QA_CHAT_HTTP_OK');
    expect(chatBody.model).toBe('qa-chat-route-model');
    expect(chatBody.latency).toBeGreaterThanOrEqual(0);

    const streamResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'QA_STREAM_OK' }],
      }),
    });
    const streamEvents = await readSseData(streamResponse);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');
    expect(streamEvents.join('\n')).toContain('SERVER_STREAM_PART_A:');
    expect(streamEvents.join('\n')).toContain('QA_STREAM_OK');
    expect(streamEvents.at(-1)).toBe('[DONE]');

    const completionResponse = await fetch(`${baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qa-openai-format-model',
        messages: [{ role: 'user', content: 'QA_OPENAI_HTTP_OK' }],
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
    expect(completionBody.model).toBe('qa-openai-format-model');
    expect(completionBody.choices[0].message.content).toBe(
      'SERVER_CHAT_REAL_HTTP:QA_OPENAI_HTTP_OK'
    );
    expect(completionBody.usage.total_tokens).toBeGreaterThan(0);

    const modelsResponse = await fetch(`${baseUrl}/api/chat/models`);
    const modelsBody = (await modelsResponse.json()) as { data: Array<{ id: string }> };
    expect(modelsResponse.status).toBe(200);
    expect(modelsBody.data[0].id).toBe('qa-server-default-model');
  }, 15_000);
});
