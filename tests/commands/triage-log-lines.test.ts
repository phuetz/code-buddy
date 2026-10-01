import { Command, InvalidArgumentError } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { registerTriageCommand } from '../../src/commands/cli/triage-command.js';
import * as triageDoctor from '../../src/doctor/triage.js';

// Mock writeTriageBundle to just return the passed logLines
vi.mock('../../src/doctor/triage.js', () => ({
  writeTriageBundle: vi.fn().mockResolvedValue({
    dir: '/tmp/test',
    jsonPath: '/tmp/test/bundle.json',
    promptPath: '/tmp/test/prompt.md',
    promptBytes: 100,
    redactions: 0,
    withheld: [],
    suggestedCommand: 'echo test',
  }),
}));

describe('triage log-lines validation', () => {
  it('accepts valid integer within range', async () => {
    const program = new Command();
    program.exitOverride();
    registerTriageCommand(program);
    await program.parseAsync(['node', 'test', 'triage', '--log-lines', '50']);
    expect(triageDoctor.writeTriageBundle).toHaveBeenCalledWith(
      expect.objectContaining({ logLines: 50 })
    );
  });

  it('defaults to 200 without option', async () => {
    const program = new Command();
    program.exitOverride();
    registerTriageCommand(program);
    await program.parseAsync(['node', 'test', 'triage']);
    expect(triageDoctor.writeTriageBundle).toHaveBeenCalledWith(
      expect.objectContaining({ logLines: 200 })
    );
  });

  it('accepts 0', async () => {
    const program = new Command();
    program.exitOverride();
    registerTriageCommand(program);
    await program.parseAsync(['node', 'test', 'triage', '--log-lines', '0']);
    expect(triageDoctor.writeTriageBundle).toHaveBeenCalledWith(
      expect.objectContaining({ logLines: 0 })
    );
  });

  it('rejects invalid value (abc)', async () => {
    const program = new Command();
    program.exitOverride();
    registerTriageCommand(program);
    try {
      await program.parseAsync(['node', 'test', 'triage', '--log-lines', 'abc']);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('commander.invalidArgument');
    }
  });

  it('rejects negative value (-5)', async () => {
    const program = new Command();
    program.exitOverride();
    registerTriageCommand(program);
    try {
      await program.parseAsync(['node', 'test', 'triage', '--log-lines', '-5']);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('commander.invalidArgument');
    }
  });

  it('rejects partial value (20x)', async () => {
    const program = new Command();
    program.exitOverride();
    registerTriageCommand(program);
    try {
      await program.parseAsync(['node', 'test', 'triage', '--log-lines', '20x']);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('commander.invalidArgument');
    }
  });

  it('rejects float value (1.5)', async () => {
    const program = new Command();
    program.exitOverride();
    registerTriageCommand(program);
    try {
      await program.parseAsync(['node', 'test', 'triage', '--log-lines', '1.5']);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('commander.invalidArgument');
    }
  });
});
