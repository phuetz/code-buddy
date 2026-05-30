import { Command } from 'commander';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { registerUtilityCommands } from '../../src/commands/cli/utility-commands.js';

const doctorMocks = vi.hoisted(() => ({
  runDoctorChecks: vi.fn(async () => []),
  runFixes: vi.fn(async () => []),
}));

vi.mock('../../src/doctor/index.js', () => doctorMocks);

describe('utility CLI commands', () => {
  it('runs doctor checks against the global --directory target', async () => {
    const program = new Command();
    const cwd = process.cwd();
    const targetDir = path.join(cwd, '.tmp-doctor-target');
    const logs: unknown[][] = [];

    program.exitOverride();
    program.option('-d, --directory <dir>', 'set working directory', cwd);
    registerUtilityCommands(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });

    try {
      await program.parseAsync(['node', 'test', '--directory', targetDir, 'doctor']);
    } finally {
      logSpy.mockRestore();
    }

    expect(logs.length).toBeGreaterThan(0);
    expect(doctorMocks.runDoctorChecks).toHaveBeenCalledWith(targetDir);
  });
});
