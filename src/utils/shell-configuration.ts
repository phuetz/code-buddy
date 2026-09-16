import { resolveExecutable } from './command-exists.js';

export type ShellType = 'bash' | 'powershell' | 'cmd';

export interface ShellConfiguration {
  executable: string;
  argsPrefix: string[];
  shell: ShellType;
}

const POWERSHELL_ARGS_PREFIX = ['-NoProfile', '-NonInteractive', '-Command'];
const shellConfigurationCache = new Map<NodeJS.Platform, ShellConfiguration>();

function isPowerShellExecutable(executable: string): boolean {
  return /(?:^|[\\/])(?:powershell|pwsh)\.exe$/i.test(executable.trim());
}

/**
 * Select the one shell used for host command execution.
 *
 * PowerShell 7 is preferred on Windows because Windows PowerShell 5.1 can
 * silently strip embedded double quotes passed to native executables.
 */
export function getShellConfiguration(
  platform: NodeJS.Platform = process.platform,
): ShellConfiguration {
  const cached = shellConfigurationCache.get(platform);
  if (cached) return cached;

  let configuration: ShellConfiguration;
  if (platform !== 'win32') {
    configuration = {
      executable: 'bash',
      argsPrefix: ['-c'],
      shell: 'bash',
    };
  } else {
    const comSpec = process.env.ComSpec;
    if (comSpec && isPowerShellExecutable(comSpec)) {
      configuration = {
        executable: comSpec,
        argsPrefix: [...POWERSHELL_ARGS_PREFIX],
        shell: 'powershell',
      };
    } else {
      configuration = {
        executable: resolveExecutable('pwsh.exe', { platform }) ?? 'powershell.exe',
        argsPrefix: [...POWERSHELL_ARGS_PREFIX],
        shell: 'powershell',
      };
    }
  }

  shellConfigurationCache.set(platform, configuration);
  return configuration;
}

const SHELL_DISPLAY_NAMES: Record<ShellType, string> = {
  bash: 'bash',
  powershell: 'PowerShell',
  cmd: 'cmd.exe',
};

/**
 * Model-facing description for the `bash` tool, derived from the shell that
 * actually executes commands. The model picks its command syntax from this
 * text, so a PowerShell host must not advertise bash (gemini-cli pattern).
 * The bash wording is the historical text, kept byte-identical on POSIX.
 */
export function getShellToolDescription(
  configuration: ShellConfiguration = getShellConfiguration(),
): string {
  const factsSentence =
    'Prefer it to check facts and state you can verify (git status, test output, file existence, exit codes) rather than assuming.';
  if (configuration.shell === 'bash') {
    return `Execute a bash command. ${factsSentence}`;
  }
  const executableName =
    configuration.executable.split(/[\\/]/).pop() || configuration.executable;
  const invocation = [executableName, ...configuration.argsPrefix, '<command>'].join(' ');
  const shellName = SHELL_DISPLAY_NAMES[configuration.shell];
  return `Execute a ${shellName} command (runs as \`${invocation}\`). Write ${shellName} syntax, not POSIX bash. ${factsSentence}`;
}

/** Model-facing description of the `command` parameter, same derivation. */
export function getShellCommandParamDescription(
  configuration: ShellConfiguration = getShellConfiguration(),
): string {
  if (configuration.shell === 'bash') {
    return 'The bash command to execute';
  }
  return `The ${SHELL_DISPLAY_NAMES[configuration.shell]} command to execute`;
}

/**
 * Quote one argument for the selected host shell.
 *
 * POSIX ends the quoted run and reopens it around an escaped quote; PowerShell
 * doubles the quote inside the literal. The bash branch is byte-identical to
 * `sanitizeForShell`, so POSIX command strings are unchanged.
 */
export function quoteShellArgument(
  value: string,
  configuration: ShellConfiguration = getShellConfiguration(),
): string {
  if (configuration.shell === 'bash') {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Directory listing for the selected host shell.
 *
 * `ls -la` is POSIX-only: PowerShell binds `-la` to no parameter of
 * `Get-ChildItem` and fails, so the helper must emit the host's own listing.
 */
export function shellListFilesCommand(
  directory: string,
  configuration: ShellConfiguration = getShellConfiguration(),
): string {
  const quoted = quoteShellArgument(directory, configuration);
  if (configuration.shell === 'bash') {
    return `ls -la ${quoted}`;
  }
  return `Get-ChildItem -Force -LiteralPath ${quoted}`;
}

/** Keep the plain working-directory probe usable with the selected host shell. */
export function shellWorkingDirectoryCommand(
  command: string,
  configuration: ShellConfiguration,
): string {
  if (configuration.shell === 'powershell' && command.trim() === 'pwd') {
    return 'Get-Location | Select-Object -ExpandProperty Path';
  }
  return command;
}
