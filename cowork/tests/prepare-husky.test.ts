import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.join(process.cwd(), 'scripts/prepare-husky.cjs');

describe('cowork prepare husky', () => {
  it('skips with a clear message when cowork/ has no .git', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e16-husky-'));
    const nestedScripts = path.join(tmp, 'scripts');
    fs.mkdirSync(nestedScripts);
    const nestedScript = path.join(nestedScripts, 'prepare-husky.cjs');
    fs.copyFileSync(script, nestedScript);

    const result = spawnSync(process.execPath, [nestedScript], {
      encoding: 'utf8',
      cwd: tmp,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("husky: skipped (cowork/ is not a git root");
    expect(result.stderr || '').not.toContain(".git can't be found");
  });

  it('is the npm prepare script so install no longer invokes husky blindly', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts.prepare).toBe('node scripts/prepare-husky.cjs');
    expect(pkg.scripts.prepare).not.toBe('husky');
  });
});
