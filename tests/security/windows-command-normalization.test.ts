import { describe, expect, it } from 'vitest';

import { extractBaseCommand } from '../../src/tools/bash/command-validator.js';

describe('extractBaseCommand Windows normalization', () => {
  it.each([
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe -NoProfile', 'pwsh'],
    ['"C:\\Program Files\\PowerShell\\7\\PWSH.EXE" -NoProfile', 'pwsh'],
    ['C:\\Windows\\System32\\FORMAT.EXE C:', 'format'],
    ['.\\PWSH.EXE -Command Get-ChildItem', 'pwsh'],
    ['PWSH.EXE -Command Get-ChildItem', 'pwsh'],
  ])('normalizes %s to %s', (command, expected) => {
    expect(extractBaseCommand(command)).toBe(expected);
  });

  it('keeps POSIX normalization unchanged', () => {
    expect(extractBaseCommand('/usr/bin/bash -c "echo ok"')).toBe('bash');
    expect(extractBaseCommand('./git status')).toBe('git');
    expect(extractBaseCommand('NODE_ENV=test /usr/bin/node --version')).toBe('node');
  });
});
