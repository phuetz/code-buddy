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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
