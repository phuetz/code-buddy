import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSandboxConfigForMode, OSSandbox } from '../../src/sandbox/os-sandbox.js';
import { probeNativeSandbox } from './native-sandbox-ready.js';
import { executeInWorkspaceSandbox } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import { formatRuntimeSettingsContext } from '../../src/services/runtime-settings-context.js';

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
      // The native runtime already offers persistent scratch. The model must
      // know to use it rather than hard-code the per-invocation /tmp mount.
      const guidance = formatRuntimeSettingsContext({ surface: 'cli' });
      expect(guidance).toContain('$TMPDIR');
      expect(guidance).toContain('/tmp');
      expect(guidance).toContain('between shell calls');
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

it('npm run test reconnaît le préfixe NODE_OPTIONS cité de WorkflowBuilder', async context => {
  if (!ready.ready) context.skip();
  const { workspace } = lane('shared');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: "NODE_OPTIONS='--max-old-space-size=8192' vitest" } }));
  fs.writeFileSync(path.join(workspace, 'vitest.config.mjs'), "import { defineConfig } from 'vitest/config'; export default defineConfig({test:{include:['sample.test.js']}});\n");
  fs.appendFileSync(path.join(workspace, 'sample.test.js'), "it('options preserved', () => expect(process.env.NODE_OPTIONS).toContain('--max-old-space-size=8192'));\n");
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests');
  getPermissionModeManager().setMode('dontAsk');
  const result = await executeInWorkspaceSandbox('npm run test -- sample.test.js --run --maxWorkers=1', workspace, 30000);
  expect(result.result?.exitCode, result.result?.stderr).toBe(0);
  expect(result.result?.stdout).toContain('2 passed');
  expect(result.result?.stderr).not.toContain('EROFS');
  const explicit = await executeInWorkspaceSandbox('npm run test -- sample.test.js --run --maxWorkers=1 --configLoader=bundle', workspace, 30000);
  expect(explicit.result?.exitCode, explicit.result?.stderr).toBe(0);
  expect(explicit.result?.stdout).toContain('2 passed');
}, 60000);

it('exécute la configuration ESM avec __dirname dans un cache Vite privé', async context => {
  if (!ready.ready) context.skip();
  const { workspace } = lane('shared');
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: "NODE_OPTIONS='--max-old-space-size=8192' vitest" } }));
  fs.writeFileSync(path.join(workspace, 'vitest.config.mjs'), "import { defineConfig } from 'vitest/config'; if (__dirname !== process.cwd()) throw new Error('Wrong config directory'); export default defineConfig({test:{include:['sample.test.js']}});\n");
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests');
  getPermissionModeManager().setMode('dontAsk');
  for (const command of ['node node_modules/vitest/vitest.mjs run --maxWorkers=1', 'npm test -- --run --maxWorkers=1', 'npx vitest run --maxWorkers=1']) {
    const result = await executeInWorkspaceSandbox(command, workspace, 30000);
    expect(result.result?.exitCode, result.result?.stderr).toBe(0);
    expect(result.result?.stdout).toContain('1 passed');
  }
  const marker = `cache-marker-${path.basename(workspace)}-${Date.now()}`;
  const cache = path.join(fs.realpathSync(path.join(workspace, 'node_modules')), '.vite-temp');
  const write = await executeInWorkspaceSandbox(`printf private > node_modules/.vite-temp/${marker}`, workspace, 5000);
  expect(write.result?.exitCode, write.result?.stderr).toBe(0);
  expect(fs.existsSync(path.join(cache, marker))).toBe(false);
  const next = await executeInWorkspaceSandbox(`test ! -e node_modules/.vite-temp/${marker}`, workspace, 5000);
  expect(next.result?.exitCode).toBe(0);
  const denied = await executeInWorkspaceSandbox('touch node_modules/vitest/forbidden-banc-write', workspace, 5000);
  expect(denied.result?.exitCode).not.toBe(0);
}, 90000);

it('ne crée pas de cache privé en lecture seule ni sur un lien symbolique', async () => {
  const { workspace } = lane('shared');
  const readOnly = await createSandboxConfigForMode('read-only', workspace);
  expect(readOnly.privateViteCachePath).toBeUndefined();
  expect(readOnly.env?.CODEBUDDY_SANDBOX_VITE_CACHE).toBeUndefined();
  const modules = path.join(workspace, 'node_modules');
  fs.unlinkSync(modules); // This lane's symlink, never the shared dependencies.
  fs.mkdirSync(modules);
  fs.symlinkSync(workspace, path.join(modules, '.vite-temp'), 'dir');
  const linked = await createSandboxConfigForMode('workspace-write', workspace);
  expect(linked.privateViteCachePath).toBeUndefined();
  expect(linked.env?.CODEBUDDY_SANDBOX_VITE_CACHE).toBeUndefined();
});

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
  fs.writeFileSync(path.join(workspace, 'vitest.config.mjs'), "if (__dirname !== process.cwd()) throw new Error('Bundle loader required'); export default {test:{include:['sample.test.js']}};\n");
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests');
  if (!ready.ready) return;
  const explicit = await executeInWorkspaceSandbox('npx vitest run --configLoader=bundle --maxWorkers=1', workspace, 30000);
  expect(explicit.result?.exitCode, explicit.result?.stderr).toBe(0);
  expect(explicit.result?.stdout).toContain('1 passed');
  const other = await executeInWorkspaceSandbox('npx --version', workspace, 5000);
  expect(other.result?.exitCode).toBe(0);
  expect(other.result?.stdout).toMatch(/\d+\.\d+\.\d+/);
}, 60000);
