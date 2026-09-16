import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bank = vi.hoisted(() => ({
  build: vi.fn(),
  list: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('../../src/voice/tts-bank.js', () => ({
  buildTtsBank: bank.build,
  listTtsBank: bank.list,
  verifyTtsBank: bank.verify,
}));

import { registerCompanionCommands } from '../../src/commands/cli/native-engine-commands.js';

describe('buddy companion tts-bank commands', () => {
  let program: Command;
  let log: ReturnType<typeof vi.spyOn>;
  const initialExitCode = process.exitCode;

  beforeEach(() => {
    program = new Command().exitOverride();
    program.name('buddy');
    registerCompanionCommands(program);
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.exitCode = undefined;
    bank.build.mockReset();
    bank.list.mockReset();
    bank.verify.mockReset();
  });

  afterEach(() => {
    process.exitCode = initialExitCode;
    vi.restoreAllMocks();
  });

  it('builds the local Kyutai bank by default without playing audio', async () => {
    bank.build.mockResolvedValue({
      provider: 'local', built: 4, present: 2, failed: 0, expected: 6, rejected: [],
    });

    await program.parseAsync(['node', 'buddy', 'companion', 'tts-bank', 'build']);

    expect(bank.build).toHaveBeenCalledWith({ provider: 'local' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('built=4'));
    expect(process.exitCode).toBeUndefined();
  });

  it('lists the explicitly selected ElevenLabs bank', async () => {
    bank.list.mockReturnValue({
      provider: 'elevenlabs',
      voice: 'elevenlabs:test',
      entries: [{ text: 'Je suis là.', present: true }],
      rejected: [],
    });

    await program.parseAsync([
      'node', 'buddy', 'companion', 'tts-bank', 'list', '--provider', 'elevenlabs',
    ]);

    expect(bank.list).toHaveBeenCalledWith({ provider: 'elevenlabs' });
    expect(log).toHaveBeenCalledWith('present\tJe suis là.');
  });

  it('verifies presence only and returns a failing exit code for missing phrases', async () => {
    bank.verify.mockReturnValue({
      provider: 'local', expected: 3, present: 2, missing: ['Pardon ?'], rejected: [],
    });

    await program.parseAsync(['node', 'buddy', 'companion', 'tts-bank', 'verify']);

    expect(bank.verify).toHaveBeenCalledWith({ provider: 'local' });
    expect(bank.build).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
