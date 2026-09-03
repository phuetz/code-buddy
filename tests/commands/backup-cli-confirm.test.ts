import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/commands/handlers/backup-handlers.js', () => ({
  handleBackup: vi.fn(async (args: string) => ({
    handled: true,
    response: `ARGS:${args}`,
    exitCode: 0,
  })),
}));

import { registerBackupCommand } from '../../src/commands/cli/backup-command.js';
import { handleBackup } from '../../src/commands/handlers/backup-handlers.js';

describe('buddy backup CLI --confirm', () => {
  afterEach(() => {
    vi.mocked(handleBackup).mockClear();
    process.exitCode = 0;
  });

  async function parse(argv: string[]): Promise<string> {
    let written = '';
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerBackupCommand(program, (msg) => {
      written = msg;
    });
    await program.parseAsync(argv);
    return written;
  }

  it('does not reject restore --confirm as an unknown option', async () => {
    const written = await parse([
      'node',
      'test',
      'backup',
      'restore',
      '/tmp/codebuddy-backup-x.json',
      '--confirm',
    ]);
    expect(vi.mocked(handleBackup)).toHaveBeenCalledWith(
      'restore /tmp/codebuddy-backup-x.json --confirm',
    );
    expect(written).toBe('ARGS:restore /tmp/codebuddy-backup-x.json --confirm');
  });

  it('restore without --confirm does not forward the flag', async () => {
    await parse(['node', 'test', 'backup', 'restore', 'x.json']);
    expect(vi.mocked(handleBackup)).toHaveBeenCalledWith('restore x.json');
  });

  it('help says it backs up the current project, not the home profile', () => {
    const program = new Command();
    program.exitOverride();
    registerBackupCommand(program, () => {});
    const help = program.commands.find((command) => command.name() === 'backup')?.helpInformation() ?? '';
    expect(help).toMatch(/current project/i);
    expect(help).toMatch(/home profile/i);
  });
});
