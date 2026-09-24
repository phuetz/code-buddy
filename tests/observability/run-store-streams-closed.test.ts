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

// pruneOldRuns() destroys the journal of the oldest run past MAX_RUNS (30) and
// removes its folder. It used to remove it after a fixed 20 ms, whatever the
// state of the close; Windows then refuses (ENOTEMPTY) and the error was
// swallowed, so the folder was never pruned. Closes are slowed down here so a
// removal that does not wait for the close is seen on every platform.
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

  it('removes a pruned run folder only once its journal is closed', async () => {
    const realClose = fs.close;
    let pendingCloses = 0;
    vi.spyOn(fs, 'close').mockImplementation(((fd: number, callback?: (err: NodeJS.ErrnoException | null) => void) => {
      pendingCloses += 1;
      setTimeout(() => {
        realClose(fd, (err) => {
          pendingCloses -= 1;
          callback?.(err);
        });
      }, 100);
    }) as typeof fs.close);
    const realRmSync = fs.rmSync;
    const removals: Array<{ target: string; pendingCloses: number }> = [];
    vi.spyOn(fs, 'rmSync').mockImplementation(((target: fs.PathLike, options?: fs.RmOptions) => {
      removals.push({ target: String(target), pendingCloses });
      realRmSync(target, options);
    }) as typeof fs.rmSync);

    store = new RunStore(path.join(dir, 'runs'));
    const runIds: string[] = [];
    for (let i = 0; i < 31; i += 1) {
      runIds.push(store.startRun(`run ${i}`));
      await store.flushRun(runIds[i]);
    }

    await vi.waitFor(() => expect(removals.length).toBe(1), { timeout: 2000 });
    const pruned = runIds.find((id) => removals[0].target === path.join(store!.getRunsDir(), id));
    expect(pruned).toBeDefined();
    expect(removals[0].pendingCloses).toBe(0);
    expect(fs.existsSync(removals[0].target)).toBe(false);
  });
});
