import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueWebhookAgentRun, manager, triggers } = vi.hoisted(() => {
  const triggerList: Array<Record<string, unknown>> = [];
  return {
    triggers: triggerList,
    enqueueWebhookAgentRun: vi.fn(),
    manager: {
      load: vi.fn(async () => undefined),
      handleWebhook: vi.fn(async () => ({ fired: false, eventType: 'generic' })),
      addTrigger: vi.fn((trigger: Record<string, unknown>) => {
        trigger.id ||= 'trigger-r21';
        trigger.createdAt ||= '2026-09-02T00:00:00.000Z';
        triggerList.push(trigger);
      }),
      save: vi.fn(async () => undefined),
      listTriggers: vi.fn(() => triggerList),
      getTrigger: vi.fn((id: string) => triggerList.find((trigger) => trigger.id === id)),
      removeTrigger: vi.fn(),
    },
  };
});

vi.mock('../../src/triggers/webhook-trigger.js', () => ({
  getWebhookTriggerManager: () => manager,
}));

vi.mock('../../src/server/webhook-agent-queue.js', () => ({
  enqueueWebhookAgentRun,
}));

import { createWebhookRoutes } from '../../src/server/routes/webhooks.js';
import { errorHandler } from '../../src/server/middleware/index.js';

describe('webhook HTTP routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/webhooks', createWebhookRoutes());
    app.use(errorHandler);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    triggers.length = 0;
    vi.clearAllMocks();
    enqueueWebhookAgentRun.mockReturnValue({
      runId: 'webhook-run-r21',
      acceptedAt: '2026-09-02T00:00:00.000Z',
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('POST /triggers atteint la route de création et crée le trigger', async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'R21 trigger',
        source: 'github',
        events: ['push'],
        action: 'Review the push',
      }),
    });

    expect(response.status).toBe(201);
    expect(manager.addTrigger).toHaveBeenCalledOnce();
    expect(manager.save).toHaveBeenCalledOnce();
    expect(manager.listTriggers()).toContainEqual(expect.objectContaining({
      id: 'trigger-r21',
      name: 'R21 trigger',
      source: 'github',
    }));
  });

  it('POST /:source répond 202 avec un run seulement après mise en file', async () => {
    manager.handleWebhook.mockResolvedValueOnce({
      fired: true,
      triggerId: 'trigger-r21',
      eventType: 'push',
      prompt: 'Review the push',
    });

    const response = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'push' },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    });
    const body = await response.json() as { status?: string; runId?: string };

    expect(response.status).toBe(202);
    expect(body).toEqual({ status: 'accepted', runId: 'webhook-run-r21' });
    expect(enqueueWebhookAgentRun).toHaveBeenCalledWith({
      prompt: 'Review the push',
      source: 'github',
      triggerId: 'trigger-r21',
      eventType: 'push',
    });
  });

  it('POST /:source propage une erreur si la mise en file échoue', async () => {
    manager.handleWebhook.mockResolvedValueOnce({
      fired: true,
      triggerId: 'trigger-r21',
      eventType: 'push',
      prompt: 'Review the push',
    });
    enqueueWebhookAgentRun.mockImplementationOnce(() => {
      throw new Error('queue full');
    });

    const response = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await response.json() as { code?: string; message?: string; runId?: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.message).toContain('queue full');
    expect(body.runId).toBeUndefined();
  });
});
