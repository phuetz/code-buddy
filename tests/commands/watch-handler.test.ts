import { beforeEach, describe, expect, it, vi } from 'vitest';

let running = false;
let startError: Error | null = null;
const startMock = vi.fn();

vi.mock('../../src/agent/file-watcher-trigger.js', () => ({
  FileWatcherTrigger: class {
    private handlers = new Map<string, (value: unknown) => void>();

    on(event: string, handler: (value: unknown) => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    start(): void {
      startMock();
      if (startError) {
        this.handlers.get('error')?.(startError);
        return;
      }
      running = true;
    }

    stop(): void {
      running = false;
    }

    isRunning(): boolean {
      return running;
    }

    getConfig() {
      return {
        patterns: ['**/*.ts'],
        ignorePatterns: [],
        debounceMs: 1000,
        actions: ['notify'],
      };
    }
  },
}));

const { handleWatch } = await import('../../src/commands/handlers/watch-handler.js');

describe('handleWatch', () => {
  beforeEach(async () => {
    running = false;
    startError = null;
    startMock.mockClear();
    await handleWatch(['stop']);
  });

  it('reports started only when the watcher is actually running', async () => {
    const result = await handleWatch(['start']);

    expect(result.entry?.content).toContain('File watcher started');
    expect(startMock).toHaveBeenCalledOnce();

    const status = await handleWatch(['status']);
    expect(status.entry?.content).toContain('File watcher is running');
  });

  it('reports start failure when the watcher emits an error during startup', async () => {
    startError = new Error('recursive watch unsupported');

    const result = await handleWatch(['start']);

    expect(result.entry?.content).toContain('File watcher failed to start');
    expect(result.entry?.content).toContain('recursive watch unsupported');

    const status = await handleWatch(['status']);
    expect(status.entry?.content).toContain('File watcher is not running');
  });
});
