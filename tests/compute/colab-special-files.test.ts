import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Isolate blocking-open regressions in a direct Node child. Always kill AND reap
// it on timeout; no tsx launcher/grandchild survives a deliberately broken guard.
describe.skipIf(process.platform === 'win32')('Colab regular file guard', () => {
  it.each(['script', 'input', 'replacement'])('refuses a real FIFO (%s) before CLI calls or state writes', async mode => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'colab-fifo-'));
    const target = path.join(root, mode === 'script' ? 'job.py' : 'input.txt');
    const script = path.join(root, 'job.py');
    try {
      await fs.writeFile(script, 'print(42)');
      if (mode === 'replacement') await fs.writeFile(target, 'ordinary file');
      else {
        if (mode === 'script') await fs.unlink(script);
        expect(spawnSync('mkfifo', [target]).status).toBe(0);
      }
      const source = `
        import { promises as fs } from 'node:fs';
        import { spawnSync } from 'node:child_process';
        import { ColabRunner } from ${JSON.stringify(new URL('../../src/compute/colab-runner.ts', import.meta.url).href)};
        const root = ${JSON.stringify(root)}, target = ${JSON.stringify(target)};
        const calls = [];
        if (${JSON.stringify(mode)} === 'replacement') {
          const open = fs.open;
          fs.open = async function(file, ...args) {
            if (file === target) {
              await fs.unlink(target);
              if (spawnSync('mkfifo', [target]).status !== 0) throw new Error('mkfifo failed');
            }
            return open.call(this, file, ...args);
          };
        }
        try {
          await new ColabRunner({ projectRoot: root, stateDir: root + '/state', cli: async args => {
            calls.push(args); throw new Error('Unexpected CLI call');
          }}).run({ script: 'job.py', inputs: ${mode === 'script' ? '[]' : "['input.txt']"} });
          console.log(JSON.stringify({ accepted: true, calls }));
        } catch (error) {
          console.log(JSON.stringify({ error: String(error), calls, files: await fs.readdir(root) }));
        }
      `;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
        env: { ...process.env, CODEBUDDY_COLAB: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', timedOut = false;
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      let failure: Error | undefined;
      child.on('error', error => { failure = error; });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 3000);
      await new Promise<void>(resolve => child.on('close', () => { clearTimeout(timer); resolve(); }));
      expect(failure).toBeUndefined();
      expect(timedOut, `FIFO blocked until child was killed; stderr: ${stderr}`).toBe(false);
      expect(child.exitCode, stderr).toBe(0);
      const result = JSON.parse(stdout.trim());
      expect(result.error).toMatch(/regular file/);
      expect(result.calls).toEqual([]);
      expect(result.files).not.toContain('state');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
