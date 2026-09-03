import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import {
  type AtomicWriteFileSystem,
  readJsonAtomic,
  readJsonLinesAtomic,
  resetAtomicReadWarningsForTests,
  writeFileAtomic,
} from '../../src/utils/atomic-write.js';

describe('atomic state writes', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(process.cwd(), '.mem1-atomic-'));
    resetAtomicReadWarningsForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('keeps the previous content when the temporary write is interrupted', async () => {
    const target = join(tempDir, 'state.json');
    await writeFile(target, '{"version":1}\n', 'utf8');

    const realFs = fsPromises;
    const fileSystem: AtomicWriteFileSystem = {
      mkdir: (directory, options) => realFs.mkdir(directory, options).then(() => undefined),
      open: async (filePath, flags, mode) => {
        const handle = await realFs.open(filePath, flags, mode);
        return {
          writeFile: async () => {
            throw new Error('simulated power loss after open');
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
      rename: (from, to) => realFs.rename(from, to),
      unlink: filePath => realFs.unlink(filePath),
      chmod: (filePath, mode) => realFs.chmod(filePath, mode),
      readdir: directory => realFs.readdir(directory, { encoding: 'utf8' }),
      stat: filePath => realFs.stat(filePath),
    };

    await expect(writeFileAtomic(target, '{"version":2}\n', { fileSystem })).rejects.toThrow('simulated power loss');
    await expect(readFile(target, 'utf8')).resolves.toBe('{"version":1}\n');
  });

  it('treats an empty file as absent and warns only once', async () => {
    const target = join(tempDir, 'summaries.json');
    await writeFile(target, '', 'utf8');
    const warn = vi.spyOn(logger, 'warn');

    await expect(readJsonAtomic(target, { summaries: [] })).resolves.toEqual({ summaries: [] });
    await expect(readJsonAtomic(target, { summaries: [] })).resolves.toEqual({ summaries: [] });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(target);
  });

  it.each([
    ['backup', '.bak'],
    ['temporary', '.tmp.12345'],
  ])('restores a valid %s after a truncated main file', async (_label, suffix) => {
    const target = join(tempDir, `recover-${_label}.json`);
    await writeFile(target, '{"version":', 'utf8');
    await writeFile(`${target}${suffix}`, '{"version":7}\n', 'utf8');

    await expect(readJsonAtomic(target, { version: 0 })).resolves.toEqual({ version: 7 });
    await expect(readFile(target, 'utf8')).resolves.toContain('"version": 7');
  });

  it('recovers a valid JSONL backup after a torn final record', async () => {
    const target = join(tempDir, 'timeline.jsonl');
    await writeFile(target, '{"id":1}\n{"id":', 'utf8');
    await writeFile(`${target}.bak`, '{"id":1}\n{"id":2}\n', 'utf8');

    await expect(readJsonLinesAtomic<{ id: number }>(target, [], (value): value is { id: number } => (
      typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number'
    ))).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    await expect(readFile(target, 'utf8')).resolves.toContain('"id":2');
  });
});
