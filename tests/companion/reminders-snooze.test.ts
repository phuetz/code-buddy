/**
 * Assistant-mode P3: snooze a fired reminder — "rappelle-moi dans 10 minutes" / "plus tard" while a
 * reminder is pending re-announces it later instead of letting it re-nag then lapse to "missed".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { removeTmpDirAsync } from '../helpers/tmp.js';
import {
  parseSnooze,
  snoozePending,
  isSnoozeCommand,
  snoozeReminder,
  dueSnoozes,
  resetSnoozes,
  loadSnoozes,
  resetAcks,
  openAck,
  pendingAcks,
  addReminder,
  whenRemindersPersisted,
} from '../../src/companion/reminders.js';
import { runReminderTick } from '../../src/companion/reminder-runner.js';

let dir: string;
let counter = 0;
const flush = () => new Promise((r) => setTimeout(r, 40)); // let the fire-and-forget persist land
beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-snooze-${process.pid}-${counter++}`);
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'log.jsonl');
  process.env.CODEBUDDY_REMINDER_SNOOZE_FILE = path.join(dir, 'snoozes.json');
  process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS = '300000';
  resetAcks();
  resetSnoozes();
});
afterEach(async () => {
  // Let the fire-and-forget mirrors (acks/snoozes) land before removing their
  // directory — an in-flight write makes the rm ENOTEMPTY on Windows.
  await whenRemindersPersisted();
  await removeTmpDirAsync(dir);
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
  delete process.env.CODEBUDDY_REMINDER_SNOOZE_FILE;
  delete process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS;
});

describe('parseSnooze', () => {
  it('parses explicit and bare deferrals', () => {
    expect(parseSnooze('dans 10 minutes')).toBe(10 * 60_000);
    expect(parseSnooze('rappelle-moi dans 20 min')).toBe(20 * 60_000);
    expect(parseSnooze('dans 2 heures')).toBe(2 * 3600_000);
    expect(parseSnooze('plus tard')).toBe(10 * 60_000);
    expect(parseSnooze('repousse')).toBe(10 * 60_000);
  });
  it('returns null for non-snooze text', () => {
    expect(parseSnooze('bonjour Lisa')).toBeNull();
    expect(parseSnooze("c'est fait")).toBeNull();
    expect(parseSnooze('dans 50 heures')).toBeNull(); // out of range
  });
});

describe('snoozePending / isSnoozeCommand', () => {
  it('does nothing when no reminder is pending', async () => {
    expect(await snoozePending('dans 10 minutes', 1000)).toBeNull();
    expect(isSnoozeCommand('dans 10 minutes', 1000)).toBe(false);
  });
  it('defers the pending reminder, closing its ack and scheduling a re-announce', async () => {
    openAck({ id: 'r1', label: 'médicaments' }, 1000);
    expect(isSnoozeCommand('dans 15 minutes', 1000)).toBe(true);
    const res = await snoozePending('dans 15 minutes', 1000);
    expect(res).toMatchObject({ id: 'r1', label: 'médicaments', delayMs: 15 * 60_000 });
    expect(pendingAcks(1000)).toHaveLength(0); // ack closed → no re-nag/missed
    expect(dueSnoozes(1000 + 15 * 60_000)).toEqual([{ id: 'r1', label: 'médicaments' }]); // due later
  });

  it('does not announce a snooze when the durable write failed (D6)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await mkdir(process.env.CODEBUDDY_REMINDER_SNOOZE_FILE!);
    openAck({ id: 'r1', label: 'médicaments' }, 1000);

    const res = await snoozePending('dans 10 minutes', 1000);
    expect(res).toBeNull();
    expect(pendingAcks(1000)).toHaveLength(1);

    resetSnoozes();
    await expect(loadSnoozes()).rejects.toThrow();
    expect(dueSnoozes(1000 + 10 * 60_000)).toHaveLength(0);
  });
});

describe('snooze persistence — survive a restart mid-deferral (health safety)', () => {
  it('a snooze is reloaded from disk after the in-memory registry is lost', async () => {
    snoozeReminder('r1', 'médicaments', 5000);
    await flush(); // the async persist
    resetSnoozes(); // simulate the process dying (memory gone)
    expect(dueSnoozes(10_000)).toHaveLength(0); // nothing in memory

    await loadSnoozes(); // the new process restores from disk
    expect(dueSnoozes(4000)).toHaveLength(0); // not due yet
    expect(dueSnoozes(10_000)).toEqual([{ id: 'r1', label: 'médicaments' }]); // survived the restart
  });

  it('loadSnoozes never throws when the file is absent', async () => {
    await expect(loadSnoozes()).resolves.toBeUndefined();
  });

  it('does not treat a corrupt snooze store as empty (jumeau D2)', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(process.env.CODEBUDDY_REMINDER_SNOOZE_FILE!, '{this is not json', 'utf8');

    await expect(loadSnoozes()).rejects.toThrow();
    expect(dueSnoozes(10_000)).toHaveLength(0);
  });
});

describe('dueSnoozes', () => {
  it('does not consume due snoozes until they are delivered (jumeau D6)', () => {
    snoozeReminder('a', 'A', 1000);
    snoozeReminder('b', 'B', 5000);
    expect(dueSnoozes(2000)).toEqual([{ id: 'a', label: 'A' }]);
    expect(dueSnoozes(2000)).toEqual([{ id: 'a', label: 'A' }]);
    expect(dueSnoozes(6000)).toEqual([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
  });
});

describe('runReminderTick re-announces a due snooze', () => {
  it('re-speaks the reminder and reopens the ack when the deferral elapses', async () => {
    const r = await addReminder({ label: 'médicaments', time: '23:59' }); // not due at our epoch clock
    const spoken: string[] = [];
    const deps = { say: async (t: string) => void spoken.push(t), notify: async () => {} };
    snoozeReminder(r.id, r.label, 1000);

    await runReminderTick(new Date(500), deps); // before the deferral → nothing
    expect(spoken).toHaveLength(0);

    await runReminderTick(new Date(1500), deps); // after → re-announced
    expect(spoken.some((s) => /médicaments/i.test(s))).toBe(true);
    expect(pendingAcks(1500)).toHaveLength(1); // a fresh ack cycle opened
    expect(dueSnoozes(1500)).toHaveLength(0); // consumed only after the announcement
  });

  it('puts the snooze back when the re-announce fails (jumeau D6)', async () => {
    const r = await addReminder({ label: 'médicaments', time: '23:59' });
    snoozeReminder(r.id, r.label, 1000);
    const deps = {
      say: async () => {
        throw new Error('speaker down');
      },
      notify: async () => {},
    };

    await runReminderTick(new Date(1500), deps);

    expect(dueSnoozes(1500)).toEqual([{ id: r.id, label: r.label }]);
  });
});
