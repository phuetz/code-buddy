/**
 * P1 acceptance — the tool loop guard wired into runTurnLoop.
 *
 * Deterministic local fixture provider (no model, no network): each LLM round
 * returns one tool call; the tool handler returns the same result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentExecutor, type ExecutorConfig, type ExecutorDependencies } from '../../../src/agent/execution/agent-executor.js';
import type { StreamingChunk } from '../../../src/agent/types.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import { getGlobalEventBus } from '../../../src/events/event-bus.js';
import { wireDomainEventBridge } from '../../../src/sensory/domain-event-bridge.js';
import { getRuleTemplate } from '../../../src/sensory/rule-templates.js';
import { ruleMatches, wireSensoryRules } from '../../../src/sensory/sensory-rules-engine.js';
import { LoopDetectionService } from '../../../src/agent/loop-detection-service.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

function guardMessages(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
  return messages.filter((m) => typeof m.content === 'string' && m.content.includes('<context type="loop-guard">'));
}

describe('AgentExecutor tool loop guard (P1)', () => {
  const bus = getGlobalEventBus();
  let loopEvents: Array<Record<string, unknown>>;
  let listenerId: string;

  beforeEach(() => {
    loopEvents = [];
    listenerId = bus.on('agent:loop_detected', (evt) => { loopEvents.push(evt as unknown as Record<string, unknown>); });
  });
  afterEach(() => {
    bus.off(listenerId);
  });

  it('streaming: 5 identical view_file calls inject exactly one guard message and one event', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig());
    const provider = scriptProvider(deps, (round) => (round <= 5 ? [toolCall('view_file', { path: 'src/a.ts' }, round)] : []));
    const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Inspect src/a.ts' }];

    const chunks = await runStream(executor, messages);

    expect(guardMessages(messages)).toHaveLength(1);
    expect(loopEvents).toHaveLength(1);
    expect(loopEvents[0]).toMatchObject({ loopType: 'repeated_call', count: 5 });
    expect(chunks.some((c) => c.type === 'run_event')).toBe(false);
    // The warning does not end the task: the model gets a 6th round and answers.
    expect(provider.rounds()).toBe(6);
    expect(chunks.filter((c) => c.type === 'content' && c.content?.includes('Loop guard:'))).toHaveLength(1);
  });

  it('streaming: recidivism (8 identical calls) stops before maxToolRounds with a distinct run event', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(50));
    const provider = scriptProvider(deps, (round) => [toolCall('view_file', { path: 'src/a.ts' }, round)]);
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Inspect src/a.ts' }];

    const chunks = await runStream(executor, messages);

    expect(provider.rounds()).toBe(8);
    expect((deps.toolHandler.executeTool as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(8);
    const runEvent = chunks.find((c) => c.type === 'run_event');
    expect(runEvent?.runEvent).toMatchObject({ eventType: 'loop_guard_stopped', data: { action: 'stop', loopType: 'repeated_call' } });
    const text = chunks.filter((c) => c.type === 'content').map((c) => c.content).join('');
    expect(text).toContain('Stopped by the loop guard');
    expect(text).not.toContain('Maximum tool execution rounds reached');
    expect(loopEvents.map((e) => e.detail)).toHaveLength(2);
    expect(chunks.at(-1)?.type).toBe('done');
  });

  it('sequential processUserMessage shares the same guard (same runTurnLoop)', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(50));
    const provider = scriptProvider(deps, (round) => [toolCall('view_file', { path: 'src/a.ts' }, round)]);
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Inspect src/a.ts' }];

    const entries = await executor.processUserMessage('Inspect src/a.ts', [], messages);

    expect(provider.rounds()).toBe(8);
    expect(guardMessages(messages)).toHaveLength(1);
    expect(entries.some((e) => e.type === 'assistant' && e.content.includes('Stopped by the loop guard'))).toBe(true);
  });

  it('YOLO round budget (400) does not disable the guard', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(400));
    const provider = scriptProvider(deps, (round) => [toolCall('view_file', { path: 'src/a.ts' }, round)]);
    const chunks = await runStream(executor, [{ role: 'user', content: 'Inspect src/a.ts' }]);
    expect(provider.rounds()).toBe(8);
    expect(chunks.some((c) => c.type === 'run_event' && c.runEvent?.eventType === 'loop_guard_stopped')).toBe(true);
  });

  it('repeat-safe polling tools called 10 times never trigger', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(50));
    scriptProvider(deps, (round) => (round <= 10 ? [toolCall('process', { action: 'list' }, round)] : []));
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'wait for the job' }];
    const chunks = await runStream(executor, messages);
    expect(guardMessages(messages)).toHaveLength(0);
    expect(loopEvents).toHaveLength(0);
    expect(chunks.some((c) => c.type === 'run_event')).toBe(false);
  });

  it('detects an A→B cycle repeated five times', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(50));
    scriptProvider(deps, (round) => (round <= 10
      ? [round % 2 ? toolCall('view_file', { path: 'a' }, round) : toolCall('search', { query: 'a' }, round)]
      : []));
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'loop' }];
    await runStream(executor, messages);
    expect(guardMessages(messages)).toHaveLength(1);
    expect(loopEvents[0]).toMatchObject({ loopType: 'repeated_cycle' });
  });

  it('a new task starts with fresh counters', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(50));
    scriptProvider(deps, (round) => (round <= 4 ? [toolCall('view_file', { path: 'src/a.ts' }, round)] : []));
    const first: CodeBuddyMessage[] = [{ role: 'user', content: 'turn 1' }];
    await runStream(executor, first);
    // Second task: 4 more identical calls — would be 8 in total if counters leaked.
    scriptProvider(deps, (round) => (round <= 4 ? [toolCall('view_file', { path: 'src/a.ts' }, round)] : []));
    const second: CodeBuddyMessage[] = [{ role: 'user', content: 'turn 2' }];
    await runStream(executor, second);
    expect(guardMessages(first)).toHaveLength(0);
    expect(guardMessages(second)).toHaveLength(0);
    expect(loopEvents).toHaveLength(0);
  });

  it('the agent-loop-alert rule template matches the percept produced by the domain bridge', async () => {
    const unwire = wireDomainEventBridge();
    const percepts: Array<{ modality?: string; kind?: string; payload?: unknown }> = [];
    const perceptId = bus.on('sensory:perception', (evt) => {
      const meta = (evt as unknown as { metadata?: { modality?: string; kind?: string; payload?: unknown } }).metadata;
      if (meta) percepts.push(meta);
    });
    try {
      const deps = createDeps();
      const executor = new AgentExecutor(deps, createConfig());
      scriptProvider(deps, (round) => (round <= 5 ? [toolCall('view_file', { path: 'src/a.ts' }, round)] : []));
      await runStream(executor, [{ role: 'user', content: 'Inspect src/a.ts' }]);
      const template = getRuleTemplate('agent-loop-alert');
      expect(template).toBeDefined();
      const rule = template!.build();
      const matching = percepts.filter((p) => ruleMatches(rule, p, new Date('2026-09-15T12:00:00')));
      expect(matching).toHaveLength(1);
      expect(matching[0]?.payload).toMatchObject({ loopType: 'repeated_call', count: 5 });
    } finally {
      bus.off(perceptId);
      unwire();
    }
  });

  it.each(['streaming', 'sequential'] as const)('%s: agent:loop_detected → percept → agent-loop-alert rule fires its alert action', async (mode) => {
    const unwire = wireDomainEventBridge();
    const executed: Array<{ action: unknown; ctx: { modality?: string; kind?: string; payload?: Record<string, unknown> } }> = [];
    const unwireRules = wireSensoryRules({
      rules: [getRuleTemplate('agent-loop-alert')!.build()],
      execute: async (action, ctx) => { executed.push({ action, ctx }); return { ok: true }; },
    });
    try {
      const deps = createDeps();
      const executor = new AgentExecutor(deps, createConfig());
      scriptProvider(deps, (round) => [toolCall('view_file', { path: 'src/a.ts' }, round)]);
      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Inspect src/a.ts' }];
      if (mode === 'streaming') await runStream(executor, messages);
      else await executor.processUserMessage('Inspect src/a.ts', [], messages);
      await new Promise((r) => setTimeout(r, 10));
      // warn + stop emit two events; the rule cooldown (5 min) lets exactly one alert through.
      expect(loopEvents).toHaveLength(2);
      expect(executed).toHaveLength(1);
      expect(executed[0]!.action).toMatchObject({ type: 'alert' });
      expect(executed[0]!.ctx).toMatchObject({ modality: 'agent', kind: 'loop_detected', payload: { loopType: 'repeated_call', count: 5 } });
    } finally {
      unwireRules();
      unwire();
    }
  });

  it('design choice: a changing polling output is progress for the guard, a loop for the older args-only LoopDetectionService', async () => {
    const deps = createDeps();
    let n = 0;
    (deps.toolHandler.executeTool as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ success: true, output: `progress ${++n}%` }));
    const executor = new AgentExecutor(deps, createConfig(50));
    scriptProvider(deps, (round) => (round <= 10 ? [toolCall('view_file', { path: 'build.log' }, round)] : []));
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'watch the build log' }];
    await runStream(executor, messages);
    expect(guardMessages(messages)).toHaveLength(0);
    expect(loopEvents).toHaveLength(0);

    const legacy = new LoopDetectionService(false);
    const verdicts = Array.from({ length: 10 }, () => legacy.checkToolCallLoop({ name: 'view_file', args: { path: 'build.log' } }).isLoop);
    expect(verdicts.includes(true)).toBe(true);
  });
});

describe('first-use restore_context tip (P4)', () => {
  let hintsDir: string;
  // Recovery observations are keyed by tool call id: fresh ids avoid restoring another test's output.
  const uniqueCall = (name: string, args: Record<string, unknown>): Call => ({ id: `call_hint_${Math.random().toString(36).slice(2)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  beforeEach(() => {
    hintsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-hints-'));
    vi.stubEnv('CODEBUDDY_HINTS_DIR', hintsDir);
    vi.stubEnv('CODEBUDDY_LM_RESIZER', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(hintsDir, { recursive: true, force: true });
  });

  it('a shortened tool output shows the tip once per profile, on streaming and sequential runs', async () => {
    const deps = createDeps();
    (deps.toolHandler.executeTool as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, output: Array.from({ length: 4000 }, (_, i) => `build step ${i}: compiled module_${i * 7919 % 10007}.ts`).join('\n') });
    const executor = new AgentExecutor(deps, createConfig(50));
    scriptProvider(deps, (round) => (round === 1 ? [uniqueCall('view_file', { path: 'build.log' })] : []));
    const chunks = await runStream(executor, [{ role: 'user', content: 'read the build log' }]);
    const tips = chunks.filter((c) => c.type === 'content' && c.content?.includes('restore_context'));
    expect(tips).toHaveLength(1);
    expect(fs.existsSync(path.join(hintsDir, 'restore_context'))).toBe(true);

    scriptProvider(deps, (round) => (round === 1 ? [uniqueCall('view_file', { path: 'build.log' })] : []));
    const again = await runStream(executor, [{ role: 'user', content: 'read it again' }]);
    expect(again.filter((c) => c.type === 'content' && c.content?.includes('Tip: long tool outputs'))).toHaveLength(0);

    scriptProvider(deps, (round) => (round === 1 ? [uniqueCall('view_file', { path: 'build.log' })] : []));
    const entries = await executor.processUserMessage('sequential read', [], [{ role: 'user', content: 'sequential read' }]);
    expect(JSON.stringify(entries)).not.toContain('Tip: long tool outputs');
  });

  it('a short tool output never marks the hint', async () => {
    const deps = createDeps();
    const executor = new AgentExecutor(deps, createConfig(50));
    scriptProvider(deps, (round) => (round === 1 ? [toolCall('view_file', { path: 'src/a.ts' }, round)] : []));
    await runStream(executor, [{ role: 'user', content: 'read' }]);
    expect(fs.readdirSync(hintsDir)).toEqual([]);
  });
});
