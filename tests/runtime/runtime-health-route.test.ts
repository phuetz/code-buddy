import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/database/database-manager.js', () => ({
  getDatabaseManager: () => ({ isInitialized: () => true,
    getDatabase: () => ({ prepare: () => ({ get: () => ({ ok: 1 }) }) }) }),
}));
vi.mock('../../src/runtime/runtime-status.js', () => ({
  getServerRuntimeStatus: () => ({
    execution: { version: '8.1.0', revision: 'a'.repeat(40), verified: true },
    lastEffectiveCall: { provider: 'openrouter', model: 'served-model', observedAt: '2026-09-26T00:00:00.000Z' },
    services: [{ name: 'server (this process)', state: 'active', version: '8.1.0' }],
    environmentEnabled: ['CODEBUDDY_SENSORY'], alerts: [],
  }),
}));

import router from '../../src/server/routes/health.js';

describe('public health route runtime evidence', () => {
  it('includes the executed revision and last effective provider without a network listener', async () => {
    const route = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: Request, res: Response, next: (error?: unknown) => void) => void }> } }> })
      .stack.find((entry) => entry.route?.path === '/')?.route;
    expect(route).toBeDefined();
    const body = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const response = {
        status: () => response,
        json: (value: Record<string, unknown>) => { resolve(value); return response; },
      } as unknown as Response;
      route!.stack[0]!.handle({} as Request, response, reject);
    });
    const runtime = body.runtime as Record<string, unknown>;
    expect(runtime.execution).toMatchObject({ revision: 'a'.repeat(40), verified: true });
    expect(runtime.lastEffectiveCall).toMatchObject({ provider: 'openrouter', model: 'served-model' });
    expect(JSON.stringify(body)).not.toContain('apiKey');
  });
});
