import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNpmRegistryBroker } from '../../src/sandbox/npm-registry-broker.js';

const temporaryRoots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'linux')('lockfile B avec des sources externes déjà verrouillées', () => {
  it.each(['file:/outside/package', 'git+file:/outside/package'])('refuse une source locale avant un audit hôte: %s', async spec => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-audit-')); temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
    fs.mkdirSync(workspace); fs.mkdirSync(temporary);
    const manifest = { name: 'fixture', version: '1.0.0', dependencies: { outside: spec } };
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(workspace, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': manifest } }));
    vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'npm-registry');
    const broker = await startNpmRegistryBroker(workspace, temporary);
    try {
      const result = await new Promise<{ error: Error | null; stderr: string }>(resolve => execFile(process.execPath,
        [path.join(broker.directory, 'npm-client.mjs'), 'audit', '--json'],
        { cwd: workspace, encoding: 'utf8', timeout: 20000 }, (error, _stdout, stderr) => resolve({ error, stderr })));
      expect(result.error).not.toBeNull();
      expect(result.stderr).toContain('dependency specs');
    } finally { await broker.close(); }
  });

  it('résout sans scripts ni réseau étranger et garde les sources et workspaces inchangés', async () => {
    let foreignRequests = 0;
    const foreign = http.createServer((_request, response) => { foreignRequests++; response.end('forbidden'); });
    await new Promise<void>(resolve => foreign.listen(0, '127.0.0.1', resolve));
    const port = (foreign.address() as { port: number }).port;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-opaque-')); temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
    fs.mkdirSync(path.join(workspace, 'packages/child'), { recursive: true }); fs.mkdirSync(temporary);
    const dependencies = { 'opaque-url': `http://127.0.0.1:${port}/opaque.tgz`, 'opaque-git': `git+https://127.0.0.1:${port}/opaque.git#${'a'.repeat(40)}` };
    const packages = {
      '': { name: 'fixture', version: '1.0.0', optionalDependencies: dependencies, workspaces: ['packages/*'] },
      'node_modules/opaque-url': { version: '1.0.0', resolved: dependencies['opaque-url'], integrity: 'sha512-' + Buffer.alloc(64).toString('base64'), optional: true },
      'node_modules/opaque-git': { version: '1.0.0', resolved: dependencies['opaque-git'], optional: true },
      'node_modules/fixture-child': { resolved: 'packages/child', link: true },
      'packages/child': { name: 'fixture-child', version: '1.0.0' },
    };
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ ...packages[''], scripts: { prepare: 'touch SCRIPT-RAN' } }));
    fs.writeFileSync(path.join(workspace, 'packages/child/package.json'), JSON.stringify({ name: 'fixture-child', version: '1.0.0', scripts: { prepare: 'touch SCRIPT-RAN' } }));
    fs.writeFileSync(path.join(workspace, 'package-lock.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages }));
    vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'npm-registry');
    const broker = await startNpmRegistryBroker(workspace, temporary);
    try {
      const result = await new Promise<{ error: Error | null; stdout: string; stderr: string }>(resolve => execFile(process.execPath,
        [path.join(broker.directory, 'npm-client.mjs'), 'install', '--package-lock-only', '--ignore-scripts'],
        { cwd: workspace, encoding: 'utf8', timeout: 20000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
      expect(result.error, result.stderr).toBeNull();
      const lock = JSON.parse(fs.readFileSync(path.join(workspace, 'package-lock.json'), 'utf8'));
      for (const key of Object.keys(packages).filter(key => key.startsWith('node_modules/'))) expect(lock.packages[key]).toEqual(packages[key as keyof typeof packages]);
      expect(lock.packages[''].workspaces).toEqual(['packages/*']);
      expect(foreignRequests).toBe(0);
      expect(fs.existsSync(path.join(workspace, 'SCRIPT-RAN'))).toBe(false);
      expect(fs.existsSync(path.join(workspace, 'node_modules'))).toBe(false);
    } finally {
      await broker.close();
      await new Promise<void>(resolve => foreign.close(() => resolve()));
    }
  }, 30000);
});
