import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import {
  type AtomicWriteFileSystem,
  cleanupOrphanedTemporaries,
  readJsonAtomic,
  readJsonAtomicSync,
  readJsonLinesAtomic,
  resetAtomicCleanupWarningsForTests,
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

  it('recovers a valid synchronous backup when the main file is absent', async () => {
    const target = join(tempDir, 'missing-main.json');
    await writeFile(`${target}.bak`, '{"version":9}\n', 'utf8');

    expect(readJsonAtomicSync(target, { version: 0 })).toEqual({ version: 9 });
    await expect(readFile(target, 'utf8')).resolves.toContain('"version": 9');
  });
});

// ============================================================================
// IDLINKS1: orphaned `.tmp.*` cleanup
//
// `writeFileAtomic`'s own try/catch already unlinks its temporary on any JS
// exception (open/write/sync/rename all funnel through one catch). A real
// orphan can therefore only happen when the WHOLE PROCESS is killed between
// `open` and `rename` (e.g. SIGTERM at a service restart) — no catch ever
// runs. That's reproduced for real below with a killed child process, not a
// mocked rejection (a mocked `rename` rejection is already covered by the
// "keeps the previous content" test above and does NOT leave an orphan).
// ============================================================================

describe('cleanupOrphanedTemporaries', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(process.cwd(), '.mem1-atomic-orphans-'));
    resetAtomicCleanupWarningsForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reproduces real orphaned temporaries from a writer killed between open and rename, then removes only them', async () => {
    const target = join(tempDir, 'state.json');
    await writeFile(target, '{"version":1}\n', 'utf8');

    // A child process that fires N concurrent writeFileAtomic() calls at the
    // same target, each artificially held open past the point where the
    // parent will SIGKILL it — guaranteeing every temp file is created
    // (open() truncates/creates immediately) but no rename ever runs.
    const atomicWriteSrc = fileURLToPath(new URL('../../src/utils/atomic-write.ts', import.meta.url));
    const scriptPath = join(tempDir, 'write-and-die.mts');
    await writeFile(scriptPath, `
import { writeFileAtomic } from ${JSON.stringify(atomicWriteSrc)};
import { promises as fsPromises } from 'node:fs';

const [, , target, nStr, delayStr] = process.argv;
const n = Number(nStr);
const delayMs = Number(delayStr);

const fileSystem = {
  mkdir: (d, o) => fsPromises.mkdir(d, o).then(() => undefined),
  open: async (filePath, flags, mode) => {
    const handle = await fsPromises.open(filePath, flags, mode);
    // Widen the open -> rename window well past the parent's SIGKILL delay.
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      writeFile: (data, opts) => handle.writeFile(data, opts),
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  rename: (a, b) => fsPromises.rename(a, b),
  unlink: (p) => fsPromises.unlink(p),
  chmod: (p, m) => fsPromises.chmod(p, m),
  readdir: (d) => fsPromises.readdir(d, { encoding: 'utf8' }),
  stat: async (p) => {
    const s = await fsPromises.stat(p);
    return { mtimeMs: s.mtimeMs };
  },
};

for (let i = 0; i < n; i++) {
  writeFileAtomic(target, JSON.stringify({ n: i }) + '\\n', { fileSystem }).catch(() => {});
}

// Stay alive; the parent SIGKILLs us before any rename completes.
setInterval(() => {}, 1000);
`, 'utf8');

    const tsxBin = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const child = spawn(tsxBin, [scriptPath, target, '6', '2000'], { stdio: 'ignore' });

    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    const beforeEntries = await fsPromises.readdir(tempDir);
    const orphansBefore = beforeEntries.filter(e => e.startsWith('state.json.tmp.'));
    expect(orphansBefore.length).toBeGreaterThan(0);
    // The rename step never ran: content and mtime of the real target are untouched.
    await expect(readFile(target, 'utf8')).resolves.toBe('{"version":1}\n');

    const removed = await cleanupOrphanedTemporaries(target, { maxAgeMs: 0 });
    expect(removed.length).toBe(orphansBefore.length);

    const afterEntries = await fsPromises.readdir(tempDir);
    expect(afterEntries.filter(e => e.startsWith('state.json.tmp.'))).toHaveLength(0);
    // Never touches the target itself.
    expect(afterEntries).toContain('state.json');
    await expect(readFile(target, 'utf8')).resolves.toBe('{"version":1}\n');
  }, 20000);

  it('never removes a temporary younger than maxAgeMs (an in-flight write)', async () => {
    const target = join(tempDir, 'state.json');
    await writeFile(target, '{"version":1}\n', 'utf8');
    const fresh = `${target}.tmp.12345.abcdef`;
    await writeFile(fresh, '{"version":2}\n', 'utf8');

    const removed = await cleanupOrphanedTemporaries(target, { maxAgeMs: 60_000 });

    expect(removed).toHaveLength(0);
    await expect(fsPromises.stat(fresh)).resolves.toBeDefined();
  });

  it('never removes the target file itself even if it were misnamed like a temporary', async () => {
    const target = join(tempDir, 'weird.json.tmp.json');
    await writeFile(target, '{}', 'utf8');

    const removed = await cleanupOrphanedTemporaries(target, { maxAgeMs: 0 });

    expect(removed).toHaveLength(0);
    await expect(fsPromises.stat(target)).resolves.toBeDefined();
  });

  it('logs the cleanup once per path', async () => {
    const target = join(tempDir, 'state.json');
    await writeFile(target, '{}', 'utf8');
    await writeFile(`${target}.tmp.1.aa`, '{}', 'utf8');
    const warn = vi.spyOn(logger, 'warn');

    await cleanupOrphanedTemporaries(target, { maxAgeMs: 0 });
    await writeFile(`${target}.tmp.2.bb`, '{}', 'utf8');
    await cleanupOrphanedTemporaries(target, { maxAgeMs: 0 });

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
