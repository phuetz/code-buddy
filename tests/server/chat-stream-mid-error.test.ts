import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/agent-adapter.js', () => {
  function emptyState() {
    return {
      messages: [],
      chatHistory: [],
      sessionCost: 0,
      routingSessionCost: 0,
      workingDirectory: process.cwd(),
      contextManagerState: {
        summaries: [], systemMessage: null, triggeredWarnings: [], lastTokenCount: 0,
        lastEnhancedResult: null, sessionId: 'r21-stream-neutral', peakMessageCount: 0,
        compressionCount: 0, totalTokensSaved: 0, lastCompressionTime: null,
        snapshotCount: 0, enhancedCompression: null,
      },
    };
  }

  return {
    createServerAgent: vi.fn(async () => {
      let state = emptyState();
      return {
        processUserMessage: vi.fn(),
        processUserMessageStream: vi.fn(),
        getChatHistory: () => [],
        getCurrentModel: () => 'r21-fake-provider',
        setModel: vi.fn(),
        setRecoverySessionId: vi.fn(),
        addToHistory: vi.fn(),
        exportConversationState: () => structuredClone(state),
        importConversationState: (next: ReturnType<typeof emptyState>) => {
          state = structuredClone(next);
        },
        abortCurrentOperation: vi.fn(),
        executeToolByName: vi.fn(),
        dispose: vi.fn(),
        systemPromptReady: Promise.resolve(),
      };
    }),
    listServerModels: vi.fn(() => []),
    runAgentCompletion: vi.fn(),
    streamAgentDeltas: vi.fn(async function* () {
      yield 'premier-delta';
      const error = new Error('faux fournisseur cassé au deuxième chunk') as Error & {
        statusCode?: number;
      };
      error.statusCode = 503;
      throw error;
    }),
  };
});

import chatRoutes from '../../src/server/routes/chat.js';
import { __resetHttpAgentSessionCacheForTests } from '../../src/server/http-agent-sessions.js';

describe('OpenAI SSE mid-stream provider failure', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { scopes: ['admin'], type: 'api_key' };
      next();
    });
    app.use('/api/chat', chatRoutes);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await __resetHttpAgentSessionCacheForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('émet un seul événement final error et jamais stop', async () => {
    const response = await fetch(`${baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        model: 'r21-fake-provider',
        messages: [{ role: 'user', content: 'casse après le premier delta' }],
      }),
    });
    const raw = await response.text();
    const events = raw
      .split('\n\n')
      .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
      .map((line) => JSON.parse(line.slice('data: '.length)) as {
        error?: { message?: string };
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
      });

    expect(response.status).toBe(200);
    expect(events[0]?.choices?.[0]?.delta?.content).toBe('premier-delta');
    expect(events).toHaveLength(2);
    expect(events[1]?.error?.message).toContain('faux fournisseur cassé');
    expect(events.flatMap((event) => event.choices ?? []).map((choice) => choice.finish_reason))
      .not.toContain('stop');
  });
});
