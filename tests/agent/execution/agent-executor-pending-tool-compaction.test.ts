/**
 * runTurnLoop regression: proactive compaction before tool execution must not
 * replace the real tool result with `[result lost during compaction]`.
 *
 * Deterministic local fixture provider (no model, no network). The token
 * counter reports a transcript above the model window so the pre-execution
 * compaction path fires before every tool call, as on Windows with a
 * 4096-token context. The provider answers only when the next request carries
 * the real tool output.
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentExecutor, type ExecutorConfig, type ExecutorDependencies } from '../../../src/agent/execution/agent-executor.js';
import type { StreamingChunk } from '../../../src/agent/types.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };

const LOST = '[result lost during compaction]';

function readCall(id: string, path: string, waitForPrevious?: boolean): Call {
  return {
    id,
    type: 'function',
    function: {
      name: 'read_file',
      arguments: JSON.stringify(waitForPrevious === undefined ? { path } : { path, wait_for_previous: waitForPrevious }),
    },
  };
}

function createDeps(outputs: Record<string, string>): ExecutorDependencies {
  return {
    client: {
      chat: vi.fn(),
      chatStream: vi.fn(),
      getCurrentModel: vi.fn().mockReturnValue('fixture-model'),
      getProviderName: vi.fn().mockReturnValue('fixture'),
    } as never,
    toolHandler: {
      executeTool: vi.fn().mockImplementation(async (toolCall: Call) => {
        const path = JSON.parse(toolCall.function.arguments).path as string;
        return { success: true, output: outputs[path] ?? 'missing' };
      }),
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
    // No budget inspection methods: the pipeline takes its full preparation
    // path (compaction + repair), like a context manager over its threshold.
    contextManager: {
      prepareMessages: vi.fn().mockImplementation((m: unknown[]) => m),
      prepareMessagesRaw: vi.fn().mockImplementation((m: unknown[]) => m),
      getContextEngine: vi.fn().mockReturnValue(null),
      shouldWarn: vi.fn().mockReturnValue({ warn: false }),
    } as never,
    tokenCounter: {
      countTokens: vi.fn().mockReturnValue(10),
      // Above 85 % of the default 128k window: compaction fires before each tool.
      countMessageTokens: vi.fn().mockReturnValue(200_000),
      dispose: vi.fn(),
    } as never,
  };
}

function createConfig(maxToolRounds = 6): ExecutorConfig {
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

/**
 * Round 1 returns `calls`. Later rounds answer only if every expected marker is
 * present in a tool message of the request; otherwise they re-issue the calls
 * with fresh ids (what the real model did: re-read until max rounds).
 */
function scriptProvider(deps: ExecutorDependencies, calls: Call[], expected: string[]) {
  const requests: CodeBuddyMessage[][] = [];
  let round = 0;
  let current: Call[] = [];
  const stream = deps.client.chatStream as unknown as ReturnType<typeof vi.fn>;
  const acc = deps.streamingHandler.getAccumulatedMessage as unknown as ReturnType<typeof vi.fn>;
  stream.mockImplementation(async function* (messages: CodeBuddyMessage[]) {
    round += 1;
    requests.push(structuredClone(messages));
    const toolText = messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
    if (round === 1) current = calls;
    else if (expected.every((marker) => toolText.includes(marker))) current = [];
    else current = calls.map((c) => ({ ...c, id: `${c.id}_retry${round}` }));
    yield { choices: [{ delta: { content: current.length ? '' : 'Invoice DS-8F32 totals 21.75' } }] };
  });
  acc.mockImplementation(() => ({ content: current.length ? '' : 'Invoice DS-8F32 totals 21.75', tool_calls: current.length ? current : undefined }));
  return { requests, rounds: () => round };
}

async function runStream(executor: AgentExecutor, messages: CodeBuddyMessage[], prompt: string): Promise<StreamingChunk[]> {
  const chunks: StreamingChunk[] = [];
  for await (const chunk of executor.processUserMessageStream(prompt, [], messages, null)) chunks.push(chunk);
  return chunks;
}

function toolContents(request: CodeBuddyMessage[], id: string): unknown[] {
  return request
    .filter((m) => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === id)
    .map((m) => m.content);
}

describe('runTurnLoop: pending tool calls survive pre-execution compaction', () => {
  const outputs = {
    'invoice.json': '{"invoice":"DS-8F32","total":21.75}',
    'a.json': '{"a":"ALPHA-REAL"}',
    'b.json': '{"b":"BRAVO-REAL"}',
  };

  it('streaming, single call: the second provider request carries the real result and the model answers', async () => {
    const deps = createDeps(outputs);
    const executor = new AgentExecutor(deps, createConfig());
    const provider = scriptProvider(deps, [readCall('call1', 'invoice.json')], ['DS-8F32']);
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Read invoice.json' }];

    const chunks = await runStream(executor, messages, 'Read invoice.json');

    expect(provider.rounds()).toBe(2);
    const second = provider.requests[1]!;
    expect(toolContents(second, 'call1')).toHaveLength(1);
    expect(String(toolContents(second, 'call1')[0])).toContain('DS-8F32');
    expect(JSON.stringify(second)).not.toContain(LOST);
    expect(toolContents(messages, 'call1').map(String).join('')).toContain('DS-8F32');
    // The loop ends on the model's answer, not on the round budget. (The final
    // text itself is asserted on the sequential path: this streaming double
    // reports display content through getAccumulatedMessage, not content chunks.)
    const text = chunks.filter((c) => c.type === 'content').map((c) => c.content).join('');
    expect(text).not.toContain('Maximum tool execution rounds reached');
    expect(chunks.at(-1)?.type).toBe('done');
  });

  it('sequential processUserMessage shares the same loop and the same guarantee', async () => {
    const deps = createDeps(outputs);
    const executor = new AgentExecutor(deps, createConfig());
    const provider = scriptProvider(deps, [readCall('call1', 'invoice.json')], ['DS-8F32']);
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Read invoice.json' }];

    const entries = await executor.processUserMessage('Read invoice.json', [], messages);

    expect(provider.rounds()).toBe(2);
    expect(JSON.stringify(provider.requests[1])).not.toContain(LOST);
    expect(entries.some((e) => e.type === 'assistant' && e.content.includes('Invoice DS-8F32'))).toBe(true);
  });

  it('parallel batch: both results are real in the next request', async () => {
    const deps = createDeps(outputs);
    const executor = new AgentExecutor(deps, createConfig());
    const provider = scriptProvider(deps, [readCall('pa', 'a.json'), readCall('pb', 'b.json')], ['ALPHA-REAL', 'BRAVO-REAL']);
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Compare a and b' }];

    await runStream(executor, messages, 'Compare a and b');

    expect(provider.rounds()).toBe(2);
    const second = provider.requests[1]!;
    expect(String(toolContents(second, 'pa'))).toContain('ALPHA-REAL');
    expect(String(toolContents(second, 'pb'))).toContain('BRAVO-REAL');
    expect(JSON.stringify(second)).not.toContain(LOST);
  });

  it('ordered batches: compaction before the second call keeps both real results', async () => {
    const deps = createDeps(outputs);
    const executor = new AgentExecutor(deps, createConfig());
    const provider = scriptProvider(
      deps,
      [readCall('sa', 'a.json', true), readCall('sb', 'b.json', true)],
      ['ALPHA-REAL', 'BRAVO-REAL'],
    );
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Read a then b' }];

    await runStream(executor, messages, 'Read a then b');

    expect(provider.rounds()).toBe(2);
    const second = provider.requests[1]!;
    expect(toolContents(second, 'sa')).toHaveLength(1);
    expect(toolContents(second, 'sb')).toHaveLength(1);
    expect(JSON.stringify(second)).not.toContain(LOST);
  });

  it('a genuine orphan in the loaded history is still closed before the provider call', async () => {
    const deps = createDeps(outputs);
    const executor = new AgentExecutor(deps, createConfig());
    const provider = scriptProvider(deps, [readCall('call1', 'invoice.json')], ['DS-8F32']);
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: null, tool_calls: [readCall('history-orphan', 'old.json')] } as CodeBuddyMessage,
      { role: 'user', content: 'Read invoice.json' },
    ];

    await runStream(executor, messages, 'Read invoice.json');

    expect(toolContents(provider.requests[0]!, 'history-orphan')).toEqual([LOST]);
    expect(toolContents(provider.requests[1]!, 'history-orphan')).toEqual([LOST]);
    expect(String(toolContents(provider.requests[1]!, 'call1'))).toContain('DS-8F32');
  });
});
