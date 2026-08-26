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
