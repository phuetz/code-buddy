/**
 * R23 — faux succès de l'exécuteur : réponse vide, hybride après retry,
 * troncature length, mention @fichier absente.
 *
 * Faux fournisseurs uniquement (générateurs collés). Aucun réseau, aucun LLM.
 */
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
});
