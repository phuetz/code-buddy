import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findFileByName } from '../src/main/ipc/shell-file-discovery';

describe('findFileByName', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cowork-file-discovery-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds a nested file asynchronously', async () => {
    const nested = join(root, 'src', 'generated');
    mkdirSync(nested, { recursive: true });
    const target = join(nested, 'result.png');
    writeFileSync(target, 'image');

    await expect(findFileByName('result.png', [root])).resolves.toBe(target);
  });

  it.each(['node_modules', '.git', '.cache'])('does not descend into %s', async (name) => {
    const excluded = join(root, name, 'nested');
    mkdirSync(excluded, { recursive: true });
    writeFileSync(join(excluded, 'hidden.png'), 'image');

    await expect(findFileByName('hidden.png', [root])).resolves.toBeNull();
  });

  it('ignores empty roots instead of resolving them to the process cwd', async () => {
    await expect(findFileByName('package.json', ['', '   '])).resolves.toBeNull();
  });

  it('honors the directory and time budgets', async () => {
    const nested = join(root, 'nested');
    mkdirSync(nested);
    writeFileSync(join(nested, 'late.png'), 'image');

    await expect(
      findFileByName('late.png', [root], { maxDirectories: 1 })
    ).resolves.toBeNull();

    let tick = 0;
    await expect(
      findFileByName('late.png', [root], {
        timeoutMs: 500,
        now: () => (tick++ === 0 ? 0 : 500),
      })
    ).resolves.toBeNull();
  });
});
