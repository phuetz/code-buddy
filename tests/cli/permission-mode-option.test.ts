import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  hoistPermissionModeOption,
  installPermissionModeActionHook,
  parseCliPermissionMode,
} from '../../src/cli/permission-mode-option.js';

describe('global --permission-mode routing', () => {
  it.each([
    ['flow', ['flow', 'goal']],
    ['research', ['research', 'topic']],
    ['film', ['film', 'status', 'demo']],
    ['dev', ['dev', 'explain']],
    ['improve', ['improve', 'status']],
    ['science', ['science', 'hypothesis']],
    ['papers', ['papers', 'ask', 'question']],
    ['meeting', ['meeting', 'notes.txt']],
    ['evolve', ['evolve', 'status']],
    ['autonomous-code', ['autonomous-code', 'status']],
  ])('hoists the option for the %s command family', (_name, commandTokens) => {
    const argv = [
      'node',
      'buddy',
      ...commandTokens,
      '--permission-mode',
      'acceptEdits',
    ];

    expect(hoistPermissionModeOption(argv)).toEqual([
      'node',
      'buddy',
      '--permission-mode',
      'acceptEdits',
      ...commandTokens,
    ]);
  });

  it('applies the hoisted posture before a nested command action', async () => {
    const program = new Command();
    const applyMode = vi.fn();
    let modeDuringAction: string | undefined;
    program.exitOverride();
    program.option('--permission-mode <mode>');
    installPermissionModeActionHook(program, (mode) => {
      applyMode(mode);
      modeDuringAction = mode;
    });
    program.command('dev').command('explain').action(() => {
      expect(modeDuringAction).toBe('acceptEdits');
    });

    await program.parseAsync(hoistPermissionModeOption([
      'node',
      'buddy',
      'dev',
      'explain',
      '--permission-mode=acceptEdits',
    ]));

    expect(applyMode).toHaveBeenCalledTimes(1);
    expect(applyMode).toHaveBeenCalledWith('acceptEdits');
  });

  it('does not reinterpret literal arguments after --', () => {
    const argv = [
      'node',
      'buddy',
      'research',
      '--',
      '--permission-mode',
      'acceptEdits',
    ];
    expect(hoistPermissionModeOption(argv)).toEqual(argv);
  });

  it('rejects an invalid mode during option parsing', () => {
    expect(() => parseCliPermissionMode('nimportequoi')).toThrow(
      'expected one of default, plan, acceptEdits, dontAsk, bypassPermissions (received "nimportequoi")',
    );
  });
});
