import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'check-optional-deps.mjs');

/** Runs the guard (report mode, no install) against a fixture repository. */
function runGuard(
  root: string,
  extraArgs: string[] = [],
  extraEnv: Record<string, string> = {},
): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [GUARD, ...extraArgs], {
    env: { ...process.env, CHECK_OPTIONAL_DEPS_ROOT: root, ...extraEnv },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('check-optional-deps guard', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cb-optional-deps-'));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ optionalDependencies: { 'absent-pkg': '^1.0.0' } }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('ignores a package named only in comments', () => {
    writeFileSync(
      path.join(root, 'src', 'loader.ts'),
      [
        "// Use a non-literal specifier so tsc doesn't require 'absent-pkg' to be installed.",
        "/* import x from 'absent-pkg' */",
        "const specifier = 'absent-pkg';",
        'export const load = () => import(specifier);',
      ].join('\n'),
    );
    const { status, output } = runGuard(root);
    expect(output).toContain('0 optional packages imported from src/');
    expect(status).toBe(0);
  });

  it('still fails on a real import of a missing optional package', () => {
    writeFileSync(path.join(root, 'src', 'real.ts'), "import thing from 'absent-pkg';\nexport default thing;\n");
    const { status, output } = runGuard(root);
    expect(output).toContain('- absent-pkg');
    expect(status).toBe(1);
  });

  it('keeps an import that follows a URL on the same line', () => {
    writeFileSync(
      path.join(root, 'src', 'url.ts'),
      "const u = 'http://example.test'; import('absent-pkg');\nexport { u };\n",
    );
    const { status } = runGuard(root);
    expect(status).toBe(1);
  });

  // Same failure mode as Windows, where `npm` is an unlaunchable `npm.cmd`:
  // the reinstall cannot start. The guard must say why, not just "failed".
  it('reports why the reinstall could not start', () => {
    writeFileSync(path.join(root, 'src', 'real.ts'), "import thing from 'absent-pkg';\nexport default thing;\n");
    const emptyBin = mkdtempSync(path.join(tmpdir(), 'cb-no-npm-'));
    try {
      const { status, output } = runGuard(root, ['--install'], { PATH: emptyBin });
      expect(output).toMatch(/The reinstall command itself failed: .*ENOENT/);
      expect(status).toBe(1);
    } finally {
      rmSync(emptyBin, { recursive: true, force: true });
    }
  });
});
