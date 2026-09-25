/**
 * RunStore.endRun() and dispose() return before the journal file is released.
 * Tests that remove the runs directory right away hit ENOTEMPTY on Windows
 * (tool-handler-filter.test.ts, CI of PR #226, 2026-09-24). whenStreamsClosed()
 * is what they await first. The descriptor check reads /proc, so Linux only.
 * The dispose()-only path is not asserted here: destroy() closes the descriptor
 * in the thread pool before any JS runs, so no check could tell it apart.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunStore } from '../../src/observability/run-store.js';
import { makeTmpDir, removeTestDir } from '../helpers/tmp.js';

function openUnder(dir: string): string[] {
  const out: string[] = [];
  for (const fd of fs.readdirSync('/proc/self/fd')) {
    try {
      const target = fs.readlinkSync(`/proc/self/fd/${fd}`);
      if (target.startsWith(dir + path.sep)) out.push(path.relative(dir, target));
    } catch {
      // The descriptor closed while listing.
    }
  }
  return out;
}

describe.skipIf(process.platform !== 'linux')('RunStore.whenStreamsClosed', () => {
  let dir: string;
  const previousAuditDir = process.env.CODEBUDDY_AUDIT_DIR;

  beforeEach(() => {
    dir = makeTmpDir('run-store-closed-', os.tmpdir());
    process.env.CODEBUDDY_AUDIT_DIR = path.join(dir, 'audit');
  });

  afterEach(() => {
    if (previousAuditDir === undefined) delete process.env.CODEBUDDY_AUDIT_DIR;
    else process.env.CODEBUDDY_AUDIT_DIR = previousAuditDir;
    removeTestDir(dir);
  });

  it('releases the journal of an ended run', async () => {
    const store = new RunStore(path.join(dir, 'runs'));
    const runId = store.startRun('close after end');
    // The stream opens its file asynchronously: once flushed, it is open.
    await store.flushRun(runId);
    expect(openUnder(dir).some((file) => file.endsWith('events.jsonl'))).toBe(true);
    store.endRun(runId, 'completed');
    store.dispose();

    await store.whenStreamsClosed();

    expect(openUnder(dir)).toEqual([]);
    const journal = fs.readFileSync(path.join(store.getRunsDir(), runId, 'events.jsonl'), 'utf8');
    expect(journal).toContain('"type":"run_end"');
  });
});

// pruneOldRuns() removes the folder of the oldest run past MAX_RUNS (30). It
// used to remove it after a fixed 20 ms, whatever the state of its journal;
// Windows then refuses (ENOTEMPTY) and the error was swallowed, so the folder
// was never pruned. Closes are slowed down here and every descriptor opened by
// fs.open is followed until its close completes, so a removal that does not
// wait for the journal is seen on every platform.
describe('RunStore.pruneOldRuns', () => {
  let dir: string;
  let store: RunStore | undefined;
  const previousAuditDir = process.env.CODEBUDDY_AUDIT_DIR;

  beforeEach(() => {
    dir = makeTmpDir('run-store-prune-', os.tmpdir());
    process.env.CODEBUDDY_AUDIT_DIR = path.join(dir, 'audit');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    store?.dispose();
    await store?.whenStreamsClosed();
    store = undefined;
    if (previousAuditDir === undefined) delete process.env.CODEBUDDY_AUDIT_DIR;
    else process.env.CODEBUDDY_AUDIT_DIR = previousAuditDir;
    removeTestDir(dir);
  });

  /** Slows every fs.close and records, at each fs.rmSync, the files still open below its target. */
  function watchDescriptors(): Array<{ target: string; stillOpen: string[] }> {
    const open = new Map<number, string>();
    const realOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      const callback = rest.pop() as (err: NodeJS.ErrnoException | null, fd: number) => void;
      (realOpen as (...args: unknown[]) => void)(file, ...rest, (err: NodeJS.ErrnoException | null, fd: number) => {
        if (!err) open.set(fd, path.resolve(String(file)));
        callback(err, fd);
      });
    }) as typeof fs.open);
    const realClose = fs.close;
    vi.spyOn(fs, 'close').mockImplementation(((fd: number, callback?: (err: NodeJS.ErrnoException | null) => void) => {
      setTimeout(() => {
        realClose(fd, (err) => {
          open.delete(fd);
          callback?.(err);
        });
      }, 100);
    }) as typeof fs.close);
    const realRmSync = fs.rmSync;
    const removals: Array<{ target: string; stillOpen: string[] }> = [];
    vi.spyOn(fs, 'rmSync').mockImplementation(((target: fs.PathLike, options?: fs.RmOptions) => {
      const root = path.resolve(String(target)) + path.sep;
      removals.push({
        target: String(target),
        stillOpen: [...open.values()].filter((file) => file.startsWith(root)),
      });
      realRmSync(target, options);
    }) as typeof fs.rmSync);
    return removals;
  }

  it('removes a pruned run folder only once its journal is closed', async () => {
    const removals = watchDescriptors();

    store = new RunStore(path.join(dir, 'runs'));
    const runIds: string[] = [];
    for (let i = 0; i < 31; i += 1) {
      runIds.push(store.startRun(`run ${i}`));
      await store.flushRun(runIds[i]);
    }

    await vi.waitFor(() => expect(removals.length).toBe(1), { timeout: 10_000 });
    const pruned = runIds.find((id) => removals[0].target === path.join(store!.getRunsDir(), id));
    expect(pruned).toBeDefined();
    expect(removals[0].stillOpen).toEqual([]);
    expect(fs.existsSync(removals[0].target)).toBe(false);
  });

  // endRun() hands the journal to its close and forgets it at once; a run
  // started in the same turn then prunes that run while the file is still open.
  it('waits for the journal of an ended run that is still closing', async () => {
    const removals = watchDescriptors();

    store = new RunStore(path.join(dir, 'runs'));
    const oldest = store.startRun('oldest');
    await store.flushRun(oldest);
    // Strictly the oldest: the next runs start in a later millisecond.
    const startedAt = store.getRun(oldest)!.summary.startedAt;
    await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(startedAt), { timeout: 2000 });
    for (let i = 1; i < 30; i += 1) {
      await store.flushRun(store.startRun(`run ${i}`));
    }
    const oldestDir = path.join(store.getRunsDir(), oldest);

    store.endRun(oldest, 'completed');
    const newest = store.startRun('run 30');

    await vi.waitFor(() => expect(removals.length).toBe(1), { timeout: 10_000 });
    expect(newest).not.toBe(oldest);
    expect(removals[0].target).toBe(oldestDir);
    expect(removals[0].stillOpen).toEqual([]);
    expect(fs.existsSync(oldestDir)).toBe(false);
  });
});
