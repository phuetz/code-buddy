import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { collectRuntimeStatus, getLastEffectiveCall, recordEffectiveCall } from '../../src/runtime/runtime-status.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'buddy-runtime-status-'));
  roots.push(root);
  mkdirSync(join(root, 'dist', 'runtime'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@phuetz/code-buddy', version: '8.1.0' }));
  const code = 'export const marker = 1;\n';
  writeFileSync(join(root, 'dist', 'runtime', 'runtime-status.js'), code);
  const digest = createHash('sha256').update('runtime/runtime-status.js').update('\0').update(code).update('\0').digest('hex');
  writeFileSync(join(root, 'codebuddy-runtime.json'), JSON.stringify({
    schemaVersion: 2,
    corePackage: { name: '@phuetz/code-buddy', version: '8.1.0', description: 'fixture' },
    sourceRevision: 'a'.repeat(40),
    sourceDirty: false,
    sourceRevisionOrigin: 'git',
    distDigest: { algorithm: 'sha256', scope: 'dist-tree-code-without-maps-v1', value: digest, fileCount: 1 },
    runtime: { kind: 'codebuddy-core', compiled: true, moduleFormat: 'esm', distPath: 'dist', entrypoint: 'dist/desktop/codebuddy-engine-adapter.js' },
  }));
  return root;
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('runtime status', () => {
  it('identifies only an attested compiled revision and exposes an altered dist as unknown', () => {
    const root = fixture();
    const codePath = join(root, 'dist', 'runtime', 'runtime-status.js');
    const trusted = collectRuntimeStatus({ root, codePath, env: {}, includeServices: false });
    expect(trusted.execution).toMatchObject({ version: '8.1.0', revision: 'a'.repeat(40), verified: true });
    writeFileSync(codePath, 'export const marker = 2;\n');
    const altered = collectRuntimeStatus({ root, codePath, env: {}, includeServices: false });
    expect(altered.execution.revision).toBeNull();
    expect(altered.execution.verified).toBe(false);
    expect(altered.alerts).toContain('compiled-code-unverified');
  });

  it('records only successful effective calls, without credentials or endpoint details', () => {
    const root = fixture();
    const profile = join(root, 'profile');
    recordEffectiveCall({ provider: 'openrouter', model: 'served-model' }, profile);
    const observed = getLastEffectiveCall(profile);
    expect(observed).toMatchObject({ provider: 'openrouter', model: 'served-model' });
    const raw = readFileSync(join(profile, 'runtime-last-call.json'), 'utf8');
    expect(raw).not.toContain('Bearer');
    expect(raw).not.toContain('apiKey');
  });

  it('reports opt-ins by allowlist and never emits env values', () => {
    const root = fixture();
    const status = collectRuntimeStatus({
      root, codePath: join(root, 'dist', 'runtime', 'runtime-status.js'),
      env: { CODEBUDDY_SENSORY: 'true', CODEBUDDY_FLEET_ROOMS: 'false', CODEBUDDY_PRIVATE_TOKEN: 'secret' },
      includeServices: false,
    });
    expect(status.environmentEnabled).toContain('CODEBUDDY_SENSORY');
    expect(status.environmentEnabled).not.toContain('CODEBUDDY_FLEET_ROOMS');
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  it('flags an attested release behind main and a dirty repository separately', () => {
    const root = fixture();
    const first = 'a'.repeat(40);
    const manifestPath = join(root, 'codebuddy-runtime.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.sourceRevision = first;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    let dirty = false;
    const runGit = (_cwd: string, args: string[]) => {
      if (args.join(' ') === 'rev-parse --show-toplevel') return root;
      if (args.join(' ') === 'rev-parse HEAD') return 'b'.repeat(40);
      if (args[0] === 'status') return dirty ? '?? new-file' : '';
      if (args[0] === 'show-ref') return '';
      if (args[0] === 'rev-list') return '1';
      if (args[0] === 'merge-base') return '';
      return null;
    };
    const options = { root, codePath: join(root, 'dist', 'runtime', 'runtime-status.js'), repositoryRoot: root, env: {}, includeServices: false, runGit };
    const status = collectRuntimeStatus(options);
    expect(status.execution.revision).toBe(first);
    expect(status.repository.mainAheadBy).toBe(1);
    expect(status.alerts).toContain('execution-behind-main');
    expect(status.alerts).toContain('execution-differs-from-repository');
    expect(status.repository.dirty).toBe(false);
    dirty = true;
    expect(collectRuntimeStatus(options).alerts).toContain('repository-dirty');
  });

  it('highlights an active service on another revision without inventing unknown versions', () => {
    const root = fixture();
    const status = collectRuntimeStatus({
      root, codePath: join(root, 'dist', 'runtime', 'runtime-status.js'),
      env: {}, repositoryRoot: root,
      runGit: (_cwd, args) => args.join(' ') === 'rev-parse --show-toplevel' ? root
        : args.join(' ') === 'rev-parse HEAD' ? 'b'.repeat(40) : null,
      observeServices: () => ({ servicesObservation: 'systemd-user', services: [
        { name: 'codebuddy.service', state: 'active', version: '8.0.0', revision: 'c'.repeat(40) },
        { name: 'lisa-telegram.service', state: 'active', version: null, revision: null },
      ] }),
    });
    expect(status.alerts).toContain('service-revision-mismatch:codebuddy.service');
    expect(status.services[1]).toMatchObject({ state: 'active', version: null, revision: null });
  });

  it('does not certify a dirty source checkout as the exact committed code', () => {
    const root = fixture();
    mkdirSync(join(root, 'src', 'runtime'), { recursive: true });
    const codePath = join(root, 'src', 'runtime', 'runtime-status.ts');
    writeFileSync(codePath, 'export const marker = 1;\n');
    const status = collectRuntimeStatus({ root, codePath, env: {}, includeServices: false,
      runGit: (_cwd, args) => args.join(' ') === 'rev-parse --show-toplevel' ? root
        : args.join(' ') === 'rev-parse HEAD' ? 'a'.repeat(40)
          : args[0] === 'status' ? ' M src/runtime/runtime-status.ts' : null,
    });
    expect(status.execution.revision).toBe('a'.repeat(40));
    expect(status.execution.verified).toBe(false);
    expect(status.alerts).toContain('repository-dirty');
  });
});
