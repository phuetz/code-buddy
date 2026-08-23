import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface ExtraResource {
  from?: string;
  to?: string;
}

interface BuilderConfig {
  files?: string[];
  win?: { extraResources?: ExtraResource[] };
  mac?: { extraResources?: ExtraResource[] };
  linux?: { extraResources?: ExtraResource[] };
}

const coworkRoot = path.resolve(process.cwd());

describe('Code Buddy core runtime packaging', () => {
  const config = parse(
    fs.readFileSync(path.join(coworkRoot, 'electron-builder.yml'), 'utf8'),
  ) as BuilderConfig;

  it.each(['win', 'mac', 'linux'] as const)(
    'ships staged dist and its sibling node_modules on %s',
    (platform) => {
      const resources = config[platform]?.extraResources ?? [];
      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: '.bundle-resources/core-runtime/dist',
            to: 'dist',
          }),
          expect.objectContaining({
            from: '.bundle-resources/core-runtime/node_modules',
            to: 'node_modules',
          }),
        ]),
      );
    },
  );

  it('does not copy the parent dist into app.asar as an unresolved duplicate', () => {
    expect(config.files).not.toContain('../dist/**/*');
  });

  it('prepares the core runtime before the fatal packaging checks run', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(coworkRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const build = packageJson.scripts?.build ?? '';
    expect(packageJson.scripts?.['prepare:core-runtime']).toBe(
      'node scripts/prepare-core-runtime.js',
    );
    expect(build.indexOf('npm run rebuild')).toBeGreaterThan(-1);
    expect(build.indexOf('npm run rebuild')).toBeLessThan(
      build.indexOf('npm run prepare:core-runtime'),
    );
    expect(build.indexOf('npm run prepare:core-runtime')).toBeGreaterThan(-1);
    expect(build.indexOf('npm run prepare:core-runtime')).toBeLessThan(
      build.indexOf('node scripts/pre-build-check.js'),
    );
  });

  it('also stages and checks the runtime in the root build:all --pack path', () => {
    const buildAll = fs.readFileSync(
      path.join(coworkRoot, '..', 'scripts', 'build-all.js'),
      'utf8',
    );
    const rebuild = buildAll.indexOf("['run', 'rebuild']");
    const prepare = buildAll.indexOf("['scripts/prepare-core-runtime.js']");
    const precheck = buildAll.indexOf("['scripts/pre-build-check.js']");
    const builder = buildAll.indexOf("['electron-builder', '--config'");
    expect(rebuild).toBeGreaterThan(-1);
    expect(rebuild).toBeLessThan(prepare);
    expect(prepare).toBeGreaterThan(-1);
    expect(precheck).toBeGreaterThan(prepare);
    expect(builder).toBeGreaterThan(precheck);
  });
});
