import { describe, expect, it } from 'vitest';
import {
  SUDO_COMMAND_COMPLETED_WITH_NO_OUTPUT,
  finalizeSudoCommandOutput,
} from '../src/main/claude/sudo-command';

describe('finalizeSudoCommandOutput', () => {
  it('returns command output for zero exit code', () => {
    expect(finalizeSudoCommandOutput('ok\n', '', 0, null)).toBe('ok\n');
  });

  it('keeps a visible no-output marker for successful silent commands', () => {
    expect(finalizeSudoCommandOutput('', '', 0, null)).toBe(SUDO_COMMAND_COMPLETED_WITH_NO_OUTPUT);
  });

  it('throws when the command exits non-zero', () => {
    expect(() => finalizeSudoCommandOutput('', 'permission denied', 1, null)).toThrow(
      'Sudo command failed with exit code 1: permission denied'
    );
  });

  it('throws when the command is closed by a signal', () => {
    expect(() => finalizeSudoCommandOutput('', '', null, 'SIGTERM')).toThrow(
      'Sudo command failed with signal SIGTERM'
    );
  });
});
