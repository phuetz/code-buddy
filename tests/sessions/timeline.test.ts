import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentExecutor,
  type ExecutorConfig,
  type ExecutorDependencies,
  type TimelineTurnData,
} from '../../src/agent/execution/agent-executor.js';
import type { ChatEntry } from '../../src/agent/types.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { SessionTimeline, type TimelineEntry } from '../../src/sessions/timeline.js';

function entry(turn: number, preview = `turn ${turn}`): TimelineEntry {
  return {
    turn,
    ts: new Date(2026, 0, 1, 12, 0, turn).toISOString(),
    role: 'assistant',
    textPreview: preview,
    toolCalls: [{ name: 'view_file', ok: true }],
    filesTouched: turn === 1 ? ['src/one.ts'] : [],
  };
}

function executorConfig(): ExecutorConfig {
  return {
    maxToolRounds: 2,
    isGrokModel: () => false,
    recordSessionCost: () => undefined,
    isSessionCostLimitReached: () => false,
    estimateSessionCostLimitReached: () => false,
    getSessionCost: () => 0,
    getSessionCostLimit: () => 10,
  };
}

function executorDependencies(recordTimelineTurn: (turn: TimelineTurnData) => Promise<void>): ExecutorDependencies {
  const client = {
    chatStream: async function* () {
      yield { choices: [{ delta: { content: 'Timeline response' } }] };
    },
    chat: vi.fn(),
    getCurrentModel: () => 'test-model',
    getProviderName: () => 'test-provider',
  };
  const toolHandler = {
    getWorkingDirectory: () => process.cwd(),
    executeTool: vi.fn(),
    executeToolStreaming: vi.fn(),
  };
  const toolSelectionStrategy = {
    selectToolsForQuery: async () => ({
      tools: [],
      selection: null,
      fromCache: false,
      query: 'hello',
      timestamp: new Date(),
    }),
    cacheTools: () => undefined,
    shouldUseSearchFor: () => false,
    expandCachedTools: async () => 0,
  };
  const streamingHandler = {
    reset: () => undefined,
    accumulateChunk: () => ({
      displayContent: 'Timeline response',
      rawContent: 'Timeline response',
      hasNewToolCalls: false,
      shouldEmitTokenCount: false,
    }),
    extractToolCalls: () => ({ toolCalls: [], remainingContent: '' }),
    getAccumulatedMessage: () => ({ content: 'Timeline response', tool_calls: undefined }),
    getTokenCount: () => 4,
    hasYieldedToolCalls: () => false,
  };
  const contextManager = {
    prepareMessages: (messages: CodeBuddyMessage[]) => messages,
    prepareMessagesRaw: (messages: CodeBuddyMessage[]) => messages,
    shouldWarn: () => ({ warn: false }),
    getContextEngine: () => null,
  };
  const tokenCounter = {
    countTokens: () => 4,
    countMessageTokens: () => 8,
  };

  return {
    client,
    toolHandler,
    toolSelectionStrategy,
    streamingHandler,
    contextManager,
    tokenCounter,
    recordTimelineTurn,
  } as unknown as ExecutorDependencies;
}

describe('SessionTimeline', () => {
  let tempDir: string;
  let previousTimelineEnv: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-timeline-'));
    previousTimelineEnv = process.env.CODEBUDDY_TIMELINE;
    delete process.env.CODEBUDDY_TIMELINE;
  });

  afterEach(async () => {
    if (previousTimelineEnv === undefined) delete process.env.CODEBUDDY_TIMELINE;
    else process.env.CODEBUDDY_TIMELINE = previousTimelineEnv;
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('records, lists, and gets turns in turn order', async () => {
    const timeline = new SessionTimeline('session-order', { directory: tempDir });
    await timeline.record(entry(2));
    await timeline.record(entry(1));

    const listed = await timeline.list('session-order');
    expect(listed.map((item) => item.turn)).toEqual([1, 2]);
    expect(await timeline.get('session-order', 2)).toMatchObject({
      turn: 2,
      textPreview: 'turn 2',
    });
  });

  it('truncates previews to 400 characters without storing the full message', async () => {
    const timeline = new SessionTimeline('session-preview', { directory: tempDir });
    await timeline.record(entry(1, 'x'.repeat(450)));

    const stored = await timeline.get('session-preview', 1);
    expect(stored?.textPreview).toHaveLength(400);
    expect(stored?.textPreview).toBe('x'.repeat(400));
  });

  it('never throws when timeline storage is not writable', async () => {
    const nonDirectory = path.join(tempDir, 'read-only-simulation');
    await fs.writeFile(nonDirectory, 'not a directory');
    const timeline = new SessionTimeline('session-blocked', { directory: nonDirectory });

    await expect(timeline.record(entry(1))).resolves.toBeUndefined();
    await expect(timeline.list('session-blocked')).resolves.toEqual([]);
  });

  it('writes one entry for a simulated turn only when the env var is enabled', async () => {
    const sessionId = 'session-wiring';
    const timeline = new SessionTimeline(sessionId, { directory: tempDir });
    const record = async (turn: TimelineTurnData): Promise<void> => {
      await timeline.record({
        turn: turn.turn,
        ts: turn.ts,
        role: turn.role,
        textPreview: turn.text,
        toolCalls: turn.toolCalls,
        filesTouched: turn.filesTouched,
      });
    };
    const history: ChatEntry[] = [{
      type: 'user',
      content: 'hello',
      timestamp: new Date(),
    }];
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'hello' }];

    process.env.CODEBUDDY_TIMELINE = 'true';
    await new AgentExecutor(executorDependencies(record), executorConfig()).processUserMessage(
      'hello',
      history,
      messages,
      Date.now(),
      undefined,
      false,
      'http',
    );
    expect(await timeline.list(sessionId)).toHaveLength(1);

    const disabledId = 'session-disabled';
    const disabledTimeline = new SessionTimeline(disabledId, { directory: tempDir });
    delete process.env.CODEBUDDY_TIMELINE;
    await new AgentExecutor(
      executorDependencies(async (turn) => {
        await disabledTimeline.record({
          turn: turn.turn,
          ts: turn.ts,
          role: turn.role,
          textPreview: turn.text,
          toolCalls: turn.toolCalls,
          filesTouched: turn.filesTouched,
        });
      }),
      executorConfig(),
    ).processUserMessage(
      'hello',
      [{ type: 'user', content: 'hello', timestamp: new Date() }],
      [{ role: 'user', content: 'hello' }],
      Date.now(),
      undefined,
      false,
      'http',
    );
    expect(await disabledTimeline.list(disabledId)).toEqual([]);
    await expect(fs.access(path.join(tempDir, `${disabledId}.jsonl`))).rejects.toThrow();
  });
});
