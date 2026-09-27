import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerScreenCommands } from '../../../src/commands/cli/screen-commands.js';

describe('screen capture region', () => {
  it('rejects malformed and zero-width regions', async () => {
    const program = new Command();
    program.exitOverride();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerScreenCommands(program);

    try {
      await expect(program.parseAsync(['node', 'test', 'screen', 'capture', '--region', 'bad-format']))
        .rejects.toThrow('invalid --region "bad-format"');
      await expect(program.parseAsync(['node', 'test', 'screen', 'capture', '--region', '0x100']))
        .rejects.toThrow('invalid --region "0x100" (width and height must be > 0)');
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
