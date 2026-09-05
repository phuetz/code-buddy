import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { parseShellCommand, stripShellWrapper } from '../../src/security/bash-parser.js';
import type { PowerShellParserRunner } from '../../src/security/powershell-parser.js';
import { validateCommand } from '../../src/tools/bash/command-validator.js';

// `validateCommand` n'expose pas le seam PowerShellParserRunner : les deux
// scénarios « le parseur natif est indisponible » lancent le VRAI binaire.
// Leur prémisse — nommée dans leur intitulé — n'est vraie que là où ni pwsh ni
// powershell n'existent. Or les runners macOS et Windows de GitHub livrent
// PowerShell : le parseur répond, la commande est analysée, et le refus
// attendu n'a plus lieu d'être. La sonde est la présence RÉELLE du binaire, pas
// une supposition de plate-forme : sur une machine sans PowerShell (le cas
// habituel sous Linux) les deux scénarios tournent comme avant.
const NATIVE_POWERSHELL_ABSENT = !['pwsh', 'powershell'].some((executable) => {
  try {
    const probe = spawnSync(executable, ['-NoProfile', '-Command', 'exit 0'], { timeout: 10_000 });
    return !probe.error && probe.status === 0;
  } catch {
    return false;
  }
});

const nativeReadOnlyResult: PowerShellParserRunner = () => ({
  status: 0,
  signal: null,
  stdout: JSON.stringify({
    success: true,
    commands: [
      {
        name: 'Get-Content',
        text: 'Get-Content C:\\work\\README.md',
        args: ['C:\\work\\README.md'],
      },
    ],
    hasRedirection: false,
  }),
  stderr: '',
});

describe('stripShellWrapper', () => {
  it.each([
    ['bash -c "echo ok"', 'echo ok'],
    ["sh -c 'echo ok'", 'echo ok'],
    ['zsh -lc "echo ok"', 'echo ok'],
    ['cmd /c "dir C:\\work"', 'dir C:\\work'],
    ['cmd.exe /d /s /c "dir C:\\work"', 'dir C:\\work'],
    ['powershell -Command "Get-Content C:\\work\\README.md"', 'Get-Content C:\\work\\README.md'],
    [
      'PWSH.EXE -NoProfile -Command "Get-Content C:\\work\\README.md"',
      'Get-Content C:\\work\\README.md',
    ],
    [
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NonInteractive -Command "Get-Content C:\\work\\README.md"',
      'Get-Content C:\\work\\README.md',
    ],
    [
      'cmd /c "pwsh -Command \'Get-Content C:\\work\\README.md\'"',
      'Get-Content C:\\work\\README.md',
    ],
  ])('unwraps %s', (wrapped, inner) => {
    expect(stripShellWrapper(wrapped)).toBe(inner);
  });

  it('does not unwrap a wrapper name embedded in ordinary command text', () => {
    const command = 'echo "powershell -Command Get-Content secret"';
    expect(stripShellWrapper(command)).toBe(command);
  });
});

describe('parseShellCommand routing', () => {
  it('selects the PowerShell parser from an explicit shell path', () => {
    const result = parseShellCommand('Get-Content C:\\work\\README.md', {
      shell: 'C:\\Program Files\\PowerShell\\7\\PWSH.EXE',
      powershell: { runner: nativeReadOnlyResult },
    });

    expect(result.warnings).toEqual([]);
    expect(result.commands.map((command) => command.command)).toEqual(['get-content']);
  });

  it('selects the PowerShell parser from a wrapper without corrupting backslashes', () => {
    const result = parseShellCommand('pwsh -Command "Get-Content C:\\work\\README.md"', {
      powershell: { runner: nativeReadOnlyResult },
    });

    expect(result.warnings).toEqual([]);
    expect(result.commands[0]?.args).toEqual(['C:\\work\\README.md']);
  });

  it('fails closed for a PowerShell wrapper when PowerShell is absent', () => {
    const result = parseShellCommand('powershell -Command "Get-ChildItem"', {
      powershell: { executable: '__codebuddy_missing_powershell__' },
    });

    expect(result.commands).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('keeps the POSIX parser verdicts for POSIX wrappers', () => {
    const result = parseShellCommand('bash -c "echo safe && rm -rf /"');
    expect(result.commands.map((command) => command.command)).toEqual(['echo', 'rm']);
  });
});

describe('validator parser fail-closed seam', () => {
  it.runIf(NATIVE_POWERSHELL_ABSENT)('refuses a wrapped PowerShell command when the native parser is unavailable', () => {
    const verdict = validateCommand('powershell -Command "Get-ChildItem"');
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/PowerShell parser/i);
  });

  it.runIf(NATIVE_POWERSHELL_ABSENT)('cannot hide PowerShell behind cmd /c', () => {
    const verdict = validateCommand('cmd /c "pwsh -Command \'Get-ChildItem\'"');
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/PowerShell parser/i);
  });

  it('uses an explicitly resolved PowerShell executable at the validation seam', () => {
    const verdict = validateCommand('Get-ChildItem', '__codebuddy_missing_powershell__\\pwsh.exe');
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/PowerShell parser/i);
  });
});
