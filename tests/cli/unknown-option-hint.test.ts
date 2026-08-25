import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  attachUnknownOptionHint,
  formatGlobalOptionMisplaced,
} from '../../src/cli/unknown-option-hint.js';

describe('formatGlobalOptionMisplaced', () => {
  it('names the flag, says to put it before the subcommand, and lists values', () => {
    const message = formatGlobalOptionMisplaced(
      '--permission-mode',
      'research',
      '--permission-mode',
    );
    expect(message).toContain("error: unknown option '--permission-mode'");
    expect(message).toContain('BEFORE the subcommand');
    expect(message).toContain('buddy --permission-mode <value> research');
    expect(message).toContain('acceptEdits');
    expect(message).toContain('bypassPermissions');
  });

  it('omits a value slot for boolean global flags', () => {
    const message = formatGlobalOptionMisplaced('--dry-run', 'flow', '--dry-run');
    expect(message).toContain('buddy --dry-run flow');
    expect(message).not.toContain('--dry-run <value>');
  });
});

function programWithResearch(): { program: Command; err: { text: string } } {
  const err = { text: '' };
  const program = new Command();
  program.name('buddy');
  program.enablePositionalOptions();
  program.exitOverride();
  program.configureOutput({ writeErr: (s) => { err.text += s; } });
  program.option('--permission-mode <mode>', 'permission mode');
  const research = program.command('research').argument('<topic>').exitOverride();
  research.configureOutput({ writeErr: (s) => { err.text += s; } });
  attachUnknownOptionHint(research, program);
  return { program, err };
}

describe('attachUnknownOptionHint', () => {
  it('replaces unknown-option for a root flag used after the subcommand', () => {
    const { program, err } = programWithResearch();
    expect(() =>
      program.parse(['research', 'x', '--permission-mode', 'acceptEdits'], { from: 'user' }),
    ).toThrow();
    expect(err.text).toContain("error: unknown option '--permission-mode'");
    expect(err.text).toContain('BEFORE the subcommand');
    expect(err.text).toContain('acceptEdits');
  });

  it('leaves a truly unknown flag as Commander reported it', () => {
    const { program, err } = programWithResearch();
    expect(() =>
      program.parse(['research', 'x', '--not-a-real-flag'], { from: 'user' }),
    ).toThrow();
    expect(err.text).toContain("unknown option '--not-a-real-flag'");
    expect(err.text).not.toContain('BEFORE the subcommand');
  });

  it('keeps the complete nested command path in the example', () => {
    const err = { text: '' };
    const program = new Command().name('buddy').enablePositionalOptions().exitOverride();
    program.configureOutput({ writeErr: (s) => { err.text += s; } });
    program.option('--permission-mode <mode>', 'permission mode');
    const skills = program.command('skills');
    const list = skills.command('list').exitOverride();
    list.configureOutput({ writeErr: (s) => { err.text += s; } });
    attachUnknownOptionHint(skills, program);

    expect(() =>
      program.parse(['skills', 'list', '--permission-mode', 'acceptEdits'], { from: 'user' }),
    ).toThrow();
    expect(err.text).toContain('buddy --permission-mode <value> skills list');
  });
});
