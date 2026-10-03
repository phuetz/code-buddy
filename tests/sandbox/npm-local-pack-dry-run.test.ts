import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { capabilityAllowsSegment, shellCapabilitySnapshot } from '../../src/sandbox/shell-capabilities.js';
import { startNpmRegistryBroker } from '../../src/sandbox/npm-registry-broker.js';

const tests = new Set<'tests'>(['tests']);

describe('inspection locale du paquet sans scripts ni archive', () => {
  it.each([
    ['--dry-run', '--ignore-scripts'],
    ['--dry-run', '--json', '--ignore-scripts'],
    ['--ignore-scripts', '--silent', '--dry-run'],
  ])('autorise les options explicites %j', (...args) => {
    expect(capabilityAllowsSegment(['npm', 'pack', ...args], tests)).toBe(true);
    expect(capabilityAllowsSegment(['npm', 'pack', ...args], new Set())).toBe(false);
    expect(capabilityAllowsSegment(['npm', 'pack', ...args], new Set(['npm-registry']))).toBe(false);
  });

  it.each([
    [], ['--dry-run'], ['--ignore-scripts'],
    ['--dry-run', '--ignore-scripts=false'],
    ['--dry-run', '--ignore-scripts', '--prefix=/outside'],
    ['--dry-run', '--ignore-scripts', '--userconfig=/outside'],
    ['--dry-run', '--ignore-scripts', 'remote-package'],
    ['--dry-run', '--ignore-scripts', '../outside'],
    ['--dry-run', '--ignore-scripts', '--pack-destination=/outside'],
  ])('refuse de changer la portée %j', (...args) => {
    expect(capabilityAllowsSegment(['npm', 'pack', ...args], tests)).toBe(false);
  });

  it.each([
    ['pack', '--dry-run', '--json'],
    ['pack', '--ignore-scripts', '--json'],
    ['pack', '--silent'],
    ['view', '--json'],
  ])('ne prend pas une option pour un paquet de registre %j', (...args) => {
    expect(capabilityAllowsSegment(['npm', ...args], new Set(['npm-registry']))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('exécute le vrai dry-run local sans archive ni script prepare', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-pack-dry-run-'));
    const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
    fs.mkdirSync(workspace); fs.mkdirSync(temporary);
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
      name: 'local-pack-fixture', version: '1.0.0', files: ['index.js'],
      scripts: { prepare: `node -e "require('fs').writeFileSync('prepare-ran','bad')"` },
    }));
    fs.writeFileSync(path.join(workspace, 'index.js'), 'export const fixture = true;\n');
    vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests');
    const broker = await startNpmRegistryBroker(workspace, temporary);
    try {
      const result = await new Promise<{ code: number | string | null; stdout: string; stderr: string }>(resolve => {
        execFile(process.execPath, [path.join(broker.directory, 'npm-client.mjs'),
          'pack', '--dry-run', '--json', '--ignore-scripts'],
        { cwd: workspace, encoding: 'utf8', env: { ...process.env, npm_config_cache: path.join(temporary, 'cache') } },
        (error, stdout, stderr) => resolve({ code: error?.code ?? null, stdout, stderr }));
      });
      expect(result.code, result.stderr).toBeNull();
      expect(JSON.parse(result.stdout)[0].files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'index.js' })]));
      expect(fs.existsSync(path.join(workspace, 'prepare-ran'))).toBe(false);
      expect(fs.readdirSync(workspace).some(name => name.endsWith('.tgz'))).toBe(false);
      expect(shellCapabilitySnapshot().operations).toContain('npm pack --dry-run --ignore-scripts [--json]');
    } finally {
      await broker.close(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
