import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { requireRipgrepPath, resolveRipgrepPath } from '../../src/utils/ripgrep-path.js';

describe('ripgrep path resolution', () => {
  it('prefers the bundled platform binary when optional dependencies are present', () => {
    expect(resolveRipgrepPath({
      loadBundledPath: () => '/bundle/bin/rg',
      pathValue: '',
      isExecutable: () => true,
    })).toBe('/bundle/bin/rg');
  });

  it('ignores a bundled path whose binary is missing and executes the system fallback', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ripgrep-fallback-'));
    try {
      // A portable executable fixture tests PATH selection without requiring
      // ripgrep on the test host or using a personal HOME.
      const executable = path.join(directory, process.platform === 'win32' ? 'rg.EXE' : 'rg');
      fs.copyFileSync(process.execPath, executable);
      fs.chmodSync(executable, 0o755);
      const resolvedPath = resolveRipgrepPath({
        loadBundledPath: () => path.join(directory, 'missing-bundled-rg'),
        pathValue: directory,
      });
      expect(resolvedPath).toBe(executable);
      const result = spawnSync(requireRipgrepPath(resolvedPath), ['-e', 'process.stdout.write("fallback executed")'], {
        encoding: 'utf8',
        env: { HOME: directory, USERPROFILE: directory, SystemRoot: process.env.SystemRoot },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('fallback executed');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('falls back to an executable rg on PATH when the platform package is omitted', () => {
    const expected = path.join('/usr/bin', 'rg');

    expect(resolveRipgrepPath({
      loadBundledPath: () => {
        throw new Error('platform package omitted');
      },
      pathValue: ['/missing', '/usr/bin'].join(path.delimiter),
      platform: 'linux',
      isExecutable: (candidate) => candidate === expected,
    })).toBe(expected);
  });

  it('reports no path when neither bundled nor system ripgrep exists', () => {
    const resolvedPath = resolveRipgrepPath({
      loadBundledPath: () => {
        throw new Error('platform package omitted');
      },
      pathValue: '/missing',
      platform: 'linux',
      isExecutable: () => false,
    });

    expect(resolvedPath).toBeNull();
    expect(() => requireRipgrepPath(resolvedPath)).toThrow(
      'Search is unavailable because ripgrep is not installed. Reinstall Code Buddy without `--omit=optional` or install `rg` on PATH.',
    );
  });
});
