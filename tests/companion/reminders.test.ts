import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  addReminder,
  listReminders,
  removeReminder,
  isDue,
  markFired,
  markDone,
  matchAck,
  openAck,
  pendingAcks,
  resetAcks,
  parseVoiceReminder,
  type Reminder,
} from '../../src/companion/reminders.js';

let dir: string;
let counter = 0;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-rem-${process.pid}-${counter++}`);
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'reminder-log.jsonl');
  process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS = '300000';
  resetAcks();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
  delete process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS;
});

describe('reminders — store', () => {
  it('adds, lists, removes', async () => {
    const r = await addReminder({ label: 'médicaments', time: '09:00' });
    expect(r.id).toMatch(/^r-/);
    expect((await listReminders())[0]?.label).toBe('médicaments');
    expect(await removeReminder(r.id)).toBe(true);
    expect(await listReminders()).toHaveLength(0);
  });

  it('rejects an invalid time', async () => {
    await expect(addReminder({ label: 'x', time: '25:00' })).rejects.toThrow();
  });
});

describe('reminders — isDue (once per occurrence)', () => {
  const base: Reminder = {
    id: 'r1',
    label: 'meds',
    time: '09:00',
    enabled: true,
    createdAt: '2026-06-26T00:00:00.000Z',
  };
  it('is due at/after the time, not before', () => {
    expect(isDue(base, new Date('2026-06-26T08:59:00'))).toBe(false);
    expect(isDue(base, new Date('2026-06-26T09:00:30'))).toBe(true);
  });
  it('respects day-of-week filter', () => {
    const friOnly = { ...base, days: [5] }; // 2026-06-26 is a Friday
    expect(isDue(friOnly, new Date('2026-06-26T09:01:00'))).toBe(true);
    expect(isDue(friOnly, new Date('2026-06-27T09:01:00'))).toBe(false); // Saturday
  });
  it('does not re-fire the same occurrence once fired', () => {
    const fired = { ...base, lastFiredAt: '2026-06-26T09:00:10' };
    expect(isDue(fired, new Date('2026-06-26T09:05:00'))).toBe(false);
    // …but the next day it's due again.
    expect(isDue(fired, new Date('2026-06-27T09:05:00'))).toBe(true);
  });
  it('disabled is never due', () => {
    expect(isDue({ ...base, enabled: false }, new Date('2026-06-26T09:05:00'))).toBe(false);
  });
});

describe('reminders — matchAck (the safety-critical bind)', () => {
  it('binds an explicit done-phrase ONLY when a reminder is pending in-window', () => {
    const now = 1_000_000;
    // No pending → even an explicit "c'est fait" binds nothing.
    expect(matchAck("c'est fait", now)).toBeNull();
    openAck({ id: 'r1', label: 'meds' }, now);
    expect(matchAck("c'est fait", now)).toBe('r1');
    expect(matchAck("j'ai pris mes médicaments", now)).toBe('r1');
  });

  it('does NOT bind ambient speech (no done-phrase)', () => {
    const now = 1_000_000;
    openAck({ id: 'r1', label: 'meds' }, now);
    expect(matchAck('il fait beau aujourd’hui', now)).toBeNull();
    expect(matchAck('on a pris le train ce matin', now)).toBeNull();
  });

  it('does not bind outside the ack window', () => {
    const now = 1_000_000;
    openAck({ id: 'r1', label: 'meds' }, now);
    expect(matchAck("c'est fait", now + 400_000)).toBeNull(); // window is 300000
  });

  it('multiple pending → binds the most-recently-fired', () => {
    openAck({ id: 'old', label: 'A' }, 1_000_000);
    openAck({ id: 'new', label: 'B' }, 1_000_500);
    expect(matchAck("c'est fait", 1_001_000)).toBe('new');
  });
});

describe('reminders — markDone / markFired', () => {
  it('markDone records lastDoneAt and clears the pending ack', async () => {
    const r = await addReminder({ label: 'meds', time: '09:00' });
    openAck({ id: r.id, label: r.label }, 1000);
    expect(pendingAcks(1000)).toHaveLength(1);
    const done = await markDone(r.id, 'cli');
    expect(done?.lastDoneAt).toBeTruthy();
    expect(pendingAcks(1000)).toHaveLength(0); // ack closed
  });
  it('markFired stamps lastFiredAt', async () => {
    const r = await addReminder({ label: 'meds', time: '09:00' });
    const fired = await markFired(r.id, new Date('2026-06-26T09:00:10'));
    expect(fired?.lastFiredAt).toBe(new Date('2026-06-26T09:00:10').toISOString());
  });
});

describe('reminders — parseVoiceReminder', () => {
  it('parses a spoken creation request', () => {
    expect(parseVoiceReminder('rappelle-moi mes médicaments à 9h')).toEqual({ label: 'médicaments', time: '09:00' });
    expect(parseVoiceReminder('rappelle moi de prendre mes médicaments à 21h30')).toMatchObject({ time: '21:30' });
    expect(parseVoiceReminder('rappelle-moi le rendez-vous à 14:15')).toEqual({ label: 'le rendez-vous', time: '14:15' });
  });
  it('returns null for non-creation speech or no time', () => {
    expect(parseVoiceReminder('il fait beau')).toBeNull();
    expect(parseVoiceReminder('rappelle-moi mes médicaments')).toBeNull(); // no time
  });
});
