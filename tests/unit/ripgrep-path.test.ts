import path from 'node:path';
import { requireRipgrepPath, resolveRipgrepPath } from '../../src/utils/ripgrep-path.js';

describe('ripgrep path resolution', () => {
  it('prefers the bundled platform binary when optional dependencies are present', () => {
    expect(resolveRipgrepPath({
      loadBundledPath: () => '/bundle/bin/rg',
      pathValue: '',
      isExecutable: () => false,
    })).toBe('/bundle/bin/rg');
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
