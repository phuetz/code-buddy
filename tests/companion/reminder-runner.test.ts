import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import { runReminderTick } from '../../src/companion/reminder-runner.js';
import { addReminder, matchAck, markDone, resetAcks, pendingAcks } from '../../src/companion/reminders.js';

let dir: string;
let n = 0;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-rr-${process.pid}-${n++}`);
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'reminder-log.jsonl');
  resetAcks();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
});

const T0 = new Date('2026-06-26T09:00:30'); // just after a 09:00 reminder

describe('reminder-runner', () => {
  it('fires a due reminder: speaks + telegram + opens an ack window', async () => {
    await addReminder({ label: 'médicaments', time: '09:00' });
    const say = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    await runReminderTick(T0, { say, notify, windowMs: 10_000, renagMs: 5000, renagMax: 2 });
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0]).toContain('médicaments');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(pendingAcks(T0.getTime(), 10_000)).toHaveLength(1); // awaiting ack
  });

  it('acked within the window → no re-nag, no escalation', async () => {
    await addReminder({ label: 'médicaments', time: '09:00' });
    const say = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    await runReminderTick(T0, { say, notify, windowMs: 10_000, renagMs: 5000, renagMax: 2 });

    // User acks by voice.
    const id = matchAck("c'est fait", T0.getTime());
    expect(id).toBeTruthy();
    await markDone(id!, 'voice');

    // A later tick: nothing pending → no extra say, no escalation notify.
    const later = new Date(T0.getTime() + 20_000);
    await runReminderTick(later, { say, notify, windowMs: 10_000, renagMs: 5000, renagMax: 2 });
    expect(say).toHaveBeenCalledTimes(1); // only the original announce
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('no ack → gentle re-nag, then Telegram escalation + missed', async () => {
    await addReminder({ label: 'médicaments', time: '09:00' });
    const say = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    const deps = { say, notify, windowMs: 10_000, renagMs: 4000, renagMax: 1 };

    await runReminderTick(T0, deps); // fire (say #1, notify #1)
    await runReminderTick(new Date(T0.getTime() + 5000), deps); // >renagMs → re-nag (say #2)
    expect(say).toHaveBeenCalledTimes(2);

    await runReminderTick(new Date(T0.getTime() + 11_000), deps); // >window → escalate
    expect(notify).toHaveBeenCalledTimes(2); // announce + escalation
    expect(notify.mock.calls[1][0]).toContain('Pas de confirmation');
    expect(pendingAcks(T0.getTime() + 11_000, 10_000)).toHaveLength(0); // expired
  });

  it('never throws when delivery fails', async () => {
    await addReminder({ label: 'meds', time: '09:00' });
    await expect(
      runReminderTick(T0, {
        say: async () => {
          throw new Error('no audio');
        },
        notify: async () => {
          throw new Error('no telegram');
        },
        windowMs: 10_000,
      }),
    ).resolves.toBeUndefined();
  });
});
