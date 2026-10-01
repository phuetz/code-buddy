import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerDeployCommands } from '../../src/commands/cli/deploy-command.js';

describe('deploy platforms honesty', () => {
  let program: Command;
  let stdout: string[];
  let stderr: string[];
  let originalExitCode: number | undefined;

  beforeEach(() => {
    program = new Command();
    stdout = [];
    stderr = [];
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    registerDeployCommands(program, {
      write: (message) => stdout.push(message),
      writeErr: (message) => stderr.push(message),
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('lists Nix as a separate command', async () => {
    await program.parseAsync(['node', 'test', 'deploy', 'platforms']);
    const output = stdout.join('\n');
    expect(output).not.toContain('  nix         Nix flake — declarative installation');
    expect(output).toContain('buddy deploy nix');
  });

  it.each(['abc', '0', '65536', '3000junk'])('rejects port %s without writing files', async (port) => {
    const outputDir = await mkdtemp(join(tmpdir(), 'deploy-init-port-'));
    try {
      await program.parseAsync(['node', 'test', 'deploy', 'init', 'fly', '--port', port, '--output', outputDir]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toContain('--port must be an integer');
      expect(await readdir(outputDir)).toEqual([]);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
