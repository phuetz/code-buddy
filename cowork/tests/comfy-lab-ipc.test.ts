import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerComfyLabIpc } from '../src/main/comfy-lab/comfy-lab-ipc';
import type { ComfyLabService } from '../src/main/comfy-lab/comfy-lab-service';
import { COMFY_LAB_CHANNELS } from '../src/shared/comfy-lab';

describe('Comfy Lab IPC', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
  const service = {
    inspect: vi.fn(async () => ({ schemaVersion: 1 })),
    openComfyUi: vi.fn(async () => ({ ok: true })),
    copyPlan: vi.fn(async () => ({ ok: true, plan: '# safe plan' })),
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerComfyLabIpc(ipcMain as never, service as unknown as ComfyLabService);
  });

  it('registers only inspect, local open, and derived plan-copy channels', () => {
    expect([...handlers.keys()]).toEqual(Object.values(COMFY_LAB_CHANNELS));
    expect(Object.values(COMFY_LAB_CHANNELS).some((channel) => (
      /download|install|execute|queue|remote/iu.test(channel)
    ))).toBe(false);
  });

  it('rejects arbitrary plan identifiers before reaching the service', async () => {
    const handler = handlers.get(COMFY_LAB_CHANNELS.copyPlan)!;

    await expect(handler({}, { useCaseId: 'attacker-workflow', prompt: 'execute me' }))
      .resolves.toMatchObject({ ok: false });
    expect(service.copyPlan).not.toHaveBeenCalled();

    await expect(handler({}, { useCaseId: 'wan-animatic', prompt: 'ignored' }))
      .resolves.toMatchObject({ ok: true });
    expect(service.copyPlan).toHaveBeenCalledWith('wan-animatic');
  });

  it('returns bounded failures instead of rejecting IPC calls', async () => {
    service.inspect.mockRejectedValueOnce(new Error('x'.repeat(1_000)));
    const result = await handlers.get(COMFY_LAB_CHANNELS.inspect)!({}) as {
      ok: boolean;
      error: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toHaveLength(500);
  });
});
