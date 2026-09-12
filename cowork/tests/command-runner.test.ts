import { describe, expect, it } from 'vitest';
import { CommandRunner, type CommandOutputEvent } from '../src/main/studio/command-runner.js';

function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Timed out waiting for command runner event'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('CommandRunner', () => {
  it('runs a command and streams stdout line by line', async () => {
    const events: CommandOutputEvent[] = [];
    const runner = new CommandRunner((event) => events.push(event));

    const result = runner.runCommand({ cwd: process.cwd(), command: 'echo hello', id: 'echo' });

    expect(result.ok).toBe(true);
    await waitFor(() => events.some((event) => event.stream === 'stdout' && event.line === 'hello'));
  });

  it('kills a running command', async () => {
    const events: CommandOutputEvent[] = [];
    const runner = new CommandRunner((event) => events.push(event));
    const command = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`;

    const result = runner.runCommand({ cwd: process.cwd(), command, id: 'long' });
    expect(result.ok).toBe(true);
    expect(runner.kill('long')).toEqual({ ok: true, data: { id: 'long', killed: true } });

    await waitFor(() => events.some((event) => event.stream === 'system' && event.line.includes('Command exited')));
  });
});

describe('CommandRunner.runToCompletion', () => {
  it('streams output and resolves with exit code 0 on success', async () => {
    const events: CommandOutputEvent[] = [];
    const runner = new CommandRunner((event) => events.push(event));

    const result = await runner.runToCompletion({ cwd: process.cwd(), command: 'echo built', id: 'install-ok' });

    expect(result).toEqual({ ok: true, data: { id: 'install-ok', code: 0 } });
    expect(events.some((e) => e.stream === 'stdout' && e.line === 'built')).toBe(true);
  });

  it('resolves with the non-zero code when the command fails (auto-fix trigger)', async () => {
    const runner = new CommandRunner();
    const command = `${JSON.stringify(process.execPath)} -e "process.exit(3)"`;

    const result = await runner.runToCompletion({ cwd: process.cwd(), command, id: 'install-fail' });

    expect(result).toEqual({ ok: true, data: { id: 'install-fail', code: 3 } });
  });

  it('rejects a duplicate id and missing fields', async () => {
    const runner = new CommandRunner();
    expect(await runner.runToCompletion({ cwd: process.cwd(), command: '', id: 'x' })).toEqual({
      ok: false,
      error: 'command is required',
    });
  });

  it('sets NODE_ENV=development in spawned child process even if parent is production', async () => {
    const events: CommandOutputEvent[] = [];
    const runner = new CommandRunner((event) => events.push(event));
    const command = `${JSON.stringify(process.execPath)} -e "console.log(process.env.NODE_ENV)"`;

    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await runner.runToCompletion({ cwd: process.cwd(), command, id: 'env-test' });
      expect(result.ok).toBe(true);
      const stdout = events.find((e) => e.stream === 'stdout' && e.id === 'env-test');
      expect(stdout?.line).toBe('development');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it('allows explicit env overrides in input', async () => {
    const events: CommandOutputEvent[] = [];
    const runner = new CommandRunner((event) => events.push(event));
    const command = `${JSON.stringify(process.execPath)} -e "console.log(process.env.CUSTOM_FLAG)"`;

    const result = await runner.runToCompletion({
      cwd: process.cwd(),
      command,
      id: 'custom-env-test',
      env: { CUSTOM_FLAG: 'custom_value_123' },
    });
    expect(result.ok).toBe(true);
    const stdout = events.find((e) => e.stream === 'stdout' && e.id === 'custom-env-test');
    expect(stdout?.line).toBe('custom_value_123');
  });
});
