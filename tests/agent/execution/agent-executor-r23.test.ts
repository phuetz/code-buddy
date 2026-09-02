/**
 * R23 — faux succès de l'exécuteur : réponse vide, hybride après retry,
 * troncature length, mention @fichier absente.
 *
 * Faux fournisseurs uniquement (générateurs collés). Aucun réseau, aucun LLM.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentExecutor, ExecutorDependencies, ExecutorConfig } from '../../../src/agent/execution/agent-executor';
import type { ChatEntry, StreamingChunk } from '../../../src/agent/types';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client';

jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

function createMockDeps(overrides: Partial<ExecutorDependencies> = {}): ExecutorDependencies {
  return {
    client: {
      chat: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Test response', tool_calls: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      chatStream: jest.fn().mockImplementation(async function* () {
        yield { choices: [{ delta: { content: 'Test ' } }] };
        yield { choices: [{ delta: { content: 'response' } }] };
      }),
      getCurrentModel: jest.fn().mockReturnValue('test-model'),
      getProviderName: jest.fn().mockReturnValue('test-provider'),
    } as any,
    toolHandler: {
      executeTool: jest.fn().mockResolvedValue({ success: true, output: 'Tool result' }),
      executeStrictSelfInspectionTool: jest.fn().mockResolvedValue({
        success: true,
        output: 'Strict self-inspection result',
      }),
      executeToolStreaming: jest.fn().mockImplementation(async function* () {
        yield 'stream chunk';
        return { success: true, output: 'streamed' };
      }),
      getWorkingDirectory: jest.fn().mockReturnValue(process.cwd()),
    } as any,
    toolSelectionStrategy: {
      selectToolsForQuery: jest.fn().mockResolvedValue({
        tools: [],
        selection: null,
        fromCache: false,
        query: '',
        timestamp: new Date(),
      }),
      cacheTools: jest.fn(),
      shouldUseSearchFor: jest.fn().mockReturnValue(false),
      clearCache: jest.fn(),
      setActiveSkill: jest.fn(),
      expandCachedTools: jest.fn().mockResolvedValue(1),
    } as any,
    streamingHandler: {
      reset: jest.fn(),
      accumulateChunk: jest.fn().mockReturnValue({
        displayContent: '',
        rawContent: '',
        hasNewToolCalls: false,
        shouldEmitTokenCount: false,
      }),
      extractToolCalls: jest.fn().mockReturnValue({ toolCalls: [], remainingContent: '' }),
      getAccumulatedMessage: jest.fn().mockReturnValue({ content: 'Test response', tool_calls: undefined }),
      getTokenCount: jest.fn().mockReturnValue(50),
      hasYieldedToolCalls: jest.fn().mockReturnValue(false),
    } as any,
    contextManager: {
      prepareMessages: jest.fn().mockImplementation((msgs: unknown[]) => msgs),
      prepareMessagesRaw: jest.fn().mockImplementation((msgs: unknown[]) => msgs),
      getContextEngine: jest.fn().mockReturnValue(null),
      shouldWarn: jest.fn().mockReturnValue({ warn: false }),
    } as any,
    tokenCounter: {
      countTokens: jest.fn().mockReturnValue(100),
      countMessageTokens: jest.fn().mockReturnValue(500),
      dispose: jest.fn(),
    } as any,
    ...overrides,
  };
}

function createMockConfig(overrides: Partial<ExecutorConfig> = {}): ExecutorConfig {
  return {
    maxToolRounds: 50,
    isGrokModel: jest.fn().mockReturnValue(false),
    recordSessionCost: jest.fn(),
    isSessionCostLimitReached: jest.fn().mockReturnValue(false),
    estimateSessionCostLimitReached: jest.fn().mockReturnValue(false),
    getSessionCost: jest.fn().mockReturnValue(0),
    getSessionCostLimit: jest.fn().mockReturnValue(10),
    ...overrides,
  };
}

type LLMResponse = {
  content: string;
  tool_calls?: unknown[];
  finishReason?: string | null;
};

function setupLLMFlow(d: ExecutorDependencies, responses: LLMResponse[]) {
  const stream = d.client.chatStream as jest.Mock;
  const acc = d.streamingHandler.getAccumulatedMessage as jest.Mock;
  for (const r of responses) {
    stream.mockImplementationOnce(async function* () {
      if (r.content) {
        yield { choices: [{ delta: { content: r.content }, finish_reason: r.finishReason }] };
      }
    });
    acc.mockReturnValueOnce({
      content: r.content,
      tool_calls: r.tool_calls,
      finishReason: r.finishReason,
    });
  }
  (d.streamingHandler.extractToolCalls as jest.Mock).mockReturnValue({
    toolCalls: [],
    remainingContent: '',
  });
}

async function collectChunks(gen: AsyncGenerator<StreamingChunk>): Promise<StreamingChunk[]> {
  const chunks: StreamingChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

function visibleText(chunks: StreamingChunk[]): string {
  return chunks.map((chunk) => chunk.content ?? '').join('');
}

describe('R23 AgentExecutor — faux succès', () => {
  let deps: ExecutorDependencies;
  let config: ExecutorConfig;
  let executor: AgentExecutor;
  const envKeys = [
    'CODEBUDDY_MAX_EMPTY_RETRIES',
    'CODEBUDDY_MAX_LENGTH_CONTINUATIONS',
  ] as const;
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of envKeys) {
      envSnapshot[key] = process.env[key];
      delete process.env[key];
    }
    deps = createMockDeps();
    config = createMockConfig();
    executor = new AgentExecutor(deps, config);
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = envSnapshot[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('D1 — réponse fournisseur vide', () => {
    it('n’invente pas un message assistant et échoue honnêtement (API séquentielle)', async () => {
      setupLLMFlow(deps, [{ content: '' }]);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];
      const entries = await executor.processUserMessage('Hello', history, messages);

      const joined = entries.map((entry) => entry.content).join('\n');
      expect(joined).toMatch(/réponse vide du fournisseur/i);
      expect(joined).not.toContain('Using tools to help you');
      expect(entries.some((entry) => entry.type === 'assistant' && entry.content === '')).toBe(false);
      expect(messages.some((msg) => msg.role === 'assistant' && !msg.content && !msg.tool_calls)).toBe(false);
    });

    it('n’annonce pas un tour réussi en flux : erreur explicite, pas de faux texte', async () => {
      setupLLMFlow(deps, [{ content: '' }]);

      const history: ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [];
      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, messages, null),
      );

      const text = visibleText(chunks);
      expect(text).toMatch(/réponse vide du fournisseur/i);
      expect(text).not.toContain('Using tools to help you');
      expect(chunks.some((chunk) => chunk.type === 'done')).toBe(true);
      expect(history.some((entry) => entry.content === 'Using tools to help you...')).toBe(false);
      expect(history.some((entry) => entry.type === 'assistant' && entry.content === '')).toBe(false);
    });

    it('retente une fois un vide si CODEBUDDY_MAX_EMPTY_RETRIES=1, puis garde la vraie réponse', async () => {
      process.env.CODEBUDDY_MAX_EMPTY_RETRIES = '1';
      setupLLMFlow(deps, [{ content: '' }, { content: 'Réponse après retry' }]);

      const history: ChatEntry[] = [];
      const entries = await executor.processUserMessage('Hello', history, []);

      expect(deps.client.chatStream).toHaveBeenCalledTimes(2);
      expect(entries.map((entry) => entry.content).join('\n')).toContain('Réponse après retry');
      expect(entries.map((entry) => entry.content).join('\n')).not.toMatch(/réponse vide du fournisseur/i);
    });
  });

  describe('D2 — retry après un fragment déjà rendu', () => {
    function pipeVisibleDeltas(): void {
      (deps.streamingHandler.accumulateChunk as jest.Mock).mockImplementation((chunk: {
        choices?: Array<{ delta?: { content?: string } }>;
      }) => {
        const displayContent = chunk?.choices?.[0]?.delta?.content ?? '';
        return {
          displayContent,
          rawContent: displayContent,
          hasNewToolCalls: false,
          shouldEmitTokenCount: false,
        };
      });
    }

    it('ne concatène pas le fragment abandonné avec la seconde tentative (casse au 2e delta)', async () => {
      pipeVisibleDeltas();
      (deps.client.chatStream as jest.Mock)
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'PREMIER_FRAGMENT' } }] };
          throw Object.assign(new Error('service unavailable'), {
            status: 503,
            headers: { 'retry-after': '0' },
          });
        })
        .mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: 'REPONSE_FINALE' } }] };
        });
      (deps.streamingHandler.getAccumulatedMessage as jest.Mock).mockReturnValue({
        content: 'REPONSE_FINALE',
        tool_calls: undefined,
      });

      const history: ChatEntry[] = [];
      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, [], null),
      );
      const text = visibleText(chunks);

      expect(text).not.toContain('REPONSE_FINALE');
      expect(text).not.toMatch(/PREMIER_FRAGMENT[\s\S]*REPONSE_FINALE/);
      expect(text).toMatch(/hybride|fragment déjà rendu|interrompue/i);
      expect(history.map((entry) => entry.content).join('\n')).not.toContain('REPONSE_FINALE');
      expect(deps.client.chatStream).toHaveBeenCalledTimes(1);
    });
  });

  describe('D3 — épuisement des continuations length', () => {
    it('ne conclut pas comme un stop une réponse encore tronquée', async () => {
      process.env.CODEBUDDY_MAX_LENGTH_CONTINUATIONS = '1';
      setupLLMFlow(deps, [
        { content: 'DEBUT_INCOMPLET', finishReason: 'length' },
        { content: 'SUITE_ENCORE_INCOMPLETE', finishReason: 'length' },
      ]);

      const history: ChatEntry[] = [];
      const chunks = await collectChunks(
        executor.processUserMessageStream('Hello', history, [], null),
      );
      const text = visibleText(chunks);
      const assistants = history.filter((entry) => entry.type === 'assistant');

      expect(deps.client.chatStream).toHaveBeenCalledTimes(2);
      expect(assistants.some((entry) => entry.content.includes('DEBUT_INCOMPLET'))).toBe(true);
      expect(assistants.some((entry) => entry.content.includes('SUITE_ENCORE_INCOMPLETE'))).toBe(true);
      expect(assistants.some((entry) => entry.truncated === true)).toBe(true);
      expect(text).toMatch(/tronquée/i);
      expect(history.some((entry) => /tronquée/i.test(entry.content))).toBe(true);
    });

    it('marque aussi une troncature length sans nouveau token', async () => {
      process.env.CODEBUDDY_MAX_LENGTH_CONTINUATIONS = '3';
      setupLLMFlow(deps, [{ content: '', finishReason: 'length' }]);

      const history: ChatEntry[] = [];
      const entries = await executor.processUserMessage('Hello', history, []);

      expect(deps.client.chatStream).toHaveBeenCalledTimes(1);
      expect(entries.map((entry) => entry.content).join('\n')).not.toMatch(/réponse vide du fournisseur/i);
      expect(history.some((entry) => entry.truncated === true)).toBe(true);
      expect(entries.map((entry) => entry.content).join('\n')).toMatch(/tronquée/i);
    });
  });

  describe('D4 — mention @fichier absente', () => {
    it('prévient le modèle et l’utilisateur quand @fichier est introuvable', async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-file-mention-missing-'));
      try {
        (deps.toolHandler.getWorkingDirectory as jest.Mock).mockReturnValue(projectRoot);
        setupLLMFlow(deps, [{ content: 'Je l’ai lu.' }]);
        const messages: CodeBuddyMessage[] = [
          { role: 'system', content: 'Base system prompt' },
          { role: 'user', content: 'Review @definitely-missing.ts' },
        ];
        const history: ChatEntry[] = [];

        const chunks = await collectChunks(
          executor.processUserMessageStream(
            'Review @definitely-missing.ts',
            history,
            messages,
            null,
          ),
        );

        const providerMessages = (
          (deps.client.chatStream as jest.Mock).mock.calls[0][0]
        ) as CodeBuddyMessage[];
        const modelNotice = providerMessages.find((turn) =>
          typeof turn.content === 'string' && turn.content.includes('file_mention_notice'),
        );
        const text = visibleText(chunks);

        expect(modelNotice?.content).toMatch(/definitely-missing\.ts/);
        expect(text).toMatch(/definitely-missing\.ts/i);
        expect(text).toMatch(/introuvable, ignoré/i);
        expect(history.some((entry) => /introuvable, ignoré/i.test(entry.content))).toBe(true);
        expect(providerMessages.some((turn) =>
          typeof turn.content === 'string' && turn.content.includes('<file_contents>'),
        )).toBe(false);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });
  });
});
