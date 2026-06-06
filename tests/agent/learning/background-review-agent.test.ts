import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runBackgroundReview,
  BACKGROUND_REVIEW_SENTINEL_ENV,
  type BackgroundReviewClient,
  type ReviewChatMessage,
  type ReviewChatResponse,
} from '../../../src/agent/learning/background-review-agent.js';
import type { HeadlessToolResult } from '../../../src/cloud/headless-tool-executor.js';

const TOOLS = [
  { function: { name: 'remember' } },
  { function: { name: 'skill_manage' } },
  { function: { name: 'write_file' } },
  { function: { name: 'bash' } },
];

/** A scripted client that records the tool array it is handed each turn. */
function scriptedClient(turns: ReviewChatMessage[]): BackgroundReviewClient & {
  seenToolNames: string[];
  chatCalls: number;
} {
  const state = { seenToolNames: [] as string[], chatCalls: 0 };
  return {
    seenToolNames: state.seenToolNames,
    get chatCalls() {
      return state.chatCalls;
    },
    async chat(_messages, tools): Promise<ReviewChatResponse> {
      for (const tool of tools as Array<{ function?: { name?: string } }>) {
        state.seenToolNames.push(tool.function?.name ?? '');
      }
      const message = turns[state.chatCalls] ?? { role: 'assistant', content: 'done' };
      state.chatCalls++;
      return { choices: [{ message }] };
    },
    getCurrentModel: () => 'test-model',
  };
}

let savedSentinel: string | undefined;

describe('background review agent (S4)', () => {
  beforeEach(() => {
    savedSentinel = process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
  });

  afterEach(() => {
    if (savedSentinel === undefined) delete process.env[BACKGROUND_REVIEW_SENTINEL_ENV];
    else process.env[BACKGROUND_REVIEW_SENTINEL_ENV] = savedSentinel;
  });

  it('exposes only the allowed tools to the model and blocks disallowed tool calls', async () => {
    const client = scriptedClient([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', function: { name: 'remember', arguments: '{"content":"prefers French"}' } },
          { id: 'c2', function: { name: 'write_file', arguments: '{"path":"/etc/passwd"}' } },
        ],
      },
      { role: 'assistant', content: 'done' },
    ]);
    const executeTool = vi.fn(
      async (): Promise<HeadlessToolResult> => ({ success: true, output: 'ok' }),
    );

    const result = await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'please answer in French from now on' }],
      mode: 'combined',
      tools: TOOLS,
      executeTool,
    });

    // The model only ever saw the allowed tools.
    expect(new Set(client.seenToolNames)).toEqual(new Set(['remember', 'skill_manage']));
    // The disallowed tool was blocked, never executed.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0]?.[0]).toBe('remember');
    expect(result.blockedToolAttempts).toEqual(['write_file']);
    expect(result.toolCallsMade).toEqual([{ name: 'remember', success: true }]);
    expect(result.summary).toContain('Memory updated');
    expect(result.skipped).toBe(false);
    expect(result.rounds).toBe(2);
  });

  it('no-ops when a review is already in progress (recursion guard)', async () => {
    process.env[BACKGROUND_REVIEW_SENTINEL_ENV] = '1';
    const client = scriptedClient([{ role: 'assistant', content: 'should not run' }]);
    const executeTool = vi.fn(async (): Promise<HeadlessToolResult> => ({ success: true }));

    const result = await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'hi' }],
      mode: 'combined',
      tools: TOOLS,
      executeTool,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('nested review suppressed');
    expect(client.chatCalls).toBe(0);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('restores the sentinel after the run so later reviews are not suppressed', async () => {
    const client = scriptedClient([{ role: 'assistant', content: 'done' }]);
    expect(process.env[BACKGROUND_REVIEW_SENTINEL_ENV]).toBeUndefined();

    await runBackgroundReview({
      client,
      transcript: [{ role: 'user', content: 'hi' }],
      mode: 'memory',
      tools: TOOLS,
      executeTool: async () => ({ success: true }),
    });

    expect(process.env[BACKGROUND_REVIEW_SENTINEL_ENV]).toBeUndefined();
  });
});
