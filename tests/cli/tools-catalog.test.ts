import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerToolsCommands } from '../../src/commands/cli/tools-commands.js';

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

describe('buddy tools catalog', () => {
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints effect= on the human catalog listing', async () => {
    const program = createProgram();
    registerToolsCommands(program);
    await program.parseAsync(['node', 'test', 'tools', 'catalog']);
    const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('view_file  effect=read');
    expect(output).toContain('bash  effect=emission');
    expect(output).toContain('stock_quote  effect=emission');
  });
});
