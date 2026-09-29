import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  startServer: vi.fn(async () => {}),
}));

vi.mock('../../src/daemon/index.js', () => ({
  getDaemonManager: () => ({ start: mocks.start, stop: vi.fn(async () => {}) }),
}));
vi.mock('../../src/server/index.js', () => ({ startServer: mocks.startServer }));
vi.mock('../../src/daemon/learning-cron-job.js', () => ({ isLearningDaemonEnabled: () => false }));

import { registerDaemonCommands } from '../../src/commands/cli/daemon-commands.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.start.mockClear();
  mocks.startServer.mockClear();
});

describe('daemon interne', () => {
  it('ne démarre pas un serveur sans authentification sur toutes les interfaces', async () => {
    vi.stubEnv('GROK_API_KEY', '');
    vi.stubEnv('XAI_API_KEY', '');
    const before = new Set(process.listeners('SIGTERM'));
    const program = new Command();
    program.exitOverride();
    registerDaemonCommands(program);
    try {
      await program.parseAsync(['node', 'test', 'daemon', '__run__', '--port', '3456']);
      expect(mocks.startServer).toHaveBeenCalledWith({
        port: 3456,
        host: '127.0.0.1',
        authEnabled: false,
      });
    } finally {
      for (const listener of process.listeners('SIGTERM')) {
        if (!before.has(listener)) process.removeListener('SIGTERM', listener);
      }
    }
  });
});
