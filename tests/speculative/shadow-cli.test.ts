import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/speculative/shadow-workspace.js', () => ({
  ShadowWorkspace: class {
    constructor(public repoPath: string) {}
    async getStatus() {
      return {
        enabled: false,
        repoRoot: this.repoPath,
        repoPath: this.repoPath,
        shadowPath: null,
        exists: false,
        command: null,
        timeoutMs: 1,
      };
    }
    async runWorkingTree() {
      return {
        ok: true,
        cached: false,
        durationMs: 1,
        exitCode: 0,
        stdoutTail: this.repoPath,
        unavailable: false,
      };
    }
  },
}));

import { createShadowCommand } from '../../src/commands/shadow.js';

describe('shadow CLI directory option', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('honors -d on run as well as status', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const directory = '/home/patrice/DEV/cb-repar-jumeaux-2026-09-02/tmp/shadow-r30-repo';
    await createShadowCommand().parseAsync(['node', 'shadow', 'status', '-d', directory]);
    expect(logs.some((line) => line.includes(`Repository: ${directory}`))).toBe(true);

    logs.length = 0;
    await createShadowCommand().parseAsync(['node', 'shadow', 'run', '-d', directory]);
    expect(logs.some((line) => line.includes(directory))).toBe(true);
  });
});
