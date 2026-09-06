/**
 * `buddy improve … --apply` must not escalate to auto-apply while the
 * self-improvement kill-switch is off: CLAUDE.md promises that an unset
 * `CODEBUDDY_SELF_IMPROVE` leaves behavior unchanged, and the generative
 * subcommands persist authored artifacts under `.codebuddy/`.
 */
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerError, toolRunLoop, skillRunLoop } = vi.hoisted(() => ({
  loggerError: vi.fn(),
  toolRunLoop: vi.fn(),
  skillRunLoop: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), error: loggerError, info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../src/agent/self-improvement/tool-engine.js', () => ({
  ToolImprovementEngine: class {
    constructor(public readonly options: { autonomy?: string }) {}
    async runLoop() {
      return toolRunLoop(this.options);
    }
  },
}));

vi.mock('../../src/agent/self-improvement/skill-engine.js', () => ({
  SkillImprovementEngine: class {
    constructor(public readonly options: { autonomy?: string }) {}
    async runLoop() {
      return skillRunLoop(this.options);
    }
  },
}));

import { registerImproveCommands } from '../../src/commands/cli/improve-command.js';

let logSpy: ReturnType<typeof vi.spyOn>;
let previousExitCode: number | string | undefined;
let previousOptIn: string | undefined;

function program(): Command {
  const command = new Command();
  command.exitOverride();
  command.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerImproveCommands(command);
  return command;
}

beforeEach(() => {
  previousExitCode = process.exitCode;
  previousOptIn = process.env.CODEBUDDY_SELF_IMPROVE;
  delete process.env.CODEBUDDY_SELF_IMPROVE;
  process.exitCode = 0;
  toolRunLoop.mockReset().mockResolvedValue([]);
  skillRunLoop.mockReset().mockResolvedValue([]);
  loggerError.mockReset();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  process.exitCode = previousExitCode;
  if (previousOptIn === undefined) delete process.env.CODEBUDDY_SELF_IMPROVE;
  else process.env.CODEBUDDY_SELF_IMPROVE = previousOptIn;
});

describe('buddy improve tools --apply', () => {
  it('refuses, names the variable, and runs nothing when the opt-in is unset', async () => {
    await program().parseAsync(['node', 'buddy', 'improve', 'tools', '--apply', '--json']);

    expect(process.exitCode).toBe(1);
    expect(toolRunLoop).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    const message = String(loggerError.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('CODEBUDDY_SELF_IMPROVE');
    expect(message).toContain('unset');
  });

  it('refuses a value that is not an opt-in', async () => {
    process.env.CODEBUDDY_SELF_IMPROVE = 'propose-only';

    await program().parseAsync(['node', 'buddy', 'improve', 'tools', '--apply', '--json']);

    expect(process.exitCode).toBe(1);
    expect(toolRunLoop).not.toHaveBeenCalled();
    expect(String(loggerError.mock.calls[0]?.[0] ?? '')).toContain('propose-only');
  });

  it('still runs propose-only without --apply, opt-in or not', async () => {
    await program().parseAsync(['node', 'buddy', 'improve', 'tools', '--json']);

    expect(process.exitCode).toBe(0);
    expect(toolRunLoop).toHaveBeenCalledOnce();
    expect(toolRunLoop.mock.calls[0]?.[0]).not.toMatchObject({ autonomy: 'auto-apply' });
  });

  it('escalates to auto-apply once CODEBUDDY_SELF_IMPROVE is set', async () => {
    process.env.CODEBUDDY_SELF_IMPROVE = 'true';

    await program().parseAsync(['node', 'buddy', 'improve', 'tools', '--apply', '--json']);

    expect(process.exitCode).toBe(0);
    expect(loggerError).not.toHaveBeenCalled();
    expect(toolRunLoop.mock.calls[0]?.[0]).toMatchObject({ autonomy: 'auto-apply' });
  });
});

describe('buddy improve skills --apply', () => {
  it('refuses without the opt-in and applies with it', async () => {
    await program().parseAsync(['node', 'buddy', 'improve', 'skills', '--apply', '--json']);
    expect(process.exitCode).toBe(1);
    expect(skillRunLoop).not.toHaveBeenCalled();

    process.exitCode = 0;
    process.env.CODEBUDDY_SELF_IMPROVE = 'auto-apply';
    await program().parseAsync(['node', 'buddy', 'improve', 'skills', '--apply', '--json']);
    expect(process.exitCode).toBe(0);
    expect(skillRunLoop.mock.calls[0]?.[0]).toMatchObject({ autonomy: 'auto-apply' });
  });
});
