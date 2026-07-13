import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertWideResearchFilesDistinct,
  WideResearchFileSafetyError,
  writeWideResearchTextAtomic,
  writeWideResearchTextAtomicSync,
} from '../../src/agent/wide-research-files.js';

const tempDirs: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'wide-research-files-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Wide Research file safety', () => {
  it('detects planned paths that collide through a symlinked parent alias', async () => {
    const directory = await tempDirectory();
    const realParent = join(directory, 'real-parent');
    const aliasedParent = join(directory, 'aliased-parent');
    await mkdir(realParent);
    await symlink(realParent, aliasedParent);

    await expect(
      assertWideResearchFilesDistinct(
        join(realParent, 'research-output.json'),
        join(aliasedParent, 'research-output.json'),
      ),
    ).rejects.toThrow(/same file/);
  });

  it('detects existing paths that are hardlinks to the same inode', async () => {
    const directory = await tempDirectory();
    const checkpoint = join(directory, 'checkpoint.json');
    const report = join(directory, 'report.md');
    await writeFile(checkpoint, '{}\n', 'utf8');
    await link(checkpoint, report);

    await expect(assertWideResearchFilesDistinct(checkpoint, report)).rejects.toThrow(
      /hardlinks to the same inode/,
    );
  });

  it('atomically creates nested parents and replaces output with private permissions', async () => {
    const directory = await tempDirectory();
    const report = join(directory, 'nested', 'reports', 'wide-research.md');

    await expect(writeWideResearchTextAtomic(report, 'first report\n')).resolves.toBe(report);
    expect(await readFile(report, 'utf8')).toBe('first report\n');
    if (process.platform !== 'win32') {
      expect((await lstat(report)).mode & 0o777).toBe(0o600);
    }

    await expect(writeWideResearchTextAtomic(report, 'replacement report\n')).resolves.toBe(
      report,
    );
    expect(await readFile(report, 'utf8')).toBe('replacement report\n');
    expect(await readdir(join(directory, 'nested', 'reports'))).toEqual(['wide-research.md']);
    if (process.platform !== 'win32') {
      expect((await lstat(report)).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses symbolic-link targets without changing the linked file', async () => {
    const directory = await tempDirectory();
    const target = join(directory, 'real-report.md');
    const outputLink = join(directory, 'report-link.md');
    await writeFile(target, 'preserve me\n', 'utf8');
    await symlink(target, outputLink);

    await expect(writeWideResearchTextAtomic(outputLink, 'unsafe replacement\n')).rejects.toBeInstanceOf(
      WideResearchFileSafetyError,
    );
    expect(await readFile(target, 'utf8')).toBe('preserve me\n');
  });

  it('refuses output paths crossing a symbolic-link parent', async () => {
    const directory = await tempDirectory();
    const realParent = join(directory, 'real-parent');
    const aliasedParent = join(directory, 'aliased-parent');
    await mkdir(realParent);
    await symlink(realParent, aliasedParent);

    await expect(
      writeWideResearchTextAtomic(join(aliasedParent, 'report.md'), 'unsafe report\n'),
    ).rejects.toThrow(/symbolic-link parent/);
    expect(await readdir(realParent)).toEqual([]);
  });

  it('provides the same nested atomic replacement guarantees synchronously', async () => {
    const directory = await tempDirectory();
    const report = join(directory, 'hard-stop', 'report.md');

    expect(writeWideResearchTextAtomicSync(report, 'first hard-stop report\n')).toBe(report);
    expect(writeWideResearchTextAtomicSync(report, 'replacement hard-stop report\n')).toBe(report);
    expect(await readFile(report, 'utf8')).toBe('replacement hard-stop report\n');
    expect(await readdir(join(directory, 'hard-stop'))).toEqual(['report.md']);
    if (process.platform !== 'win32') {
      expect((await lstat(report)).mode & 0o777).toBe(0o600);
    }
  });
});
