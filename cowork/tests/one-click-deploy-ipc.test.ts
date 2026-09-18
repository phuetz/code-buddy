import { describe, expect, it, vi } from 'vitest';
import { ONE_CLICK_DEPLOY_CHANNEL, registerOneClickDeployIpc } from '../src/main/one-click-deploy-ipc.js';
import type { OneClickReport } from '../../src/deploy/one-click-types.js';

describe('registerOneClickDeployIpc', () => {
  it('forces dry-run unless apply is explicitly true', async () => {
    const run = vi.fn(async (req: { apply?: boolean; dryRun?: boolean }) => {
      return {
        ok: true,
        dryRun: req.dryRun !== false,
        projectRoot: '/x',
        durationMs: 1,
        steps: [],
        rollback: { supported: false, summary: '', commands: [] },
      } satisfies OneClickReport;
    });
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn);
      },
    };
    registerOneClickDeployIpc(ipcMain, run);
    const handler = handlers.get(ONE_CLICK_DEPLOY_CHANNEL);
    expect(handler).toBeTypeOf('function');
    await handler?.({}, { projectRoot: '/x' });
    expect(run).toHaveBeenCalledWith({ projectRoot: '/x', apply: false, dryRun: true });
    await handler?.({}, { projectRoot: '/x', apply: true, dryRun: true });
    expect(run).toHaveBeenLastCalledWith({ projectRoot: '/x', apply: false, dryRun: true });
    await handler?.({}, { projectRoot: '/x', apply: true });
    expect(run).toHaveBeenLastCalledWith({ projectRoot: '/x', apply: true, dryRun: false });
  });
});
