import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { manager, triggers } = vi.hoisted(() => {
  const triggerList: Array<Record<string, unknown>> = [];
  return {
    triggers: triggerList,
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

import { createWebhookRoutes } from '../../src/server/routes/webhooks.js';

describe('webhook HTTP routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/webhooks', createWebhookRoutes());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    triggers.length = 0;
    vi.clearAllMocks();
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
});
