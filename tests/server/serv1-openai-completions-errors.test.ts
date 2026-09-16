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
  function createConversationState() {
    return {
      messages: [],
      chatHistory: [],
      sessionCost: 0,
      routingSessionCost: 0,
      workingDirectory: process.cwd(),
      contextManagerState: {
        summaries: [],
        systemMessage: null,
        triggeredWarnings: [],
        lastTokenCount: 0,
        lastEnhancedResult: null,
        sessionId: 'serv1-completions',
        peakMessageCount: 0,
        compressionCount: 0,
        totalTokensSaved: 0,
        lastCompressionTime: null,
        snapshotCount: 0,
        enhancedCompression: null,
      },
    };
  }
  return {
    ...actual,
    createServerAgent: vi.fn(async () => {
      let state = createConversationState();
      return {
        processUserMessage: vi.fn(async () => [{ type: 'assistant', content: 'SHOULD_NOT_RUN' }]),
        processUserMessageStream: vi.fn(async function* () {
          yield { type: 'content', content: 'SHOULD_NOT_RUN' };
        }),
        getChatHistory: () => [],
        getCurrentModel: () => 'qa-serv1-model',
        setModel: vi.fn(),
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
    runAgentCompletion: vi.fn(async (_agent: unknown, input: string) => {
      if (String(input).includes('unknown-model-probe')) {
        return {
          content:
            "Sorry, I encountered an error: CodeBuddy API error: 404 model 'serv1-does-not-exist-xyz' not found",
          finishReason: 'stop',
        };
      }
      return {
        content: `SERV1_AGENT_RAN:${input}`,
        finishReason: 'stop',
      };
    }),
    streamAgentDeltas: vi.fn(async function* () {
      yield '\n🟢 Context Notice: You have used 53.0% of your total context (14,438/27,238 tokens)\n';
      yield 'SERV1-STREAM-OK';
    }),
  };
});

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('SERV1 OpenAI /v1/chat/completions errors', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-serv1-completions-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();
  });

  afterEach(async () => {
    if (started) {
      const { stopServer } = await import('../../src/server/index.js');
      await stopServer(started.server);
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

  async function postCompletions(baseUrl: string, body: unknown): Promise<{
    status: number;
    json: Record<string, unknown>;
  }> {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      json: (await response.json()) as Record<string, unknown>,
    };
  }

  it('rejects negative max_tokens with HTTP 400, not a 200 agent turn', async () => {
    const baseUrl = await start();
    const { status, json } = await postCompletions(baseUrl, {
      model: 'qa-serv1-model',
      max_tokens: -1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(status).toBe(400);
    const error = json.error as { message?: string; type?: string } | undefined;
    expect(error?.type).toBe('invalid_request_error');
    expect(error?.message).toMatch(/max_tokens/i);
    expect(JSON.stringify(json)).not.toContain('SERV1_AGENT_RAN');
  });

  it('rejects oversized max_tokens with HTTP 400', async () => {
    const baseUrl = await start();
    const { status, json } = await postCompletions(baseUrl, {
      model: 'qa-serv1-model',
      max_tokens: 999999999,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(status).toBe(400);
    const error = json.error as { message?: string; type?: string } | undefined;
    expect(error?.type).toBe('invalid_request_error');
    expect(error?.message).toMatch(/max_tokens/i);
  });

  it('rejects OpenAI tools with an honest 400 instead of silently running the agent', async () => {
    const baseUrl = await start();
    const { status, json } = await postCompletions(baseUrl, {
      model: 'qa-serv1-model',
      messages: [{ role: 'user', content: 'Call get_weather for Paris' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ],
    });
    expect(status).toBe(400);
    const error = json.error as { message?: string; type?: string } | undefined;
    expect(error?.type).toBe('invalid_request_error');
    expect(error?.message).toMatch(/tools/i);
    expect(JSON.stringify(json)).not.toContain('SERV1_AGENT_RAN');
  });

  it('maps a provider model-not-found failure to HTTP 404, not a 200 assistant apology', async () => {
    const baseUrl = await start();
    const { status, json } = await postCompletions(baseUrl, {
      model: 'serv1-does-not-exist-xyz',
      messages: [{ role: 'user', content: 'unknown-model-probe' }],
    });
    expect(status).toBe(404);
    const error = json.error as { message?: string; type?: string; code?: string } | undefined;
    expect(error?.type).toBe('invalid_request_error');
    expect(error?.code).toBe('model_not_found');
    expect(error?.message).toMatch(/serv1-does-not-exist-xyz/);
    expect(json.choices).toBeUndefined();
  });
});
