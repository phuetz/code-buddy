import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Real POSIX signals and production command/runner, with an injected offline CLI.
describe.skipIf(process.platform === 'win32')('Colab process signal cleanup', () => {
  it.each([
    ['runner', 'SIGINT', 0], ['runner', 'SIGTERM', 0],
    ['command', 'SIGINT', 130], ['command', 'SIGTERM', 143],
    ['server', 'SIGINT', 0], ['server', 'SIGTERM', 0],
  ] as const)('%s receives real %s, closes VM before exit %s', async (mode, signal, exitCode) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'colab-signal-'));
    try {
      await fs.writeFile(path.join(root, 'job.py'), 'print(42)');
      const source = `
        import { ColabRunner } from ${JSON.stringify(new URL('../../src/compute/colab-runner.ts', import.meta.url).href)};
        import { registerColabCommands } from ${JSON.stringify(new URL('../../src/commands/cli/colab-command.ts', import.meta.url).href)};
        import { Command } from 'commander';
        import { promises as fs } from 'node:fs';
        import { getShutdownManager } from ${JSON.stringify(new URL('../../src/utils/graceful-shutdown.ts', import.meta.url).href)};
        const root = ${JSON.stringify(root)}, calls = [];
        let active;
        // Reproduce the signal handlers installed by src/index.ts. They must
        // not race runner finally and exit while its VM is still being stopped.
        if (${JSON.stringify(mode)} !== 'runner') {
          const shutdown = getShutdownManager({ showProgress: false, timeoutMs: 200 });
          shutdown.registerSignalHandlers();
          shutdown.registerHandler({ name: 'closure-observer', priority: 1000, handler: async () => {
            if (active) console.log('PREMATURE_GLOBAL_SHUTDOWN');
            const ledger = JSON.parse(await fs.readFile(root + '/state/colab-units.json', 'utf8'));
            console.log(JSON.stringify({ active: !!active, calls, open: ledger.open, globalObserved: true }));
          }});
        }
        const original = process.rawListeners(${JSON.stringify(signal)});
        const cli = async (args, options) => {
          calls.push(args[0]); let stdout = '';
          if (args[0] === 'new') active = args[2];
          // Host shutdown has a 1s timer floor: exceed it to exercise the
          // critical cleanup budget, rather than merely the await barrier.
          if (args[0] === 'stop') { await new Promise(resolve => setTimeout(resolve, ${mode === 'server' ? 1400 : 30})); active = undefined; }
          if (args[0] === 'usage') stdout = 'Current balance: 100.00 compute units\\nUsage rate: 0.00/hr\\nActive assignments: ' + (active ? 1 : 0);
          if (args[0] === 'sessions') stdout = active ? '[' + active + ']' : '[colab] No active sessions found on server.';
          if (args[0] === 'exec' && options.stdin.includes('runpy.run_path')) {
            await new Promise((resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
              console.log('CB_SIGNAL_READY');
            });
          }
          return { code: 0, stdout, stderr: '' };
        };
        const runner = new ColabRunner({ cli, projectRoot: root, stateDir: root + '/state' });
        let error;
        if (${JSON.stringify(mode)} === 'command') {
          const program = new Command(); registerColabCommands(program, runner);
          await program.parseAsync(['colab', 'run', 'job.py'], { from: 'user' });
        } else {
          try { await runner.run({ script: 'job.py' }); } catch (caught) { error = String(caught); }
        }
        const ledger = JSON.parse(await fs.readFile(root + '/state/colab-units.json', 'utf8'));
        const restored = process.rawListeners(${JSON.stringify(signal)});
        console.log(JSON.stringify({ active: !!active, calls, open: ledger.open, error, exitCode: process.exitCode ?? 0,
          listenersRestored: original.length === restored.length && original.every(listener => restored.includes(listener)) }));
      `;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
        env: { ...process.env, CODEBUDDY_COLAB: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', signalled = false, timedOut = false;
      child.stdout.on('data', data => {
        stdout += data;
        if (!signalled && stdout.includes('CB_SIGNAL_READY')) { signalled = true; child.kill(signal); }
      });
      child.stderr.on('data', data => { stderr += data; });
      let failure: Error | undefined;
      child.on('error', error => { failure = error; });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 4000);
      await new Promise<void>(resolve => child.on('close', () => { clearTimeout(timer); resolve(); }));
      expect(failure).toBeUndefined(); expect(timedOut, stderr).toBe(false); expect(signalled).toBe(true);
      expect(child.exitCode, stderr).toBe(exitCode);
      const records = stdout.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
      const result = records.find(record => mode === 'server' ? record.globalObserved : !record.globalObserved);
      expect(result, stdout).toBeDefined();
      expect(result.active).toBe(false); expect(result.open).toEqual({});
      expect(result.calls.filter((name: string) => name === 'stop')).toHaveLength(1);
      if (mode !== 'server') {
        expect(result.exitCode).toBe(exitCode); expect(result.listenersRestored).toBe(true);
      }
      expect(stdout).not.toContain('PREMATURE_GLOBAL_SHUTDOWN');
      if (mode === 'runner') expect(result.error).toContain(signal);
      else if (mode === 'command') expect(stderr).toContain(signal);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
