/**
 * Bloquant 11 — a headless agent that explores 200+ calls without writing
 * the deliverable. Scripted provider imitating the real run of 2026-10-04
 * (same files re-read with a different line range each time).
 *
 * Deterministic local fixture provider (no model, no network): each LLM round
 * returns one tool call; the tool handler returns the same result.
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentExecutor, type ExecutorConfig, type ExecutorDependencies } from '../../../src/agent/execution/agent-executor.js';
import { MiddlewarePipeline } from '../../../src/agent/middleware/pipeline.js';
import { TurnLimitMiddleware } from '../../../src/agent/middleware/turn-limit.js';
import type { StreamingChunk } from '../../../src/agent/types.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };

function toolCall(name: string, args: Record<string, unknown>, round: number): Call {
  return { id: `call_${name}_${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function createDeps(): ExecutorDependencies {
  return {
    client: {
      chat: vi.fn(),
      chatStream: vi.fn(),
      getCurrentModel: vi.fn().mockReturnValue('fixture-model'),
      getProviderName: vi.fn().mockReturnValue('fixture'),
    } as never,
    toolHandler: {
      executeTool: vi.fn().mockResolvedValue({ success: true, output: 'export const answer = 42;' }),
      getWorkingDirectory: vi.fn().mockReturnValue(process.cwd()),
    } as never,
    toolSelectionStrategy: {
      selectToolsForQuery: vi.fn().mockResolvedValue({ tools: [], selection: null, fromCache: false, query: '', timestamp: new Date() }),
      cacheTools: vi.fn(),
      shouldUseSearchFor: vi.fn().mockReturnValue(false),
      clearCache: vi.fn(),
      setActiveSkill: vi.fn(),
      expandCachedTools: vi.fn().mockResolvedValue(0),
    } as never,
    streamingHandler: {
      reset: vi.fn(),
      accumulateChunk: vi.fn().mockReturnValue({ displayContent: '', rawContent: '', hasNewToolCalls: false, shouldEmitTokenCount: false }),
      extractToolCalls: vi.fn().mockReturnValue({ toolCalls: [], remainingContent: '' }),
      getAccumulatedMessage: vi.fn(),
      getTokenCount: vi.fn().mockReturnValue(10),
      hasYieldedToolCalls: vi.fn().mockReturnValue(false),
    } as never,
    contextManager: {
      prepareMessages: vi.fn().mockImplementation((m: unknown[]) => m),
      prepareMessagesRaw: vi.fn().mockImplementation((m: unknown[]) => m),
      getContextEngine: vi.fn().mockReturnValue(null),
      shouldWarn: vi.fn().mockReturnValue({ warn: false }),
    } as never,
    tokenCounter: {
      countTokens: vi.fn().mockReturnValue(10),
      countMessageTokens: vi.fn().mockReturnValue(10),
      dispose: vi.fn(),
    } as never,
  };
}

function createConfig(maxToolRounds = 50): ExecutorConfig {
  return {
    maxToolRounds,
    isGrokModel: vi.fn().mockReturnValue(false),
    recordSessionCost: vi.fn(),
    isSessionCostLimitReached: vi.fn().mockReturnValue(false),
    estimateSessionCostLimitReached: vi.fn().mockReturnValue(false),
    getSessionCost: vi.fn().mockReturnValue(0),
    getSessionCostLimit: vi.fn().mockReturnValue(10),
  };
}

/** Fixture provider: `plan(round)` returns the tool calls for that round (empty = final answer). */
function scriptProvider(deps: ExecutorDependencies, plan: (round: number) => Call[]): { rounds: () => number } {
  let round = 0;
  const stream = deps.client.chatStream as unknown as ReturnType<typeof vi.fn>;
  const acc = deps.streamingHandler.getAccumulatedMessage as unknown as ReturnType<typeof vi.fn>;
  let current: Call[] = [];
  stream.mockImplementation(async function* () {
    round += 1;
    current = plan(round);
    yield { choices: [{ delta: { content: current.length ? '' : 'final answer' } }] };
  });
  acc.mockImplementation(() => ({ content: current.length ? '' : 'final answer', tool_calls: current.length ? current : undefined }));
  return { rounds: () => round };
}

async function runStream(executor: AgentExecutor, messages: CodeBuddyMessage[]): Promise<StreamingChunk[]> {
  const chunks: StreamingChunk[] = [];
  for await (const chunk of executor.processUserMessageStream('Inspect src/a.ts', [], messages, null)) chunks.push(chunk);
  return chunks;
}


function hintMessages(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
  return messages.filter((m) => typeof m.content === 'string' && m.content.includes('<context type="stagnation-hint">'));
}

describe('AgentExecutor stagnation hint (bloquant 11)', () => {
  it('re-reading the same files with changing ranges, nothing written: exactly one refocus hint, loop-guard silent', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(200));
    const files = ['src/config/model-price-data.ts', 'src/utils/cost-tracker.ts', 'tests/utils/cost-openrouter-paid.test.ts'];
    const provider = scriptProvider(deps, (round) =>
      round <= 45 ? [toolCall('view_file', { path: files[round % 3], start_line: round, end_line: round + 40 }, round)] : []);
    const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Inspect src/a.ts' }];

    const chunks = await runStream(executor, messages);

    expect(hintMessages(messages)).toHaveLength(1);
    expect(hintMessages(messages)[0]!.content).toContain('write the requested deliverable now');
    expect(messages.filter((m) => typeof m.content === 'string' && m.content.includes('<context type="loop-guard">'))).toHaveLength(0);
    // The hint never stops the task: the model still gets to answer.
    expect(provider.rounds()).toBe(46);
    expect(chunks.some((c) => c.type === 'content' && c.content?.includes('write the requested deliverable now'))).toBe(true);
    // Cache-safe: the hint is appended after everything already in the transcript.
    const idx = messages.findIndex((m) => typeof m.content === 'string' && m.content.includes('stagnation-hint'));
    expect(messages.slice(0, idx).filter((m) => m.role === 'tool').length).toBeGreaterThanOrEqual(30);
  });

  it('a real write in the middle resets the streak: no hint', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(200));
    scriptProvider(deps, (round) => {
      if (round === 25) return [toolCall('create_file', { path: 'out.md', content: 'x' }, round)];
      return round <= 45 ? [toolCall('view_file', { path: 'src/a.ts', start_line: round }, round)] : [];
    });
    const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Inspect src/a.ts' }];
    await runStream(executor, messages);
    expect(hintMessages(messages)).toHaveLength(0);
  });

  it('80 % of the round limit: one explicit "write the deliverable now" instruction', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(10));
    executor.setMiddlewarePipeline(new MiddlewarePipeline().use(new TurnLimitMiddleware()));
    scriptProvider(deps, (round) => (round <= 9 ? [toolCall('view_file', { path: `src/f${round}.ts` }, round)] : []));
    const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Inspect src/a.ts' }];
    await runStream(executor, messages);
    const hints = messages.filter((m) => typeof m.content === 'string' && m.content.includes('middleware-hint'));
    expect(hints).toHaveLength(1);
    expect(String(hints[0]!.content)).toMatch(/Approaching tool round limit \(8\/10\)[\s\S]*write the requested deliverable/);
  });
});
