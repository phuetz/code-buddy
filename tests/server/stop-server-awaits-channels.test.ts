import type { Server } from 'http';
import { describe, expect, it, vi } from 'vitest';

const { shutdown } = vi.hoisted(() => ({ shutdown: vi.fn() }));
vi.mock('../../src/channels/index.js', () => ({
  getChannelManager: () => ({ shutdown }),
}));

describe('server shutdown completion', () => {
  it('awaits channel shutdown before closing HTTP and resolving', async () => {
    const { stopServer } = await import('../../src/server/index.js');
    let release!: () => void;
    shutdown.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const close = vi.fn((callback: (error?: Error) => void) => callback());
    const stopping = stopServer({ close } as unknown as Server);
    try {
      await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
      expect(close).not.toHaveBeenCalled();
    } finally {
      release();
      await stopping;
    }
    expect(close).toHaveBeenCalledOnce();
  });
});
