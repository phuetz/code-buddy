/**
 * Fleet P1 — verify per-agent provider override works so a single
 * MultiAgentSystem can fan out N sub-agents to N different providers
 * (Claude / Codex / Gemini / Ollama) in parallel via Promise.all.
 */
import { describe, expect, it } from 'vitest';
import { CodeBuddyClient } from '../../../src/codebuddy/client.js';
import { OrchestratorAgent } from '../../../src/agent/multi-agent/agents/orchestrator-agent.js';
import type { AgentConfig } from '../../../src/agent/multi-agent/types.js';

function getClient(agent: OrchestratorAgent): CodeBuddyClient {
  return (agent as unknown as { client: CodeBuddyClient }).client;
}

function expectClient(
  agent: OrchestratorAgent,
  expected: { apiKey?: string; model?: string; baseURL?: string },
): void {
  const client = getClient(agent) as unknown as CodeBuddyClient & { apiKey: string };
  if (expected.apiKey !== undefined) expect(client.apiKey).toBe(expected.apiKey);
  if (expected.model !== undefined) expect(client.getCurrentModel()).toBe(expected.model);
  if (expected.baseURL !== undefined) expect(client.getBaseURL()).toBe(expected.baseURL);
}

describe('Per-agent provider override (Fleet P1)', () => {
  it('falls back to system-wide (apiKey, baseURL) when no override is set', () => {
    const agent = new OrchestratorAgent('system-key', 'https://system.example/v1');
    expectClient(agent, {
      apiKey: 'system-key',
      baseURL: 'https://system.example/v1',
    });
  });

  it('applies override.apiKey while keeping system baseURL when override.baseURL absent', () => {
    const agent = new OrchestratorAgent('system-key', 'https://system.example/v1', {
      providerOverride: { apiKey: 'agent-key' },
    });
    expectClient(agent, {
      apiKey: 'agent-key',
      baseURL: 'https://system.example/v1',
    });
  });

  it('applies full override (apiKey + baseURL + model)', () => {
    const agent = new OrchestratorAgent('system-key', 'https://system.example/v1', {
      providerOverride: {
        apiKey: 'claude-key',
        baseURL: 'https://api.anthropic.com/v1',
        model: 'claude-opus-4',
      },
    });
    expectClient(agent, {
      apiKey: 'claude-key',
      baseURL: 'https://api.anthropic.com/v1',
      model: 'claude-opus-4',
    });
  });

  it('override.model takes precedence over config.model', () => {
    const agent = new OrchestratorAgent('k', 'https://system.example/v1', {
      model: 'grok-3-latest',
      providerOverride: { model: 'qwen3.6:35b' },
    });
    expectClient(agent, { model: 'qwen3.6:35b' });
  });

  it('config.model still wins when override.model is absent', () => {
    const agent = new OrchestratorAgent('k', 'https://system.example/v1', {
      model: 'claude-haiku-4',
      providerOverride: { apiKey: 'k2' },
    });
    expectClient(agent, {
      apiKey: 'k2',
      model: 'claude-haiku-4',
    });
  });

  it('BaseAgent legacy default model wins when both override.model and overrides.model are absent', () => {
    const agent = new OrchestratorAgent('k');
    expectClient(agent, { model: 'grok-3-latest' });
  });

  it('spawns four heterogeneous agents in parallel without provider leakage', async () => {
    const providers: Array<{
      name: string;
      override: NonNullable<AgentConfig['providerOverride']>;
    }> = [
      {
        name: 'claude',
        override: {
          apiKey: 'ant-key',
          baseURL: 'https://api.anthropic.com/v1',
          model: 'claude-opus-4',
        },
      },
      {
        name: 'codex',
        override: {
          apiKey: 'openai-key',
          baseURL: 'https://api.openai.com/v1',
          model: 'gpt-5-codex',
        },
      },
      {
        name: 'gemini',
        override: {
          apiKey: 'gemini-key',
          baseURL: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-2.5-pro',
        },
      },
      {
        name: 'ollama',
        override: {
          apiKey: 'ollama',
          baseURL: 'http://127.0.0.1:11434/v1',
          model: 'qwen3.6:35b-a3b-q4_K_M',
        },
      },
    ];

    const agents = await Promise.all(
      providers.map(
        (provider) =>
          new OrchestratorAgent('fallback-key', undefined, {
            name: provider.name,
            providerOverride: provider.override,
          }),
      ),
    );

    expect(agents).toHaveLength(4);
    const clients = agents.map(getClient);
    expect(clients.map((client) => client.getCurrentModel()).sort()).toEqual([
      'claude-opus-4',
      'gemini-2.5-pro',
      'gpt-5-codex',
      'qwen3.6:35b-a3b-q4_K_M',
    ]);
    expectClient(agents[0], { apiKey: 'ant-key' });
    expectClient(agents[3], { baseURL: 'http://127.0.0.1:11434/v1' });
  });
});
