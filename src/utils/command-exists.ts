import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';

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

const DEFAULT_TIMEOUT_MS = 5000;

const defaultRuntime: CommandExistsRuntime = {
  spawn,
};

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
