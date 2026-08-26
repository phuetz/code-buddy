import { describe, expect, it, vi } from 'vitest';

import {
  parsePowerShellCommand,
  type PowerShellParserRunner,
} from '../../src/security/powershell-parser.js';

function successfulRunner(
  payload: unknown,
  inspect?: (executable: string, args: readonly string[], env: NodeJS.ProcessEnv) => void
): PowerShellParserRunner {
  return (executable, args, options) => {
    inspect?.(executable, args, options.env);
    return {
      status: 0,
      signal: null,
      stdout: JSON.stringify(payload),
      stderr: '',
    };
  };
}

describe('parsePowerShellCommand', () => {
  it('maps the native PowerShell AST result to the shared ParseResult contract', () => {
    const result = parsePowerShellCommand('Get-Content .\\README.md | Select-String Code', {
      executable: 'pwsh',
      runner: successfulRunner({
        success: true,
        commands: [
          { name: 'Get-Content', text: 'Get-Content .\\README.md', args: ['.\\README.md'] },
          { name: 'Select-String', text: 'Select-String Code', args: ['Code'] },
        ],
        hasRedirection: false,
      }),
    });

    expect(result).toEqual({
      commands: [
        {
          command: 'get-content',
          args: ['.\\README.md'],
          raw: 'Get-Content .\\README.md',
          connector: null,
          isSubshell: false,
        },
        {
          command: 'select-string',
          args: ['Code'],
          raw: 'Select-String Code',
          connector: null,
          isSubshell: false,
        },
      ],
      usedTreeSitter: false,
      warnings: [],
      hasRedirection: false,
    });
  });

  it('passes the command only through an environment variable and encodes a fixed UTF-16LE script', () => {
    const command = 'Get-Content C:\\Users\\me\\file.txt; Write-Output `"ok`"';
    let encodedScript = '';

    const result = parsePowerShellCommand(command, {
      executable: 'pwsh',
      runner: successfulRunner(
        {
          success: true,
          commands: [{ name: 'Get-Content', text: command, args: ['C:\\Users\\me\\file.txt'] }],
          hasRedirection: false,
        },
        (_executable, args, env) => {
          expect(args).toContain('-EncodedCommand');
          encodedScript = Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le');
          expect(Object.values(env)).toContain(command);
          expect(args.join(' ')).not.toContain(command);
        }
      ),
    });

    expect(result.warnings).toEqual([]);
    expect(encodedScript).toContain('[System.Management.Automation.Language.Parser]::ParseInput');
    expect(encodedScript).not.toContain(command);
  });

  it('bounds the native parser to one second and never invokes a shell', () => {
    const result = parsePowerShellCommand('Get-ChildItem', {
      executable: 'pwsh',
      runner: (executable, args, options) => {
        expect(executable).toBe('pwsh');
        expect(args).toContain('-EncodedCommand');
        expect(options.timeout).toBe(1_000);
        expect(options.shell).toBe(false);
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify({
            success: true,
            commands: [{ name: 'Get-ChildItem', text: 'Get-ChildItem', args: [] }],
            hasRedirection: false,
          }),
          stderr: '',
        };
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.commands[0]?.command).toBe('get-childitem');
  });

  it('fails closed when PowerShell is absent on this Linux machine', () => {
    const result = parsePowerShellCommand('Get-ChildItem', {
      executable: '__codebuddy_missing_powershell__',
    });

    expect(result.commands).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/unavailable|ENOENT/i);
  });

  it('fails closed on timeout without trying a second executable', () => {
    const runner = vi.fn<PowerShellParserRunner>(() => ({
      error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
    }));

    const result = parsePowerShellCommand('Get-ChildItem', { runner });

    expect(result.commands).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/timed out/i);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('fails closed on invalid JSON', () => {
    const result = parsePowerShellCommand('Get-ChildItem', {
      executable: 'pwsh',
      runner: () => ({ status: 0, signal: null, stdout: '{not-json', stderr: '' }),
    });

    expect(result.commands).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/invalid JSON/i);
  });

  it.each([
    { success: false, commands: [], hasRedirection: false },
    { success: true, commands: [], hasRedirection: false },
    {
      success: true,
      commands: [{ name: '', text: 'Get-ChildItem', args: [] }],
      hasRedirection: false,
    },
    {
      success: true,
      commands: [{ name: 'Get-ChildItem', text: 42, args: [] }],
      hasRedirection: false,
    },
    {
      success: true,
      commands: [{ name: 'Get-ChildItem', text: 'Get-ChildItem', args: [42] }],
      hasRedirection: false,
    },
  ])('fails closed on an incomplete AST payload: %j', (payload) => {
    const result = parsePowerShellCommand('Get-ChildItem', {
      executable: 'pwsh',
      runner: successfulRunner(payload),
    });

    expect(result.commands).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('fails closed on stderr or a non-zero parser exit', () => {
    const stderr = parsePowerShellCommand('Get-ChildItem', {
      executable: 'pwsh',
      runner: () => ({ status: 0, signal: null, stdout: '{}', stderr: 'parser warning' }),
    });
    const nonZero = parsePowerShellCommand('Get-ChildItem', {
      executable: 'pwsh',
      runner: () => ({ status: 1, signal: null, stdout: '', stderr: '' }),
    });

    expect(stderr.commands).toEqual([]);
    expect(stderr.warnings.join(' ')).toMatch(/stderr/i);
    expect(nonZero.commands).toEqual([]);
    expect(nonZero.warnings.join(' ')).toMatch(/exit/i);
  });

  it('fails closed when the parser process is terminated by a signal', () => {
    const result = parsePowerShellCommand('Get-ChildItem', {
      executable: 'pwsh',
      runner: () => ({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' }),
    });

    expect(result.commands).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/terminated/i);
  });

  it('fails closed when the parser runner throws', () => {
    const result = parsePowerShellCommand('Get-ChildItem', {
      executable: 'pwsh',
      runner: () => {
        throw new Error('runner failure');
      },
    });

    expect(result.commands).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/threw/i);
  });
});
