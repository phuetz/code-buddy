import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOperationalSelfModel } from '../../src/identity/operational-self-model.js';

const roots: string[] = [];
const script = fileURLToPath(new URL('../../scripts/write-runtime-manifest.mjs', import.meta.url));

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('npm runtime self-attestation', () => {
  it('generates a v2 manifest that makes a dist-only npm layout introspectable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-npm-runtime-'));
    roots.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: '@phuetz/code-buddy',
        version: '4.5.6',
        description: 'dist-only npm fixture',
      }),
    );
    fs.mkdirSync(path.join(root, 'dist', 'desktop'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist', 'identity'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export const embedded = true;\n',
    );
    fs.writeFileSync(
      path.join(root, 'dist', 'identity', 'operational-self-model.js'),
      'export function buildOperationalSelfModel() { return {}; }\n',
    );

    execFileSync(process.execPath, [script, '--root', root], {
      env: {
        ...process.env,
        CODEBUDDY_SOURCE_REVISION: '',
        GITHUB_SHA: '',
        CI_COMMIT_SHA: '',
        VERCEL_GIT_COMMIT_SHA: '',
        SOURCE_VERSION: '',
      },
      stdio: 'pipe',
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'codebuddy-runtime.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      corePackage: {
        name: '@phuetz/code-buddy',
        version: '4.5.6',
        description: 'dist-only npm fixture',
      },
      runtime: {
        kind: 'codebuddy-core',
        compiled: true,
        moduleFormat: 'esm',
        distPath: 'dist',
        entrypoint: 'dist/desktop/codebuddy-engine-adapter.js',
      },
      sourceDirty: null,
      distDigest: {
        algorithm: 'sha256',
        scope: 'dist-tree-code-without-maps-v1',
        fileCount: 2,
      },
    });

    const model = buildOperationalSelfModel({
      root,
      depth: 'deep',
      featureAreas: [
        {
          id: 'operational-self-model',
          name: 'Operational self-model',
          description: 'identity introspection architecture',
          paths: ['src/identity/operational-self-model.ts'],
        },
      ],
    });
    expect(model.repository.layout).toBe('packaged-runtime');
    expect(model.identity.version).toBe('4.5.6');
    expect(model.areas[0]!.evidence[0]).toMatchObject({
      artifact: 'compiled',
      observedPath: 'dist/identity/operational-self-model.js',
      excerpt: ['export function buildOperationalSelfModel()'],
    });
  });

  it('records a dirty Git tree and never rewrites build provenance during verification', async () => {
    const { resolveSourceRevision } = await import('../../scripts/write-runtime-manifest.mjs');
    const revision = 'a'.repeat(40);
    const run = vi.fn((_command: string, args: string[]) =>
      args[0] === 'rev-parse'
        ? { status: 0, stdout: `${revision}\n` }
        : { status: 0, stdout: ' M src/identity/operational-self-model.ts\n' },
    );
    expect(resolveSourceRevision('/checkout', {}, run as never)).toEqual({
      revision,
      origin: 'git',
      dirty: true,
    });
    expect(run).toHaveBeenNthCalledWith(
      2,
      'git',
      [
        'status',
        '--porcelain=v1',
        '--untracked-files=normal',
        '--',
        '.',
        ':(exclude).codebuddy/**',
      ],
      expect.objectContaining({ cwd: '/checkout' }),
    );

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-provenance-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: '@phuetz/code-buddy',
      version: '1.2.3',
      description: 'provenance fixture',
    }));
    fs.mkdirSync(path.join(root, 'dist', 'desktop'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export const revisionA = true;\n',
    );
    execFileSync(process.execPath, [script, '--root', root], {
      env: { ...process.env, CODEBUDDY_SOURCE_REVISION: revision },
      stdio: 'pipe',
    });
    execFileSync(process.execPath, [script, '--verify', '--root', root], {
      env: { ...process.env, CODEBUDDY_SOURCE_REVISION: 'b'.repeat(40) },
      stdio: 'pipe',
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'codebuddy-runtime.json'), 'utf8'),
    );
    expect(manifest.sourceRevision).toBe(revision);

    fs.writeFileSync(
      path.join(root, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export const staleOrReplaced = true;\n',
    );
    expect(() => execFileSync(process.execPath, [script, '--verify', '--root', root], {
      stdio: 'pipe',
    })).toThrow(/does not match its build-time distDigest/);
  });

  it('rejects a root dist symlink instead of attesting files outside the package', () => {
    if (process.platform === 'win32') return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-symlinked-dist-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-outside-dist-'));
    roots.push(root, outside);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: '@phuetz/code-buddy',
      version: '1.2.3',
      description: 'symlink fixture',
    }));
    fs.mkdirSync(path.join(outside, 'desktop'), { recursive: true });
    fs.writeFileSync(
      path.join(outside, 'desktop', 'codebuddy-engine-adapter.js'),
      'export const outside = true;\n',
    );
    fs.symlinkSync(outside, path.join(root, 'dist'), 'dir');

    expect(() => execFileSync(process.execPath, [script, '--root', root], {
      stdio: 'pipe',
    })).toThrow(/runtime directory must not be a symlink/);
    expect(fs.existsSync(path.join(root, 'codebuddy-runtime.json'))).toBe(false);
  });

  it('rejects a manifest whose package identity no longer matches package.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-package-identity-'));
    roots.push(root);
    const packagePath = path.join(root, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({
      name: '@phuetz/code-buddy',
      version: '1.2.3',
      description: 'identity fixture',
    }));
    fs.mkdirSync(path.join(root, 'dist', 'desktop'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export const identity = true;\n',
    );
    execFileSync(process.execPath, [script, '--root', root], { stdio: 'pipe' });
    fs.writeFileSync(packagePath, JSON.stringify({
      name: '@phuetz/code-buddy',
      version: '9.9.9',
      description: 'identity fixture',
    }));

    expect(() => execFileSync(process.execPath, [script, '--verify', '--root', root], {
      stdio: 'pipe',
    })).toThrow(/corePackage.version does not match package.json/);
  });

  it('rejects a lookalike scoped package before generating an attestation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-lookalike-package-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: '@evil/code-buddy',
      version: '1.2.3',
      description: 'lookalike package fixture',
    }));
    fs.mkdirSync(path.join(root, 'dist', 'desktop'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export const lookalike = true;\n',
    );

    expect(() => execFileSync(process.execPath, [script, '--root', root], {
      stdio: 'pipe',
    })).toThrow(/Unexpected Code Buddy package name/);
    expect(fs.existsSync(path.join(root, 'codebuddy-runtime.json'))).toBe(false);
  });

  it('rejects an oversized sparse runtime file before reading it into memory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-oversized-runtime-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: '@phuetz/code-buddy',
      version: '1.2.3',
      description: 'oversized runtime fixture',
    }));
    fs.mkdirSync(path.join(root, 'dist', 'desktop'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export const entrypoint = true;\n',
    );
    const oversizedPath = path.join(root, 'dist', 'oversized.js');
    fs.writeFileSync(oversizedPath, '');
    fs.truncateSync(oversizedPath, 512 * 1024 * 1024 + 1);

    expect(() => execFileSync(process.execPath, [script, '--root', root], {
      stdio: 'pipe',
    })).toThrow(/attestation byte limit/);
  });

  it('includes the generated manifest in the npm file allowlist', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf8'),
    ) as { files?: string[] };
    expect(packageJson.files).toContain('codebuddy-runtime.json');
  });
});
