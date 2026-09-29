import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createColabGoalJudge } from '../../src/daemon/colab-goal.js';
import type { ColabTask } from '../../src/fleet/colab-store.js';
import type { TaskExecutionResult } from '../../src/daemon/autonomous-loop.js';
import type { AutonomousModelChoice } from '../../src/agent/model-tier.js';
import { judgeGoal } from '../../src/goals/goal-judge.js';

const mockState = vi.hoisted(() => ({
  judgeModel: 'gpt-5.5',
  clients: [] as Array<{ apiKey: string; model: string; baseURL?: string }>,
}));

vi.mock('../../src/codebuddy/client.js', () => ({
  CHATGPT_OAUTH_SENTINEL: 'oauth-chatgpt',
  CHATGPT_RESPONSES_BASE_URL: 'https://chatgpt.com/backend-api/codex',
  CodeBuddyClient: class MockCodeBuddyClient {
    private model: string;

    constructor(apiKey: string, model: string, baseURL?: string) {
      this.model = model;
      mockState.clients.push({ apiKey, model, ...(baseURL ? { baseURL } : {}) });
    }

    getCurrentModel(): string {
      return this.model;
    }
  },
}));

vi.mock('../../src/providers/codex-oauth.js', () => ({
  hasCodexCredentials: vi.fn(() => true),
}));

vi.mock('../../src/goals/goal-manager.js', () => ({
  resolveGoalsConfig: vi.fn(() => ({
    maxTurns: 20,
    judgeModel: mockState.judgeModel,
    judgeMaxTokens: 4096,
    judgeTimeoutMs: 30000,
  })),
}));

vi.mock('../../src/goals/goal-judge.js', () => ({
  judgeGoal: vi.fn(async (client: { getCurrentModel?: () => string }) => ({
    verdict: 'done',
    reason: `judge=${client.getCurrentModel?.()}`,
    parseFailed: false,
  })),
}));

describe('createColabGoalJudge judge client routing', () => {
  beforeEach(() => {
    mockState.judgeModel = 'gpt-5.5';
    mockState.clients = [];
    vi.mocked(judgeGoal).mockClear();
  });

  it('uses a standalone ChatGPT OAuth judge when a local worker is configured with gpt-5.5 judge', async () => {
    const judge = createColabGoalJudge();
    const task = {
      id: 't1',
      title: 'ship goal task',
      description: 'prove it',
      status: 'open',
      priority: 'medium',
    } as ColabTask;
    const result = { ok: true, summary: 'done', output: 'evidence' } as TaskExecutionResult;
    const model = {
      model: 'qwen3.5-ctx32k',
      baseUrl: 'http://127.0.0.1:11434/v1',
      tier: 'local',
      paid: false,
      reason: 'test',
    } as AutonomousModelChoice;

    const outcome = await judge(task, result, model);

    expect(outcome).toMatchObject({ verdict: 'done', reason: 'judge=gpt-5.5' });
    expect(mockState.clients).toEqual([
      {
        apiKey: 'local',
        model: 'qwen3.5-ctx32k',
        baseURL: 'http://127.0.0.1:11434/v1',
      },
      {
        apiKey: 'oauth-chatgpt',
        model: 'gpt-5.5',
        baseURL: 'https://chatgpt.com/backend-api/codex',
      },
    ]);
    expect(vi.mocked(judgeGoal).mock.calls[0]?.[0]).toHaveProperty('getCurrentModel');
    expect(vi.mocked(judgeGoal).mock.calls[0]?.[1]).toMatchObject({
      model: 'gpt-5.5',
      maxTokens: 4096,
      timeoutMs: 30000,
    });
  });
});
