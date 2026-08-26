import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { whenRemindersPersisted } from '../../src/companion/reminders.js';
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
  // Let the fire-and-forget reminder mirrors land before removing their dir (ENOTEMPTY on Windows).
  await whenRemindersPersisted();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
});

const T0 = new Date('2026-06-26T09:00:30'); // just after a 09:00 reminder

describe('reminder-runner', () => {
  it('fires a due reminder: speaks + telegram + opens an ack window', async () => {
    await addReminder({ label: 'médicaments', time: '09:00' });
    const say = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    const recordRemote = vi.fn(async () => {});
    await runReminderTick(T0, {
      say,
      notify,
      recordRemote,
      windowMs: 10_000,
      renagMs: 5000,
      renagMax: 2,
    });
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0]).toContain('médicaments');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(recordRemote).toHaveBeenCalledWith(
      expect.stringContaining('médicaments'),
      expect.stringMatching(/^reminder:.+:fired:/),
    );
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
    const recordLocal = vi.fn(async () => {});
    const deps = {
      say,
      notify,
      recordLocal,
      windowMs: 10_000,
      renagMs: 4000,
      renagMax: 1,
    };

    await runReminderTick(T0, deps); // fire (say #1, notify #1)
    await runReminderTick(new Date(T0.getTime() + 5000), deps); // >renagMs → re-nag (say #2)
    expect(say).toHaveBeenCalledTimes(2);
    expect(recordLocal).toHaveBeenCalledWith(
      'Petit rappel : médicaments.',
      expect.stringMatching(/^reminder:.+:renag:/),
    );

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
