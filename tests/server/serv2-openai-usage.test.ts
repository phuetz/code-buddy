/**
 * SERV2 — écart 1 du rapport SERV1 : `/v1/chat/completions` renvoyait un
 * `usage.prompt_tokens` obtenu par `longueur / 4` sur le seul texte utilisateur,
 * alors que le tour réel envoie aussi le prompt système et l'historique. Un
 * client OpenAI qui facture ou plafonne sur ce champ était trompé sans le savoir.
 *
 * Contrat figé ici :
 *  - quand le fournisseur remonte ses propres compteurs, ce sont EUX qui sortent,
 *    et la réponse ne porte aucun drapeau `estimated` ;
 *  - sinon l'estimation reste, mais elle s'annonce : `usage.estimated === true`.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDatabaseManager } from '../../src/database/database-manager.js';

/** Compteurs « fournisseur » injectés par le faux adaptateur. */
const providerUsage: { promptTokens: number; completionTokens: number } | null = {
  promptTokens: 14482,
  completionTokens: 37,
};
let usageEnabled = true;

vi.mock('../../src/server/agent-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/server/agent-adapter.js')>(
    '../../src/server/agent-adapter.js'
  );
  function createConversationState() {
    return {
      messages: [] as unknown[],
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
        sessionId: 'serv2-usage',
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
        processUserMessage: vi.fn(async () => [
          { type: 'assistant', content: 'SERV2-USAGE-OK' },
        ]),
        processUserMessageStream: vi.fn(async function* () {
          yield { type: 'content', content: 'SERV2-USAGE-OK' };
        }),
        getChatHistory: () => [],
        getCurrentModel: () => 'qa-serv2-model',
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
        // Le vrai agent expose ce point d'accès depuis SERV2 ; le double le
        // fournit à l'identique pour que la route soit testée, pas contournée.
        getLastTurnUsage: () => (usageEnabled && providerUsage ? { ...providerUsage } : undefined),
        systemPromptReady: Promise.resolve(),
      };
    }),
    runAgentCompletion: vi.fn(async (agent: { getLastTurnUsage?: () => unknown }) => ({
      content: 'SERV2-USAGE-OK',
      finishReason: 'stop',
      usage: agent.getLastTurnUsage?.(),
    })),
    streamAgentDeltas: vi.fn(async function* () {
      yield 'SERV2-USAGE-OK';
    }),
  };
});

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('SERV2 usage OpenAI sur /v1/chat/completions', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    usageEnabled = true;
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-serv2-usage-'));
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

  async function postCompletions(baseUrl: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  it('rend les compteurs du fournisseur quand ils existent, sans drapeau estimated', async () => {
    const baseUrl = await start();
    const json = await postCompletions(baseUrl, {
      model: 'qa-serv2-model',
      messages: [{ role: 'user', content: 'bonjour' }],
    });

    const usage = json.usage as Record<string, unknown>;
    expect(usage.prompt_tokens).toBe(14482);
    expect(usage.completion_tokens).toBe(37);
    expect(usage.total_tokens).toBe(14519);
    expect(usage.estimated).toBeUndefined();
  });

  it('annonce l’estimation quand le fournisseur ne remonte aucun compteur', async () => {
    usageEnabled = false;
    const baseUrl = await start();
    const json = await postCompletions(baseUrl, {
      model: 'qa-serv2-model',
      messages: [{ role: 'user', content: 'bonjour' }],
    });

    const usage = json.usage as Record<string, unknown>;
    expect(usage.estimated).toBe(true);
    expect(typeof usage.prompt_tokens).toBe('number');
    expect(usage.total_tokens).toBe(
      (usage.prompt_tokens as number) + (usage.completion_tokens as number)
    );
  });

  it('rend les compteurs du fournisseur dans le dernier chunk SSE', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qa-serv2-model',
        stream: true,
        messages: [{ role: 'user', content: 'bonjour' }],
      }),
    });
    const body = await response.text();

    const usageChunk = body
      .split('\n')
      .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
      .find((chunk) => chunk.usage !== undefined);

    expect(usageChunk).toBeDefined();
    const usage = usageChunk!.usage as Record<string, unknown>;
    expect(usage.prompt_tokens).toBe(14482);
    expect(usage.completion_tokens).toBe(37);
    expect(usage.estimated).toBeUndefined();
  });

  it('annonce l’estimation dans le dernier chunk SSE quand le fournisseur se tait', async () => {
    usageEnabled = false;
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qa-serv2-model',
        stream: true,
        messages: [{ role: 'user', content: 'bonjour' }],
      }),
    });
    const body = await response.text();

    const usageChunk = body
      .split('\n')
      .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
      .find((chunk) => chunk.usage !== undefined);

    expect(usageChunk).toBeDefined();
    expect((usageChunk!.usage as Record<string, unknown>).estimated).toBe(true);
  });
});
