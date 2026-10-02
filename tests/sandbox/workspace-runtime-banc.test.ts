import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSandboxConfigForMode, OSSandbox } from '../../src/sandbox/os-sandbox.js';
import { probeNativeSandbox } from './native-sandbox-ready.js';
import { executeInWorkspaceSandbox } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';

const ready = await probeNativeSandbox();
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); getPermissionModeManager().setMode('default'); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
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

it.each(['tests', 'tests,npm-registry'])('npm test charge Vitest sans écrire dans les dépendances partagées (%s)', async (capabilities) => {
  const { workspace } = lane('shared');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'vitest run --maxWorkers=1' } }));
  fs.writeFileSync(path.join(workspace, 'vitest.config.mjs'), "import { defineConfig } from 'vitest/config'; export default defineConfig({test:{include:['sample.test.js']}});\n");
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', capabilities);
  getPermissionModeManager().setMode('dontAsk');
  if (!ready.ready) return;
  const result = await executeInWorkspaceSandbox('npm test', workspace, 30000);
  expect(result.result?.exitCode, result.result?.stderr).toBe(0);
  expect(result.result?.stdout).toContain('1 passed');
  const mutation = await executeInWorkspaceSandbox('node -e "require(\'node:fs\').writeFileSync(\'node_modules/vitest/smuggled\', \'bad\')"', workspace, 5000);
  expect(mutation.result?.exitCode).not.toBe(0);
  expect(fs.existsSync(path.join(workspace, 'node_modules/vitest/smuggled'))).toBe(false);
}, 60000);

// Recorded Ornith call XB7FNd5Jot9uqxT6YuZeCOLi3eiS2T49 used npx directly.
it.each(['', '--configLoader runner'])('npx Vitest respecte les dépendances en lecture seule (%s)', async (loader) => {
  const { workspace } = lane('shared');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(path.join(workspace, 'vitest.config.mjs'), "import { defineConfig } from 'vitest/config'; export default defineConfig({test:{include:['sample.test.js']}});\n");
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests');
  getPermissionModeManager().setMode('dontAsk');
  if (!ready.ready) return;
  const result = await executeInWorkspaceSandbox(`cd '${workspace}' && npx vitest run sample.test.js -t 'tiny' --maxWorkers=1 ${loader} 2>&1 | tail -25`, workspace, 30000);
  // The recorded tail pipeline hides a nonzero exit, so verify the test outcome.
  expect(result.result?.stdout, result.result?.stderr).toContain('1 passed');
  expect(result.result?.stdout).not.toContain('EROFS');
}, 60000);

it('npx conserve le choix explicite de chargeur et délègue les autres commandes', async () => {
  const { workspace } = lane('shared');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(path.join(workspace, 'vitest.config.mjs'), "export default {test:{include:['sample.test.js']}};\n");
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests');
  if (!ready.ready) return;
  const explicit = await executeInWorkspaceSandbox('npx vitest run --configLoader=bundle --maxWorkers=1', workspace, 30000);
  expect(explicit.result?.exitCode).not.toBe(0);
  expect(explicit.result?.stderr).toContain('EROFS');
  const other = await executeInWorkspaceSandbox('npx --version', workspace, 5000);
  expect(other.result?.exitCode).toBe(0);
  expect(other.result?.stdout).toMatch(/\d+\.\d+\.\d+/);
}, 60000);
