/**
 * GK23 E2 — a voice failure must not swallow the Telegram announcement.
 * "annonce sans Telegram" is a listed defect class.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  makeWorkDir,
  snapshotEnv,
  restoreEnv,
  isolateStores,
} from './gk23-harness.js';
import {
  addReminder,
  resetAcks,
  resetSnoozes,
  whenRemindersPersisted,
  pendingAcks,
} from '../../src/companion/reminders.js';
import { runReminderTick } from '../../src/companion/reminder-runner.js';

let snap: Record<string, string | undefined>;

beforeEach(async () => {
  snap = snapshotEnv();
  const work = await makeWorkDir('e2-');
  isolateStores(work);
  resetAcks();
  resetSnoozes();
});

afterEach(async () => {
  await whenRemindersPersisted();
  restoreEnv(snap);
});

const T0 = new Date('2026-09-03T09:00:30');

describe('GK23 E2 — fire still notifies Telegram when voice throws', () => {
  it('sends the Telegram announcement even if say() throws', async () => {
    await addReminder({ label: 'médicaments', time: '09:00' });
    const notify = vi.fn(async () => true);
    const recordRemote = vi.fn(async () => {});
    await runReminderTick(T0, {
      say: async () => {
        throw new Error('piper down');
      },
      notify,
      recordRemote,
      windowMs: 10_000,
      renagMs: 5_000,
      renagMax: 2,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0]?.[0])).toContain('médicaments');
    expect(String(notify.mock.calls[0]?.[0])).not.toMatch(/\[reminders\]/);
    expect(pendingAcks(T0.getTime(), 10_000)).toHaveLength(1);
  });
});
