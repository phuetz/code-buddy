import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createSandboxConfigForMode, OSSandbox } from '../../src/sandbox/os-sandbox.js';
import { probeNativeSandbox } from './native-sandbox-ready.js';

const ready = await probeNativeSandbox();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd, encoding: 'utf8' }).trim();
}
function lane(kind: 'shared' | 'worktree') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-banc-')); roots.push(root);
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  git(source, 'init', '-q');
  fs.writeFileSync(path.join(source, 'sample.test.js'), "import { it, expect } from 'vitest'; it('tiny', () => expect(2 + 2).toBe(4));\n");
  git(source, 'add', 'sample.test.js');
  git(source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  const workspace = path.join(root, 'lane');
  if (kind === 'shared') git(root, 'clone', '-qs', source, workspace);
  else git(source, 'worktree', 'add', '-q', '-b', 'lane', workspace);
  fs.symlinkSync(fs.realpathSync('node_modules'), path.join(workspace, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(source, '.npmrc'), 'SECRET_SENTINEL');
  return { workspace, source };
}

describe.sequential('banc shell : clone partagé et worktree', () => {
  for (const kind of ['shared', 'worktree'] as const) {
    it(`résout objets, Vitest, Node et temporaire de session (${kind})`, async () => {
      const { workspace, source } = lane(kind);
      const config = await createSandboxConfigForMode('workspace-write', workspace);
      // These assertions also run on runners without a native backend.
      expect(config.readOnlyPaths).toContain(fs.realpathSync('node_modules'));
      expect(config.readOnlyPaths).toContain(path.join(source, '.git', kind === 'shared' ? 'objects' : ''));
      expect(config.env?.PATH?.split(path.delimiter)[0]).toBe(path.dirname(process.execPath));
      expect(config.env?.TMPDIR).toBeTruthy();
      if (!ready.ready) return;
      const sandbox = new OSSandbox({ ...config, backend: ready.landlock.ok ? 'landlock' : 'bubblewrap', timeout: 30000 });
      const result = await sandbox.execShellTracked('git status --short && git cat-file -t HEAD && node --version && node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers=1');
      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain('commit');
      expect(result.stdout).toContain(process.version);
      expect(result.stdout).toContain('1 passed');
      const write = await sandbox.execShellTracked('printf banc > "$TMPDIR/session.txt"');
      expect(write.exitCode, write.stderr).toBe(0);
      // Recreate the sandbox as BashTool does between tool calls.
      const next = new OSSandbox({ ...await createSandboxConfigForMode('workspace-write', workspace), backend: sandbox.getBackend(), timeout: 5000 });
      expect((await next.execShellTracked('cat "$TMPDIR/session.txt"')).stdout).toBe('banc');
      const secret = await next.execShellTracked(`cat '${path.join(source, '.npmrc')}'`);
      expect(secret.exitCode).not.toBe(0);
      expect(secret.stdout).not.toContain('SECRET_SENTINEL');
      const mutate = await next.execShellTracked(`touch '${path.join(source, '.git', 'objects', 'forbidden')}'`);
      expect(mutate.exitCode).not.toBe(0);
    }, 60000);
  }
});
