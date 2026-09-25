import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRucheCommand } from '../../src/commands/cli/ruche-command.js';

describe('buddy ruche JSON CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = 0;
  });

  it('fails closed in JSON without touching the local profile when disabled', async () => {
    vi.stubEnv('CODEBUDDY_RUCHE', '');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => { errors.push(line); });
    const program = new Command();
    registerRucheCommand(program);
    await program.parseAsync(['node', 'buddy', 'ruche', 'status']);
    expect(JSON.parse(errors[0]!)).toEqual({ ok: false, error: 'RUCHE_DISABLED' });
    expect(process.exitCode).toBe(1);
  });
});
