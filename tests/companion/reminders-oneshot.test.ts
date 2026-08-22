/**
 * P0 of the assistant-mode fixes: ONE-SHOT / dated reminders — the root-cause fix for the "train"
 * bug where a one-time event ("j'ai un train demain") became a reminder that fired EVERY day.
 *
 * Proves, through the real store (env-isolated temp files, no mocks): a dated reminder is due only
 * on its date and never again; a recurring reminder is unchanged (non-regression, the meds case);
 * "c'est fait" retires a one-shot but only acks-today a recurring; the FR relative-date parser; and
 * the runner auto-retiring a one-shot after it fires.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { whenRemindersPersisted } from '../../src/companion/reminders.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  addReminder,
  listReminders,
  isDue,
  markDone,
  isOneShot,
  isValidDate,
  parseVoiceReminder,
  parseRelativeFrenchDate,
  resetAcks,
} from '../../src/companion/reminders.js';
import { runReminderTick } from '../../src/companion/reminder-runner.js';

let dir: string;
let counter = 0;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-rem1s-${process.pid}-${counter++}`);
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'reminder-log.jsonl');
  process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS = '300000';
  resetAcks();
});
afterEach(async () => {
  // Let the fire-and-forget reminder mirrors land before removing their dir (ENOTEMPTY on Windows).
  await whenRemindersPersisted();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
  delete process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS;
});

/** Local YYYY-MM-DD (matches the module's internal key). */
function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('isValidDate', () => {
  it('accepts real dates, rejects junk and impossible dates', () => {
    expect(isValidDate('2026-07-03')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('demain')).toBe(false);
    expect(isValidDate('2026-7-3')).toBe(false);
  });
});

describe('parseRelativeFrenchDate', () => {
  const now = new Date(2026, 6, 2, 14, 0, 0); // Thu 2 Jul 2026, 14:00 local
  it('resolves demain / après-demain / aujourd’hui', () => {
    expect(parseRelativeFrenchDate('mon train demain', now)).toBe(key(new Date(2026, 6, 3)));
    expect(parseRelativeFrenchDate('apres-demain le rdv', now)).toBe(key(new Date(2026, 6, 4)));
    expect(parseRelativeFrenchDate('ce soir', now)).toBe(key(new Date(2026, 6, 2)));
  });
  it('resolves a weekday to a future occurrence (today → next week)', () => {
    const vendredi = parseRelativeFrenchDate('vendredi', now)!;
    expect(new Date(`${vendredi}T00:00:00`).getDay()).toBe(5);
    const ahead = (new Date(`${vendredi}T00:00:00`).getTime() - new Date(2026, 6, 2).getTime()) / 86_400_000;
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThanOrEqual(7);
    // "jeudi" said on a Thursday → next Thursday (never 0 days ahead).
    expect(parseRelativeFrenchDate('jeudi', now)).toBe(key(new Date(2026, 6, 9)));
  });
  it('resolves "le N" to this month or next', () => {
    expect(parseRelativeFrenchDate('le 8', now)).toBe(key(new Date(2026, 6, 8)));
    expect(parseRelativeFrenchDate('le 1', now)).toBe(key(new Date(2026, 7, 1))); // already past → August
  });
  it('resolves "dans N jours" and "la semaine prochaine / dans une semaine"', () => {
    expect(parseRelativeFrenchDate('dans 3 jours', now)).toBe(key(new Date(2026, 6, 5)));
    expect(parseRelativeFrenchDate('dans 1 jour', now)).toBe(key(new Date(2026, 6, 3)));
    expect(parseRelativeFrenchDate('la semaine prochaine', now)).toBe(key(new Date(2026, 6, 9)));
    expect(parseRelativeFrenchDate('dans une semaine', now)).toBe(key(new Date(2026, 6, 9)));
  });
  it('returns null when there is no date cue', () => {
    expect(parseRelativeFrenchDate('mes médicaments à 9h', now)).toBeNull();
  });
});

describe('parseVoiceReminder — one-shot vs recurring', () => {
  const now = new Date(2026, 6, 2, 21, 0, 0);
  it('a plain time stays RECURRING (no date) — the meds case is unchanged', () => {
    const p = parseVoiceReminder('rappelle-moi mes médicaments à 9h', now);
    expect(p).not.toBeNull();
    expect(p!.time).toBe('09:00');
    expect(p!.date).toBeUndefined();
  });
  it('a relative-date cue makes it ONE-SHOT and is stripped from the label', () => {
    const p = parseVoiceReminder('rappelle-moi mon train demain à 10h38', now);
    expect(p).not.toBeNull();
    expect(p!.time).toBe('10:38');
    expect(p!.date).toBe(key(new Date(2026, 6, 3)));
    expect(p!.label).toContain('train');
    expect(p!.label).not.toMatch(/demain/i);
  });
  it('"dans N jours à HH:MM" sets the one-shot date and strips the cue from the label', () => {
    const p = parseVoiceReminder('rappelle-moi le dentiste dans 3 jours à 14h', now);
    expect(p).not.toBeNull();
    expect(p!.time).toBe('14:00');
    expect(p!.date).toBe(key(new Date(2026, 6, 5)));
    expect(p!.label).toContain('dentiste');
    expect(p!.label).not.toMatch(/dans 3 jours/i);
  });
});

describe('isDue — dated one-shot fires once on its day, recurring is unchanged', () => {
  it('a one-shot is due only on its date', async () => {
    const today = new Date(2026, 6, 2, 21, 0, 0);
    const r = await addReminder({ label: 'train', time: '10:38', date: key(new Date(2026, 6, 3)), now: today });
    expect(isOneShot(r)).toBe(true);
    // Not due the evening before…
    expect(isDue(r, today)).toBe(false);
    // …due on the date once the time is reached…
    expect(isDue(r, new Date(2026, 6, 3, 10, 40, 0))).toBe(true);
    // …not before the time on the date…
    expect(isDue(r, new Date(2026, 6, 3, 9, 0, 0))).toBe(false);
    // …and NEVER the day after (this is the bug fix).
    expect(isDue(r, new Date(2026, 6, 4, 10, 40, 0))).toBe(false);
  });

  it('a past-dated one-shot never fires', async () => {
    const r = await addReminder({ label: 'vieux', time: '08:00', date: '2026-06-01', now: new Date(2026, 6, 2) });
    expect(isDue(r, new Date(2026, 6, 2, 9, 0, 0))).toBe(false);
  });

  it('a recurring reminder still fires every day (non-regression)', async () => {
    const r = await addReminder({ label: 'médicaments', time: '09:00', now: new Date(2026, 6, 2) });
    expect(isDue(r, new Date(2026, 6, 2, 9, 30, 0))).toBe(true);
    // Simulate it fired today, then check tomorrow → still due (recurs).
    const firedToday = { ...r, lastFiredAt: new Date(2026, 6, 2, 9, 30, 0).toISOString() };
    expect(isDue(firedToday, new Date(2026, 6, 2, 10, 0, 0))).toBe(false); // already fired today's occ
    expect(isDue(firedToday, new Date(2026, 6, 3, 9, 30, 0))).toBe(true); // tomorrow → recurs
  });
});

describe('markDone — retires a one-shot, only acks-today a recurring', () => {
  it('one-shot → disabled; recurring → stays enabled', async () => {
    const one = await addReminder({ label: 'train', time: '10:38', date: '2026-07-03' });
    await markDone(one.id, 'voice');
    const oneAfter = (await listReminders()).find((x) => x.id === one.id)!;
    expect(oneAfter.enabled).toBe(false);
    expect(oneAfter.lastDoneAt).toBeTruthy();

    const rec = await addReminder({ label: 'médicaments', time: '09:00' });
    await markDone(rec.id, 'voice');
    const recAfter = (await listReminders()).find((x) => x.id === rec.id)!;
    expect(recAfter.enabled).toBe(true); // meds must return tomorrow
  });
});

describe('runReminderTick — auto-retires a one-shot after it fires', () => {
  it('fires the one-shot once, then it is disabled and never fires again', async () => {
    const spoken: string[] = [];
    const deps = { say: async (t: string) => void spoken.push(t), notify: async () => {} };
    await addReminder({ label: 'train', time: '10:38', date: '2026-07-03' });

    await runReminderTick(new Date(2026, 6, 3, 10, 40, 0), deps);
    expect(spoken.some((s) => /train/i.test(s))).toBe(true);
    const after = (await listReminders())[0]!;
    expect(after.enabled).toBe(false); // retired

    // A later tick (even same day) fires nothing more.
    spoken.length = 0;
    await runReminderTick(new Date(2026, 6, 3, 10, 45, 0), deps);
    expect(spoken).toHaveLength(0);
  });
});
