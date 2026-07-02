/**
 * Assistant-mode P2: the reminder confirmation reads back its CADENCE ("demain" / "tous les jours")
 * so a mis-captured recurrence is audible (the train-bug class of confusion), and addReminder
 * de-duplicates so saying the same thing twice doesn't stack identical reminders.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import { addReminder, listReminders, reminderCadencePhrase, describeRemindersForSpeech, type Reminder } from '../../src/companion/reminders.js';

let dir: string;
let counter = 0;
beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-remp2-${process.pid}-${counter++}`);
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'log.jsonl');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
});

function rem(over: Partial<Reminder> = {}): Reminder {
  return { id: 'x', label: 'train', time: '10:38', enabled: true, createdAt: '2026-07-02T00:00:00Z', ...over };
}

describe('reminderCadencePhrase', () => {
  const now = new Date(2026, 6, 2, 12, 0, 0); // 2 Jul 2026
  it('speaks a one-shot date relatively (demain / aujourd’hui) or absolute', () => {
    expect(reminderCadencePhrase(rem({ date: '2026-07-03' }), now)).toBe('demain');
    expect(reminderCadencePhrase(rem({ date: '2026-07-02' }), now)).toBe("aujourd'hui");
    expect(reminderCadencePhrase(rem({ date: '2026-07-20' }), now)).toBe('le 2026-07-20');
  });
  it('speaks a recurring cadence', () => {
    expect(reminderCadencePhrase(rem({}), now)).toBe('tous les jours');
    expect(reminderCadencePhrase(rem({ days: [1, 3] }), now)).toBe('chaque lundi, mercredi');
  });
});

describe('describeRemindersForSpeech reads back the cadence', () => {
  it('includes the one-shot date and the recurring cadence', () => {
    // A far date is deterministic regardless of when the suite runs.
    const summary = describeRemindersForSpeech([rem({ date: '2026-12-25', label: 'noël' }), rem({ label: 'médicaments', time: '09:00' })]);
    expect(summary).toContain('le 2026-12-25');
    expect(summary).toContain('tous les jours');
  });
});

describe('addReminder de-duplicates', () => {
  it('the same label+time+cadence twice keeps ONE reminder', async () => {
    const a = await addReminder({ label: 'train', time: '10:38', date: '2026-07-03' });
    const b = await addReminder({ label: 'Train', time: '10:38', date: '2026-07-03' }); // same (case-insensitive)
    expect(b.id).toBe(a.id); // returned the existing one
    expect(await listReminders()).toHaveLength(1);
  });

  it('distinct reminders are both kept', async () => {
    await addReminder({ label: 'train', time: '10:38' });
    await addReminder({ label: 'médicaments', time: '09:00' });
    await addReminder({ label: 'train', time: '11:00' }); // same label, different time → kept
    expect(await listReminders()).toHaveLength(3);
  });
});
