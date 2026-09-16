/** P5 — non-CLI surfaces receive the code_exec policy hint only when it is not the default. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentExecutor, type ExecutorConfig, type ExecutorDependencies } from '../../../src/agent/execution/agent-executor.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function deps(): ExecutorDependencies {
  return {
    client: {
      chat: vi.fn(),
      chatStream: vi.fn().mockImplementation(async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; }),
      getCurrentModel: vi.fn().mockReturnValue('fixture-model'),
      getProviderName: vi.fn().mockReturnValue('fixture'),
    } as never,
    toolHandler: { executeTool: vi.fn(), getWorkingDirectory: vi.fn().mockReturnValue(process.cwd()) } as never,
    toolSelectionStrategy: {
      selectToolsForQuery: vi.fn().mockResolvedValue({ tools: [], selection: null, fromCache: false, query: '', timestamp: new Date() }),
      cacheTools: vi.fn(), shouldUseSearchFor: vi.fn().mockReturnValue(false), clearCache: vi.fn(), setActiveSkill: vi.fn(), expandCachedTools: vi.fn(),
    } as never,
    streamingHandler: {
      reset: vi.fn(),
      accumulateChunk: vi.fn().mockReturnValue({ displayContent: '', rawContent: '', hasNewToolCalls: false, shouldEmitTokenCount: false }),
      extractToolCalls: vi.fn().mockReturnValue({ toolCalls: [], remainingContent: '' }),
      getAccumulatedMessage: vi.fn().mockReturnValue({ content: 'ok', tool_calls: undefined }),
      getTokenCount: vi.fn().mockReturnValue(1),
      hasYieldedToolCalls: vi.fn().mockReturnValue(false),
    } as never,
    contextManager: {
      prepareMessages: vi.fn().mockImplementation((m: unknown[]) => m),
      prepareMessagesRaw: vi.fn().mockImplementation((m: unknown[]) => m),
      getContextEngine: vi.fn().mockReturnValue(null),
      shouldWarn: vi.fn().mockReturnValue({ warn: false }),
    } as never,
    tokenCounter: { countTokens: vi.fn().mockReturnValue(1), countMessageTokens: vi.fn().mockReturnValue(1), dispose: vi.fn() } as never,
  };
}

const config: ExecutorConfig = {
  maxToolRounds: 5,
  isGrokModel: vi.fn().mockReturnValue(false),
  recordSessionCost: vi.fn(),
  isSessionCostLimitReached: vi.fn().mockReturnValue(false),
  estimateSessionCostLimitReached: vi.fn().mockReturnValue(false),
  getSessionCost: vi.fn().mockReturnValue(0),
  getSessionCostLimit: vi.fn().mockReturnValue(10),
};

async function sentSystemText(policy: string | undefined): Promise<string> {
  if (policy) process.env.CODEBUDDY_CODE_EXEC_POLICY = policy;
  else delete process.env.CODEBUDDY_CODE_EXEC_POLICY;
  const d = deps();
  const executor = new AgentExecutor(d, config);
  const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'compare three files' }];
  for await (const _chunk of executor.processUserMessageStream('compare three files', [], messages, null, Date.now(), undefined, false, 'http')) { /* drain */ }
  const sent = (d.client.chatStream as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as CodeBuddyMessage[];
  return sent.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
}

describe('code_exec policy hint on non-CLI surfaces (P5)', () => {
  const previous = process.env.CODEBUDDY_CODE_EXEC_POLICY;
  afterEach(() => {
    if (previous === undefined) delete process.env.CODEBUDDY_CODE_EXEC_POLICY;
    else process.env.CODEBUDDY_CODE_EXEC_POLICY = previous;
  });

  it('adds nothing for the default offer policy', async () => {
    expect(await sentSystemText(undefined)).not.toContain('<code_exec_policy');
  });

  it('tells the model the tool is disabled when policy is off', async () => {
    const text = await sentSystemText('off');
    expect(text).toContain('<code_exec_policy policy="off" source="env">');
    expect(text).toContain('disabled by the model policy');
  });

  it('adds the short preference hint when policy is prefer', async () => {
    expect(await sentSystemText('prefer')).toContain('<code_exec_policy policy="prefer" source="env">');
  });
});
