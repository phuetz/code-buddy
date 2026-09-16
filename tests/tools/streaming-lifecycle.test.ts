import { describe, it, expect, vi } from 'vitest';
import { executeStreaming } from '../../src/tools/bash/streaming-executor.js';
import * as shell from '../../src/utils/shell-configuration.js';

vi.mock('../../src/tools/bash/command-validator.js', () => ({ validateCommand: () => ({ valid: true }), getFilteredEnv: () => process.env }));
vi.mock('../../src/utils/input-validator.js', () => ({ validateCommand: () => ({ valid: true }) }));
vi.mock('../../src/tools/bash/execution-policy.js', () => ({ evaluateShellExecution: async () => ({ action: 'allow' }), executableIdentitiesStillMatch: () => true }));
vi.mock('../../src/security/native-sandbox.js', () => ({ confineSpawn: (input: object) => ({ ok: true, ...input }) }));
vi.mock('../../src/tools/bash/rtk-rewrite.js', () => ({ rewriteCommandWithRtk: async () => ({ rewritten: false }) }));
vi.mock('../../src/tools/bash/env-overrides.js', () => ({ buildBashEnvPrelude: () => '', CONTROLLED_SUBPROCESS_ENV: {} }));
vi.mock('../../src/security/shell-env-policy.js', () => ({ getShellEnvPolicy: () => ({ buildEnv: (env: object) => env }) }));
vi.mock('../../src/utils/confirmation-service.js', () => ({ ConfirmationService: { getInstance: () => ({}) } }));
vi.mock('../../src/utils/shell-configuration.js', () => ({ getShellConfiguration: () => ({ shell: 'bash', executable: '/bin/bash', argsPrefix: ['-c'] }), shellWorkingDirectoryCommand: (command: string) => command }));

const deps = () => ({ getCurrentDirectory: () => process.cwd(), getSandboxManager: () => ({ validateCommand: () => ({ valid: true }) }), getRunningProcesses: () => new Set(), maxOutputBytes: 1024 });
async function collect(command: string, timeout = 3000) {
  const gen = executeStreaming(command, timeout, deps());
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}

describe.skipIf(process.platform === 'win32')('direct streaming lifecycle', () => {
  it('returns after timeout even when the shell and descendant ignore SIGTERM', async () => {
    const start = Date.now();
    const result = await collect("trap '' TERM; echo READY; while :; do sleep 1; done", 100);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.output).toContain('READY');
    expect(Date.now() - start).toBeLessThan(2500);
  });
  it('turns a failed spawn into a tool result', async () => {
    const spy = vi.spyOn(shell, 'getShellConfiguration').mockReturnValue({ shell: 'bash', executable: '/not-a-real-shell', argsPrefix: ['-c'] } as ReturnType<typeof shell.getShellConfiguration>);
    try { expect((await collect('echo ready')).error).toContain('failed to start'); }
    finally { spy.mockRestore(); }
  });
  it('bounds a verbose process output and preserves the final error', async () => {
    const result = await collect("for ((i=0;i<5000;i++)); do echo progress; done; echo FINAL_ERROR; exit 3");
    expect(result.success).toBe(false);
    expect(result.output).toContain('bytes omitted');
    expect(result.output).toMatch(/FINAL_ERROR\n$/);
    expect(Buffer.byteLength(result.output ?? '')).toBeLessThan(1150);
  });
  it('kills the process when its streaming consumer closes early', async () => {
    const gen = executeStreaming("echo $$; trap '' TERM; while :; do sleep 1; done", 3000, deps());
    const first = await gen.next();
    const pid = Number(first.value);
    expect(Number.isInteger(pid)).toBe(true);
    await gen.return({ success: false });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
