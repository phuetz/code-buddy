import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: {
    prepack?: string;
  };
}

describe('npm package lifecycle', () => {
  it('builds before prepack so a fresh checkout has a runtime manifest', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as PackageJson;
    const prepack = packageJson.scripts?.prepack ?? '';

    expect(prepack).toContain('npm run build');
    expect(prepack).toContain('scripts/strip-sourcemaps.mjs');
    expect(prepack).toContain('scripts/write-runtime-manifest.mjs');
    expect(prepack.indexOf('npm run build')).toBeLessThan(
      prepack.indexOf('scripts/write-runtime-manifest.mjs'),
    );
    expect(prepack).not.toContain('write-runtime-manifest.mjs --verify');
  });
});
