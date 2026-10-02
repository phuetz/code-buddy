import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolveWorkspaceRuntime } from '../../src/sandbox/workspace-runtime.js';
import { createSandboxConfigForMode, OSSandbox } from '../../src/sandbox/os-sandbox.js';
import { probeNativeSandbox } from './native-sandbox-ready.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(resolved = 'packages/core', declared = true, packageName = '@fixture/core') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-dependency-'));
  roots.push(root);
  const owner = path.join(root, 'owner');
  const workspace = path.join(root, 'workspace');
  const modules = path.join(owner, 'node_modules');
  const target = path.resolve(owner, resolved);
  fs.mkdirSync(path.join(modules, '@fixture'), { recursive: true });
  fs.mkdirSync(workspace);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: packageName }));
  fs.writeFileSync(path.join(target, 'index.js'), 'module.exports = 42;');
  fs.writeFileSync(path.join(owner, '.npmrc'), 'PARENT_SECRET_SENTINEL');
  fs.writeFileSync(path.join(owner, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: declared ? { 'node_modules/@fixture/core': { link: true, resolved } } : {} }));
  fs.symlinkSync(target, path.join(modules, '@fixture/core'), 'dir');
  fs.symlinkSync(modules, path.join(workspace, 'node_modules'), 'dir');
  return { workspace, owner, modules, target };
}

it('accorde uniquement le paquet lié déclaré dans le lock des dépendances installées', () => {
  const { workspace, owner, target } = fixture();
  const paths = resolveWorkspaceRuntime(workspace).readOnly;
  expect(paths).toContain(target);
  expect(paths).not.toContain(owner);
});

it('ne rend pas le paquet du workspace courant immuable', () => {
  const { owner, target } = fixture();
  expect(resolveWorkspaceRuntime(owner).readOnly).not.toContain(target);
});

it.each([
  ['packages/core', false, '@fixture/core'],
  ['packages/core', true, '@fixture/other'],
  ['../outside', true, '@fixture/core'],
  ['.ssh', true, '@fixture/core'],
  ['packages/.config/core', true, '@fixture/core'],
  ['.', true, '@fixture/core'],
] as const)('refuse une cible non déclarée ou hors portée (%s, %s, %s)', (resolved, declared, name) => {
  const { workspace, target } = fixture(resolved, declared, name);
  expect(resolveWorkspaceRuntime(workspace).readOnly).not.toContain(target);
});

it('refuse un lien dont la cible ne correspond pas au lock', () => {
  const { workspace, owner, modules, target } = fixture();
  fs.writeFileSync(path.join(owner, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@fixture/core': { link: true, resolved: 'packages/other' } } }));
  expect(fs.realpathSync(path.join(modules, '@fixture/core'))).toBe(target);
  expect(resolveWorkspaceRuntime(workspace).readOnly).not.toContain(target);
});

it('refuse aussi une cible déclarée qui sort du propriétaire par un autre lien', () => {
  const { workspace, owner, target } = fixture();
  const external = path.join(path.dirname(owner), 'external');
  fs.renameSync(target, external);
  fs.symlinkSync(external, target, 'dir');
  expect(resolveWorkspaceRuntime(workspace).readOnly).not.toContain(external);
});

it('charge réellement le paquet lié, interdit son écriture et la lecture du parent', async context => {
  const ready = await probeNativeSandbox();
  if (!ready.ready) context.skip();
  const { workspace, owner, target } = fixture();
  const config = await createSandboxConfigForMode('workspace-write', workspace);
  const sandbox = new OSSandbox({ ...config, backend: ready.landlock.ok ? 'landlock' : 'bubblewrap', timeout: 5000 });
  const read = await sandbox.execShellTracked(`node -e "console.log(require('@fixture/core'))"`);
  expect(read.exitCode, read.stderr).toBe(0);
  expect(read.stdout.trim()).toBe('42');
  const write = await sandbox.execShellTracked(`touch '${target}/forbidden'`);
  expect(write.exitCode).not.toBe(0);
  expect(fs.existsSync(path.join(target, 'forbidden'))).toBe(false);
  const secret = await sandbox.execShellTracked(`cat '${owner}/.npmrc'`);
  expect(secret.exitCode).not.toBe(0);
  expect(secret.stdout).not.toContain('PARENT_SECRET_SENTINEL');
});
