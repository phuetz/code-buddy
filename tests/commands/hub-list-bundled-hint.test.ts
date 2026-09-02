import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/skills/hub.js', () => ({
  getSkillsHub: () => ({
    list: () => [],
  }),
}));

import { registerHubCommands } from '../../src/commands/cli/native-engine-commands.js';

describe('buddy hub list empty hub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names bundled skills instead of claiming none are installed', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerHubCommands(program);
    await program.parseAsync(['node', 'test', 'hub', 'list']);

    const output = logs.join('\n');
    expect(output).not.toContain('No skills installed from the hub.');
    expect(output).toMatch(/No hub-installed skills/);
    expect(output).toMatch(/bundled skill/);
  });
});
