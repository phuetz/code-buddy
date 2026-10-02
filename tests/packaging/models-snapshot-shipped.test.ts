import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
import { writeRuntimeManifest, verifyRuntimeManifest } from '../../scripts/write-runtime-manifest.mjs';

describe('models snapshot packaging', () => {
  it('ships the same model snapshot in dist as in src', () => {
    const source = join(root, 'src/config/models-snapshot.json');
    const shipped = join(root, 'dist/config/models-snapshot.json');
    expect(existsSync(shipped)).toBe(true);
    expect(readFileSync(shipped)).toEqual(readFileSync(source));
  });

  it('rejects an attested package when its snapshot is absent', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'codebuddy-snapshot-'));
    try {
      mkdirSync(join(fixture, 'dist/desktop'), { recursive: true });
      mkdirSync(join(fixture, 'dist/config'), { recursive: true });
      writeFileSync(join(fixture, 'dist/desktop/codebuddy-engine-adapter.js'), 'export {};');
      writeFileSync(join(fixture, 'package.json'), JSON.stringify({
        name: '@phuetz/code-buddy', version: '1.0.0', description: 'Fixture',
      }));
      writeFileSync(join(fixture, 'dist/config/models-snapshot.json'), '{}');
      writeRuntimeManifest(fixture);
      rmSync(join(fixture, 'dist/config/models-snapshot.json'));
      expect(() => verifyRuntimeManifest(fixture)).toThrow('models-snapshot.json');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
