import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface CommandExistsRuntime {
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
}

export interface CommandExistsOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  runtime?: CommandExistsRuntime;
}

export interface CommandLookup {
  command: string;
  args: string[];
}

export interface ExecutableResolutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  isExecutable?: (candidate: string) => boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;

const defaultRuntime: CommandExistsRuntime = {
  spawn,
};

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Enumerate the paths the host would consider for an executable token.
 * Keeping this shared avoids subtly different PATH/PATHEXT handling between
 * shell selection and executable identity checks.
 */
export function executableCandidates(
  token: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (token.includes('/') || (platform === 'win32' && token.includes('\\'))) {
    return [path.resolve(cwd, token)];
  }

  const searchPath = env.PATH ?? process.env.PATH ?? '';
  const configuredExtensions = platform === 'win32'
    ? (env.PATHEXT ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const tokenAlreadyHasExtension = platform === 'win32' && configuredExtensions.some(
    (extension) => token.toLowerCase().endsWith(extension.toLowerCase()),
  );
  const extensions = tokenAlreadyHasExtension ? [''] : configuredExtensions;

  return searchPath
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => extensions.map((extension) => path.join(directory, `${token}${extension}`)));
}

/** Resolve an executable synchronously for call sites whose public API is synchronous. */
export function resolveExecutable(
  executable: string,
  options: ExecutableResolutionOptions = {},
): string | undefined {
  const normalizedExecutable = executable.trim();
  if (!normalizedExecutable) return undefined;

  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const isExecutable = options.isExecutable ?? isExecutableFile;

  return executableCandidates(normalizedExecutable, cwd, env, platform)
    .find((candidate) => isExecutable(candidate));
}

export function resolveCommandLookup(command: string, platform: NodeJS.Platform = process.platform): CommandLookup {
  if (platform === 'win32') {
    return { command: 'where.exe', args: [command] };
  }

  return {
    command: 'sh',
    args: ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command],
  };
}

export function commandExists(command: string, options: CommandExistsOptions = {}): Promise<boolean> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return Promise.resolve(false);
  }

  const runtime = options.runtime ?? defaultRuntime;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lookup = resolveCommandLookup(normalizedCommand, options.platform);

  return new Promise((resolve) => {
    let child: ChildProcess;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const done = (exists: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(exists);
    };

    try {
      child = runtime.spawn(lookup.command, lookup.args, {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      done(false);
      return;
    }

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Process may already have exited.
        }
        done(false);
      }, timeoutMs);
    }

    child.on('close', (code) => {
      done(code === 0);
    });
    child.on('error', () => {
      done(false);
    });
  });
}
