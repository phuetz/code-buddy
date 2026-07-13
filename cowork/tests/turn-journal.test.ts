import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TurnJournal } from '../src/main/session/turn-journal';

const fsCallCounts = vi.hoisted(() => ({ open: 0, fsync: 0, close: 0 }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      fsCallCounts.open += 1;
      return actual.openSync(...args);
    },
    fsyncSync: (fd: number) => {
      fsCallCounts.fsync += 1;
      return actual.fsyncSync(fd);
    },
    closeSync: (fd: number) => {
      fsCallCounts.close += 1;
      return actual.closeSync(fd);
    },
  };
});

const tempDirs: string[] = [];
const journals: TurnJournal[] = [];

function makeJournal(): TurnJournal {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-turn-journal-'));
  tempDirs.push(dir);
  const journal = new TurnJournal(dir);
  journals.push(journal);
  return journal;
}

afterEach(() => {
  for (const journal of journals.splice(0)) journal.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  fsCallCounts.open = 0;
  fsCallCounts.fsync = 0;
  fsCallCounts.close = 0;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('TurnJournal', () => {
  it('reads append-only turn events into recent events and turn summaries', () => {
    const journal = makeJournal();
    journal.append('s1', 'turn_submitted', { messageId: 'm1' }, 'turn-1');
    journal.append('s1', 'turn_started', { promptPreview: 'inspect auth' }, 'turn-1');
    journal.append('s1', 'message_saved', { messageId: 'm1', role: 'user' }, 'turn-1');
    journal.append('s1', 'trace_step', { stepId: 'step-1' }, 'turn-1');
    journal.append('s1', 'turn_completed', {}, 'turn-1');

    const result = journal.read('s1');

    expect(result.exists).toBe(true);
    expect(result.totalEventCount).toBe(5);
    expect(result.malformedLineCount).toBe(0);
    expect(result.pendingTurnCount).toBe(0);
    expect(result.events.map((event) => event.type)).toEqual([
      'turn_submitted',
      'turn_started',
      'message_saved',
      'trace_step',
      'turn_completed',
    ]);
    expect(result.turns[0]).toMatchObject({
      turnId: 'turn-1',
      latestType: 'turn_completed',
      status: 'completed',
      eventCount: 5,
      messageCount: 1,
      traceStepCount: 1,
    });
  });

  it('tolerates malformed lines and unrelated session records', () => {
    const journal = makeJournal();
    journal.append('s1', 'turn_started', {}, 'turn-1');
    fs.appendFileSync(journal.pathFor('s1'), 'not-json\n', 'utf8');
    fs.appendFileSync(
      journal.pathFor('s1'),
      `${JSON.stringify({
        schemaVersion: 1,
        type: 'turn_started',
        sessionId: 'other',
        ts: Date.now(),
      })}\n`,
      'utf8'
    );

    const result = journal.read('s1');

    expect(result.totalEventCount).toBe(1);
    expect(result.malformedLineCount).toBe(2);
    expect(result.turns[0]?.status).toBe('running');
  });

  it('survives a truncated partial write at the end of the journal', () => {
    const journal = makeJournal();
    journal.append('s1', 'turn_started', { promptPreview: 'inspect' }, 'turn-1');
    fs.appendFileSync(
      journal.pathFor('s1'),
      '{"schemaVersion":1,"type":"message_saved","sessionId":"s1","ts":',
      'utf8'
    );

    const result = journal.read('s1');

    expect(result.totalEventCount).toBe(1);
    expect(result.malformedLineCount).toBe(1);
    expect(result.replay.runCount).toBe(1);
    expect(result.replay.runs[0]?.anchors).toHaveLength(1);
  });

  it('caps returned recent events without losing total counts', () => {
    const journal = makeJournal();
    journal.append('s1', 'turn_started', {}, 'turn-1');
    journal.append('s1', 'message_saved', { messageId: 'm1' }, 'turn-1');
    journal.append('s1', 'turn_failed', { error: 'boom' }, 'turn-1');

    const result = journal.read('s1', 2);

    expect(result.totalEventCount).toBe(3);
    expect(result.events.map((event) => event.type)).toEqual(['message_saved', 'turn_failed']);
    expect(result.pendingTurnCount).toBe(0);
    expect(result.turns[0]?.status).toBe('failed');
  });

  it('coalesces a streaming burst into one open and one delayed fsync', async () => {
    vi.useFakeTimers();
    const journal = makeJournal();

    for (let index = 0; index < 1_000; index += 1) {
      journal.append('streaming', 'trace_update', { index });
    }

    expect(fsCallCounts.open).toBe(1);
    expect(fsCallCounts.fsync).toBe(0);
    expect(journal.read('streaming').totalEventCount).toBe(1_000);

    await vi.advanceTimersByTimeAsync(100);
    expect(fsCallCounts.fsync).toBe(1);
    expect(fsCallCounts.close).toBe(1);
  });

  it('fsyncs and closes immediately at a turn boundary', async () => {
    vi.useFakeTimers();
    const journal = makeJournal();

    journal.append('s1', 'trace_step', { stepId: 'step-1' });
    journal.append('s1', 'turn_completed', {}, 'turn-1');

    expect(fsCallCounts.fsync).toBe(1);
    expect(fsCallCounts.close).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(fsCallCounts.fsync).toBe(1);
  });
});
