import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { copyBundledAssets } from '../../scripts/copy-bundled-skills.mjs';
import { writeRuntimeManifest, verifyRuntimeManifest } from '../../scripts/write-runtime-manifest.mjs';

const root = resolve(import.meta.dirname, '../..');

describe('models snapshot packaging', () => {
  it('copies the snapshot for a fresh package build without requiring a prebuilt dist', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'codebuddy-snapshot-copy-'));
    try {
      mkdirSync(join(fixture, 'src/skills/bundled'), { recursive: true });
      mkdirSync(join(fixture, 'src/config'), { recursive: true });
      writeFileSync(join(fixture, 'src/skills/bundled/example.skill.md'), '# example\n');
      const source = readFileSync(join(root, 'src/config/models-snapshot.json'));
      writeFileSync(join(fixture, 'src/config/models-snapshot.json'), source);
      copyBundledAssets(fixture);
      expect(readFileSync(join(fixture, 'dist/config/models-snapshot.json'))).toEqual(source);
      expect(readFileSync(join(fixture, 'dist/skills/bundled/example.skill.md'), 'utf8')).toBe('# example\n');
      const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        files: string[];
        scripts: { build: string };
      };
      expect(packageJson.scripts.build).toContain('node scripts/copy-bundled-skills.mjs');
      expect(packageJson.files).toContain('dist');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails the build copy when the source snapshot is missing', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'codebuddy-snapshot-missing-'));
    try {
      mkdirSync(join(fixture, 'src/skills/bundled'), { recursive: true });
      expect(() => copyBundledAssets(fixture)).toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
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
