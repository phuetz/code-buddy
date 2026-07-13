import { beforeEach, describe, expect, it, vi } from 'vitest';

const goalState = vi.hoisted(() => ({
  processedPrompts: [] as string[],
  goalCalls: [] as Array<{
    sessionKey?: string;
    lastResponse?: string;
    interrupted?: boolean;
  }>,
}));

vi.mock('../../src/agent/codebuddy-agent.js', () => {
  class FakeCodeBuddyAgent {
    addToHistory() {}
    setWorkingDirectory() {}
    setSystemPromptAppend() {}
    getClient() {
      return {};
    }
    async *processUserMessageStream(prompt: string) {
      goalState.processedPrompts.push(prompt);
      yield { type: 'content', content: `answer:${prompt}` };
      if (prompt === 'initial') {
        yield {
          type: 'tool_result',
          toolCall: { id: 'tool-1', function: { name: 'bash', arguments: '{}' } },
          toolResult: {
            success: true,
            output: 'tool proof',
            metadata: {
              contextOptimization: {
                optimizer: 'lm-resizer',
                reason: 'optimized',
                rawRef: 'tool-1',
                originalBytes: 1_000,
                finalBytes: 180,
                bytesSaved: 820,
                transport: 'cli',
              },
            },
          },
        };
      }
      yield { type: 'done' };
    }
    dispose() {}
  }

  return { CodeBuddyAgent: FakeCodeBuddyAgent };
});

vi.mock('../../src/goals/goal-loop.js', () => ({
  maybeContinueGoalAfterTurn: vi.fn(async (options: {
    sessionKey?: string;
    lastResponse?: string;
    interrupted?: boolean;
  }) => {
    goalState.goalCalls.push(options);
    if (goalState.goalCalls.length === 1) {
      return {
        message: 'Continuing toward goal (1/20): needs another turn',
        continuationPrompt: 'next prompt',
      };
    }
    return {
      message: 'Goal done (2/20): finished',
    };
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/codebuddy/tools.js', () => ({
  getMCPManager: () => ({ addServer: vi.fn(), removeServer: vi.fn() }),
}));

import { CodeBuddyEngineAdapter } from '../../src/desktop/codebuddy-engine-adapter';

describe('CodeBuddyEngineAdapter goal loop', () => {
  beforeEach(() => {
    goalState.processedPrompts.length = 0;
    goalState.goalCalls.length = 0;
  });

  it('continues an active Cowork goal with per-session goal state and tool evidence', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    const events: Array<{
      type: string;
      content?: string;
      tool?: { contextOptimization?: { rawRef: string; bytesSaved: number } };
    }> = [];

    await adapter.runSession(
      'sess-goal',
      [{ role: 'user', content: 'initial' }],
      (event) => events.push(event as { type: string; content?: string })
    );

    expect(goalState.processedPrompts).toEqual(['initial', 'next prompt']);
    expect(goalState.goalCalls[0]).toMatchObject({
      sessionKey: 'cowork:sess-goal',
      interrupted: false,
    });
    expect(goalState.goalCalls[0]?.lastResponse).toContain('answer:initial');
    expect(goalState.goalCalls[0]?.lastResponse).toContain('[tool:bash success]');
    expect(goalState.goalCalls[0]?.lastResponse).toContain('tool proof');

    const streamed = events
      .filter((event) => event.type === 'content')
      .map((event) => event.content ?? '')
      .join('');
    expect(streamed).toContain('Continuing toward goal');
    expect(streamed).toContain('answer:next prompt');
    expect(streamed).toContain('Goal done');
    expect(events.find((event) => event.type === 'tool_end')?.tool?.contextOptimization)
      .toMatchObject({ rawRef: 'tool-1', bytesSaved: 820 });
  });
});
