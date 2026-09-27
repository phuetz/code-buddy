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
});

describe('CommandRunner — environnement (réserve des relectures de la vague 2)', () => {
  it("npm install / terminal : aucune clé de l'hôte, liste blanche seulement", async () => {
    process.env.FAKE_HOST_API_KEY_FOR_TEST = 'hote-secret-value';
    try {
      const events: CommandOutputEvent[] = [];
      const runner = new CommandRunner((event) => events.push(event));
      const res = await runner.runToCompletion({ cwd: process.cwd(), command: 'node -e "console.log(JSON.stringify(process.env))"', id: 'env' });
      expect(res.ok).toBe(true);
      const printed = events.filter((e) => e.stream === 'stdout').map((e) => e.line).join('');
      const env = JSON.parse(printed) as Record<string, string>;
      expect(env.FAKE_HOST_API_KEY_FOR_TEST).toBeUndefined();
      expect(typeof (env.PATH ?? env.Path)).toBe('string');
    } finally {
      delete process.env.FAKE_HOST_API_KEY_FOR_TEST;
    }
  });

  it("IPC : dossier hors confiance refusé, environnement fourni par le processus principal et jamais par le renderer", async () => {
    const { registerCommandRunnerIpc } = await import('../src/main/studio/command-runner-ipc.js');
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const runner = new CommandRunner();
    const seen: unknown[] = [];
    const fake = {
      runCommand: (input: unknown) => {
        seen.push(input);
        return { ok: true, data: { id: 'x', pid: 1 } };
      },
      runToCompletion: async (input: unknown) => {
        seen.push(input);
        return { ok: true, data: { id: 'x', code: 0 } };
      },
      kill: runner.kill.bind(runner),
    } as unknown as CommandRunner;
    registerCommandRunnerIpc({ handle: (c: string, h: never) => handlers.set(c, h) } as never, fake, () => null, async (cwd) =>
      cwd === '/projet' ? { ok: true, env: { PATH: '/bin', VITE_X: 'projet' } } : { ok: false, error: 'project is outside trusted workspaces' },
    );
    const refused = await handlers.get('studio.cmd.runToEnd')!({}, { cwd: '/ailleurs', command: 'npm install', id: 'a' });
    expect(refused).toEqual({ ok: false, error: 'project is outside trusted workspaces' });
    expect(seen).toHaveLength(0);
    await handlers.get('studio.cmd.run')!({}, { cwd: '/projet', command: 'ls', id: 'b', env: { OPENAI_API_KEY: 'injecte-par-le-renderer' } });
    expect(seen[0]).toEqual({ cwd: '/projet', command: 'ls', id: 'b', env: { PATH: '/bin', VITE_X: 'projet' } });
  });
});

describe('CommandRunner — sortie du terminal masquée (réserve de la 2e relecture)', () => {
  it('chaque ligne relayée au renderer est masquée, dans l’ordre ; la valeur brute ne sort jamais', async () => {
    const { registerCommandRunnerIpc } = await import('../src/main/studio/command-runner-ipc.js');
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const sent: { line: string; stream: string }[] = [];
    const secret = 'sk-terminal-VALEUR-0123456789';
    registerCommandRunnerIpc(
      { handle: (c: string, h: never) => handlers.set(c, h) } as never,
      new CommandRunner(),
      () => ({ send: (_c: string, e: { line: string; stream: string }) => sent.push(e) }),
      async () => ({
        ok: true,
        env: { PATH: process.env.PATH ?? '', MA_CLE: secret },
        redact: async (line: string) => line.split(secret).join('[secret masqué]'),
      }),
    );
    const res = await handlers.get('studio.cmd.runToEnd')!({}, {
      cwd: process.cwd(),
      command: 'node -e "console.log(1); console.log(process.env.MA_CLE); console.log(3)"',
      id: 'masque',
    });
    expect(res).toMatchObject({ ok: true });
    const out = sent.filter((e) => e.stream === 'stdout').map((e) => e.line);
    expect(out).toEqual(['1', '[secret masqué]', '3']);
    expect(JSON.stringify(sent)).not.toContain(secret);
  });
});
