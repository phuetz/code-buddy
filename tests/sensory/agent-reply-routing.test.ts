import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routingState = vi.hoisted(() => ({
  candidates: [] as Array<{
    provider: string;
    model: string;
    apiKey: string;
    baseURL: string;
    isLocal: boolean;
    costInputUsdPerMtok: number;
    strengths: string[];
  }>,
  fallback: {
    model: 'local-fallback',
    apiKey: 'ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
  },
  hasCodexCredentials: vi.fn(() => false),
  routes: [] as Array<{ model: string; apiKey: string; baseURL?: string }>,
  selectOptions: [] as Array<{ localOnly?: boolean; requireToolCalling?: boolean }>,
}));

vi.mock('../../src/fleet/model-selector.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/fleet/model-selector.js')>();
  return {
    ...actual,
    selectFastestModel: vi.fn(
      async (
        task: string,
        options?: { localOnly?: boolean; requireToolCalling?: boolean },
      ) => {
        routingState.selectOptions.push({
          localOnly: options?.localOnly,
          requireToolCalling: options?.requireToolCalling,
        });
        return actual.selectFastestModel(task, {
          ...options,
          candidates: routingState.candidates as never,
          scoreboard: { ranking: () => [] } as never,
        });
      },
    ),
  };
});

vi.mock('../../src/sensory/voice-loop.js', () => ({
  resolveVoiceModel: vi.fn(async () => routingState.fallback),
}));

vi.mock('../../src/providers/codex-oauth.js', () => ({
  hasCodexCredentials: routingState.hasCodexCredentials,
}));

vi.mock('../../src/codebuddy/client.js', () => ({
  CHATGPT_RESPONSES_BASE_URL: 'https://chatgpt.com/backend-api/codex/responses',
}));

vi.mock('../../src/agent/codebuddy-agent.js', () => {
  class FakeCodeBuddyAgent {
    readonly systemPromptReady = Promise.resolve();

    constructor(apiKey: string, baseURL: string | undefined, model: string) {
      routingState.routes.push({ model, apiKey, baseURL });
    }

    async getMCPReady(): Promise<void> {}

    async *processUserMessageStream(): AsyncGenerator<{ type: string }> {
      yield { type: 'done' };
    }

    async processUserMessage(): Promise<Array<{ type: string; content: string }>> {
      return [{ type: 'assistant', content: 'Route prête.' }];
    }

    getChatHistory(): Array<{ type: string; content: string }> {
      return [{ type: 'assistant', content: 'Route prête.' }];
    }

    abortCurrentOperation(): void {}

    dispose(): void {}
  }

  return { CodeBuddyAgent: FakeCodeBuddyAgent };
});

import { makeAgentReply } from '../../src/sensory/agent-reply.js';

const SAVED_ENV = {
  agentModel: process.env.CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL,
  localOnly: process.env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY,
};

describe('agent-reply ACT model routing', () => {
  beforeEach(() => {
    delete process.env.CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL;
    delete process.env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY;
    routingState.candidates.length = 0;
    routingState.routes.length = 0;
    routingState.selectOptions.length = 0;
    routingState.hasCodexCredentials.mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    if (SAVED_ENV.agentModel === undefined) {
      delete process.env.CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL;
    } else {
      process.env.CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL = SAVED_ENV.agentModel;
    }
    if (SAVED_ENV.localOnly === undefined) {
      delete process.env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY;
    } else {
      process.env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY = SAVED_ENV.localOnly;
    }
  });

  it('keeps ACT routing local when local-only privacy is enabled', async () => {
    process.env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY = 'true';
    routingState.candidates.push(
      {
        provider: 'cloud',
        model: 'cloud-fast',
        apiKey: 'cloud-key',
        baseURL: 'https://cloud.example/v1',
        isLocal: false,
        costInputUsdPerMtok: 0,
        strengths: ['fast', 'tool-calling'],
      },
      {
        provider: 'ollama',
        model: 'qwen3:14b',
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        isLocal: true,
        costInputUsdPerMtok: 0,
        strengths: ['tool-calling'],
      },
    );

    const reply = makeAgentReply({ summarize: async (output) => output });
    await expect(reply('inspecte le dépôt')).resolves.toBe('Route prête.');

    expect(routingState.selectOptions).toEqual([
      { requireToolCalling: true, localOnly: true },
    ]);
    expect(routingState.routes).toEqual([
      {
        model: 'qwen3:14b',
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
      },
    ]);
  });

  it('uses the fallback model name when a pinned ChatGPT model has no OAuth credentials', async () => {
    process.env.CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL = 'gpt-5.5';

    const reply = makeAgentReply({ summarize: async (output) => output });
    await expect(reply('inspecte le dépôt')).resolves.toBe('Route prête.');

    expect(routingState.hasCodexCredentials).toHaveBeenCalledOnce();
    expect(routingState.routes).toEqual([
      {
        model: 'local-fallback',
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
      },
    ]);
  });
});
