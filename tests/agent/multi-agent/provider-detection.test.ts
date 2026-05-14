import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeBuddyClient } from '../../../src/codebuddy/client.js';
import { MultiAgentSystem } from '../../../src/agent/multi-agent/multi-agent-system.js';
import type { AgentRole } from '../../../src/agent/multi-agent/types.js';

const ENV_KEYS = [
  'CODEBUDDY_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
] as const;

const envBackup: Partial<Record<typeof ENV_KEYS[number], string>> = {};

function getClient(system: MultiAgentSystem, role: AgentRole): CodeBuddyClient {
  const agent = system.getAgent(role);
  if (!agent) throw new Error(`Missing agent ${role}`);
  return (agent as unknown as { client: CodeBuddyClient }).client;
}

describe('MultiAgentSystem provider auto-detection', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
  });

  it('uses the detected OpenAI transport and model when no API key is passed', () => {
    process.env.CODEBUDDY_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENAI_MODEL = 'gpt-5.1-codex';

    const system = new MultiAgentSystem('');

    for (const role of ['orchestrator', 'coder', 'reviewer', 'tester'] as const) {
      const client = getClient(system, role);
      expect(client.getBaseURL()).toBe('https://api.openai.com/v1');
      expect(client.getCurrentModel()).toBe('gpt-5.1-codex');
    }
  });

  it('does not override explicit heterogeneous per-agent providers', () => {
    process.env.CODEBUDDY_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENAI_MODEL = 'gpt-5.1-codex';

    const system = new MultiAgentSystem('', undefined, undefined, {
      reviewer: {
        providerOverride: {
          apiKey: 'review-key',
          baseURL: 'https://review.example/v1',
          model: 'review-model',
        },
      },
    });

    expect(getClient(system, 'coder').getBaseURL()).toBe('https://api.openai.com/v1');
    expect(getClient(system, 'coder').getCurrentModel()).toBe('gpt-5.1-codex');
    expect(getClient(system, 'reviewer').getBaseURL()).toBe('https://review.example/v1');
    expect(getClient(system, 'reviewer').getCurrentModel()).toBe('review-model');
  });
});
