/**
 * PowerShell command parser backed by PowerShell's native AST.
 *
 * The parser script is fixed, UTF-16LE/base64 encoded and passed through
 * `-EncodedCommand`. The untrusted command is supplied only through an
 * environment variable, so it can never alter the parser script or its argv.
 * Every execution or decoding failure returns an empty ParseResult with a
 * warning; callers must treat warnings as a validation failure.
 */

import { spawnSync } from 'node:child_process';

import type { ParseResult, ParsedCommand } from './bash-parser.js';

const POWERSHELL_COMMAND_ENV = '__CODEBUDDY_POWERSHELL_COMMAND__';
const POWERSHELL_PARSE_TIMEOUT_MS = 1_000;
const POWERSHELL_PARSE_MAX_BUFFER = 1024 * 1024;

const POWERSHELL_PARSER_SCRIPT = Buffer.from(
  String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$commandText = $env:${POWERSHELL_COMMAND_ENV}

if ([string]::IsNullOrWhiteSpace($commandText)) {
  [PSCustomObject]@{ success = $false; commands = @(); hasRedirection = $false } |
    ConvertTo-Json -Compress -Depth 5
  exit 0
}

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
  $commandText,
  [ref]$tokens,
  [ref]$parseErrors
)

if ($parseErrors -and $parseErrors.Count -gt 0) {
  [PSCustomObject]@{ success = $false; commands = @(); hasRedirection = $false } |
    ConvertTo-Json -Compress -Depth 5
  exit 0
}

$commandAsts = @($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst]
}, $true))
$commands = @()
$hasRedirection = $false
$hasUnresolvedCommand = $false

foreach ($commandAst in $commandAsts) {
  if ($commandAst.Redirections.Count -gt 0) {
    $hasRedirection = $true
  }

  $name = $commandAst.GetCommandName()
  if ([string]::IsNullOrWhiteSpace($name)) {
    $hasUnresolvedCommand = $true
    continue
  }

  $arguments = @()
  for ($index = 1; $index -lt $commandAst.CommandElements.Count; $index++) {
    $arguments += $commandAst.CommandElements[$index].Extent.Text.Trim()
  }

  $commands += [PSCustomObject]@{
    name = $name
    text = $commandAst.Extent.Text.Trim()
    args = @($arguments)
  }
}

[PSCustomObject]@{
  success = (-not $hasUnresolvedCommand) -and $commands.Count -gt 0
  commands = @($commands)
  hasRedirection = $hasRedirection
} | ConvertTo-Json -Compress -Depth 5
`,
  'utf16le'
).toString('base64');

export interface PowerShellParserSpawnResult {
  error?: NodeJS.ErrnoException;
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string | Buffer | null;
  stderr: string | Buffer | null;
}

export interface PowerShellParserSpawnOptions {
  env: NodeJS.ProcessEnv;
  encoding: 'utf8';
  timeout: number;
  maxBuffer: number;
  windowsHide: true;
  shell: false;
}

export type PowerShellParserRunner = (
  executable: string,
  args: readonly string[],
  options: PowerShellParserSpawnOptions
) => PowerShellParserSpawnResult;

export interface PowerShellParserOptions {
  /** Explicit resolved executable. Defaults to pwsh, then powershell on ENOENT. */
  executable?: string;
  /** Test seam; production uses spawnSync with shell:false. */
  runner?: PowerShellParserRunner;
  timeoutMs?: number;
}

interface NativePowerShellParseResult {
  success: boolean;
  commands: Array<{ name: string; text: string; args: string[] }>;
  hasRedirection: boolean;
}

function failedParse(warning: string): ParseResult {
  return {
    commands: [],
    usedTreeSitter: false,
    warnings: [warning],
    hasRedirection: false,
  };
}

function defaultRunner(
  executable: string,
  args: readonly string[],
  options: PowerShellParserSpawnOptions
): PowerShellParserSpawnResult {
  return spawnSync(executable, args, options);
}

function parserEnvironment(command: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { [POWERSHELL_COMMAND_ENV]: command };
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']);

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) {
      env[key] = value;
    }
  }

  return env;
}

function normalizePowerShellCommandName(name: string): string {
  const unquoted = name.trim().replace(/^(['"])(.*)\1$/, '$2');
  const parts = unquoted.split(/[\\/]/).filter(Boolean);
  return (parts.at(-1) ?? unquoted).replace(/\.exe$/i, '').toLowerCase();
}

function isNativePowerShellParseResult(value: unknown): value is NativePowerShellParseResult {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  if (
    candidate.success !== true ||
    !Array.isArray(candidate.commands) ||
    candidate.commands.length === 0 ||
    typeof candidate.hasRedirection !== 'boolean'
  ) {
    return false;
  }

  return candidate.commands.every((command) => {
    if (!command || typeof command !== 'object') return false;
    const detail = command as Record<string, unknown>;
    return (
      typeof detail.name === 'string' &&
      detail.name.trim().length > 0 &&
      typeof detail.text === 'string' &&
      detail.text.trim().length > 0 &&
      Array.isArray(detail.args) &&
      detail.args.every((argument) => typeof argument === 'string')
    );
  });
}

/**
 * Parse a PowerShell command with the native PowerShell AST.
 *
 * Fail-closed contract: every failure is represented by zero commands and at
 * least one warning. Consumers must refuse such a result.
 */
export function parsePowerShellCommand(
  input: string,
  options: PowerShellParserOptions = {}
): ParseResult {
  if (typeof input !== 'string' || !input.trim()) {
    return failedParse('PowerShell parser received an empty command');
  }

  const runner = options.runner ?? defaultRunner;
  const executables = options.executable ? [options.executable] : ['pwsh', 'powershell'];

  for (const executable of executables) {
    let result: PowerShellParserSpawnResult;
    try {
      result = runner(
        executable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', POWERSHELL_PARSER_SCRIPT],
        {
          env: parserEnvironment(input),
          encoding: 'utf8',
          timeout: options.timeoutMs ?? POWERSHELL_PARSE_TIMEOUT_MS,
          maxBuffer: POWERSHELL_PARSE_MAX_BUFFER,
          windowsHide: true,
          shell: false,
        }
      );
    } catch {
      return failedParse('PowerShell parser execution threw unexpectedly');
    }

    if (result.error) {
      if (result.error.code === 'ENOENT' && executable !== executables.at(-1)) {
        continue;
      }
      if (result.error.code === 'ETIMEDOUT') {
        return failedParse('PowerShell parser timed out');
      }
      return failedParse(`PowerShell parser unavailable (${result.error.code ?? 'spawn error'})`);
    }

    if (result.signal !== null) {
      return failedParse('PowerShell parser was terminated before completion');
    }
    if (result.status !== 0) {
      return failedParse(`PowerShell parser exited with status ${result.status ?? 'unknown'}`);
    }
    if (String(result.stderr ?? '').trim()) {
      return failedParse('PowerShell parser wrote to stderr');
    }

    const output = String(result.stdout ?? '')
      .trim()
      .replace(/^\uFEFF/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return failedParse('PowerShell parser returned invalid JSON');
    }

    if (!isNativePowerShellParseResult(parsed)) {
      return failedParse('PowerShell parser returned an incomplete AST result');
    }

    const commands: ParsedCommand[] = parsed.commands.map((command) => ({
      command: normalizePowerShellCommandName(command.name),
      args: command.args,
      raw: command.text.trim(),
      connector: null,
      isSubshell: false,
    }));

    return {
      commands,
      usedTreeSitter: false,
      warnings: [],
      hasRedirection: parsed.hasRedirection,
    };
  }

  return failedParse('PowerShell parser unavailable (ENOENT)');
}
