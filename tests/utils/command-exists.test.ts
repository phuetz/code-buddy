import { EventEmitter } from 'events';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandExists,
  resolveCommandLookup,
  type CommandExistsRuntime,
} from '../../src/utils/command-exists.js';

class FakeChildProcess extends EventEmitter {
  kill = vi.fn(() => true);
}

function createRuntime(child: FakeChildProcess): CommandExistsRuntime & {
  spawn: ReturnType<typeof vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>>;
} {
  return {
    spawn: vi.fn((_command: string, _args: string[], _options: SpawnOptions) => child as unknown as ChildProcess),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveCommandLookup', () => {
  it('uses where.exe on Windows', () => {
    expect(resolveCommandLookup('ffmpeg', 'win32')).toEqual({
      command: 'where.exe',
      args: ['ffmpeg'],
    });
  });

  it('uses command -v without interpolating the command on Unix-like platforms', () => {
    expect(resolveCommandLookup('edge-tts; rm -rf /', 'linux')).toEqual({
      command: 'sh',
      args: ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', 'edge-tts; rm -rf /'],
    });
  });
});

describe('commandExists', () => {
  it('resolves true when the lookup exits successfully', async () => {
    const child = new FakeChildProcess();
    const runtime = createRuntime(child);
    const result = commandExists('sox', { runtime, platform: 'linux' });

    child.emit('close', 0);

    await expect(result).resolves.toBe(true);
    expect(runtime.spawn).toHaveBeenCalledWith('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', 'sox'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  });

  it('resolves false when the lookup exits unsuccessfully', async () => {
    const child = new FakeChildProcess();
    const runtime = createRuntime(child);
    const result = commandExists('missing-tool', { runtime, platform: 'win32' });

    child.emit('close', 1);

    await expect(result).resolves.toBe(false);
    expect(runtime.spawn).toHaveBeenCalledWith('where.exe', ['missing-tool'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  });

  it('resolves false when spawn fails before close', async () => {
    const child = new FakeChildProcess();
    const runtime = createRuntime(child);
    const result = commandExists('whichless', { runtime, platform: 'linux' });

    child.emit('error', new Error('ENOENT'));

    await expect(result).resolves.toBe(false);
  });

  it('kills the lookup and resolves false on timeout', async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    const runtime = createRuntime(child);
    const result = commandExists('slow-tool', { runtime, platform: 'linux', timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('does not spawn for empty command names', async () => {
    const child = new FakeChildProcess();
    const runtime = createRuntime(child);

    await expect(commandExists('  ', { runtime })).resolves.toBe(false);
    expect(runtime.spawn).not.toHaveBeenCalled();
  });
});
