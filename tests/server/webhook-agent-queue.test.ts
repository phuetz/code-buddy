import { describe, expect, it, vi } from 'vitest';

const { agent, buildHttpAgentSessionKey, runAgentCompletion, withHttpSessionAgent } = vi.hoisted(() => {
  const fakeAgent = { kind: 'fake-agent' };
  return {
    agent: fakeAgent,
    buildHttpAgentSessionKey: vi.fn(() => 'webhook-session-r21'),
    runAgentCompletion: vi.fn(async () => ({ content: 'done', finishReason: 'stop' })),
    withHttpSessionAgent: vi.fn(async (_key: string, operation: (value: unknown) => Promise<unknown>) =>
      operation(fakeAgent)
    ),
  };
});

vi.mock('../../src/server/agent-adapter.js', () => ({ runAgentCompletion }));
vi.mock('../../src/server/http-agent-sessions.js', () => ({
  buildHttpAgentSessionKey,
  withHttpSessionAgent,
}));

import { enqueueWebhookAgentRun } from '../../src/server/webhook-agent-queue.js';

describe('webhook agent queue', () => {
  it('exécute le prompt mis en file comme un vrai tour d’agent', async () => {
    const accepted = enqueueWebhookAgentRun({
      prompt: 'Review the push',
      source: 'github',
      triggerId: 'trigger-r21',
      eventType: 'push',
    });

    expect(accepted.runId).toMatch(/^webhook_/);
    await vi.waitFor(() => expect(runAgentCompletion).toHaveBeenCalledOnce());
    expect(buildHttpAgentSessionKey).toHaveBeenCalledWith('webhook', accepted.runId);
    expect(withHttpSessionAgent).toHaveBeenCalledWith('webhook-session-r21', expect.any(Function));
    expect(runAgentCompletion).toHaveBeenCalledWith(agent, 'Review the push', { surface: 'webhook' });
  });
});
