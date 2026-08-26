import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { whenRemindersPersisted } from '../../src/companion/reminders.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  openAck,
  pendingAcks,
  resetAcks,
  loadPendingAcks,
  addReminder,
} from '../../src/companion/reminders.js';
import { runReminderTick } from '../../src/companion/reminder-runner.js';

let dir: string;
let n = 0;
const flush = () => new Promise((r) => setTimeout(r, 40)); // let the fire-and-forget persist land

beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-ackpersist-${process.pid}-${n++}`);
  process.env.CODEBUDDY_REMINDER_PENDING_FILE = path.join(dir, 'pending-acks.json');
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'reminder-log.jsonl');
  resetAcks();
});
afterEach(async () => {
  // Let the fire-and-forget reminder mirrors land before removing their dir (ENOTEMPTY on Windows).
  await whenRemindersPersisted();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  delete process.env.CODEBUDDY_REMINDER_PENDING_FILE;
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
});

describe('pending-ack persistence — survive a restart mid-window (health safety)', () => {
  it('a pending ack is reloaded from disk after the in-memory registry is lost', async () => {
    openAck({ id: 'r1', label: 'médicaments' }, 1000);
    await flush(); // the async persist
    resetAcks(); // simulate the process dying (memory gone)
    expect(pendingAcks(1000, 999_999)).toHaveLength(0);

    await loadPendingAcks(); // the new process restores from disk
    const restored = pendingAcks(1000, 999_999);
    expect(restored.map((a) => a.id)).toEqual(['r1']);
    expect(restored[0]!.label).toBe('médicaments');
  });

  it('end-to-end: a dose that fired before a restart still escalates to a logged "missed"', async () => {
    const T0 = new Date('2026-06-26T09:00:30');
    await addReminder({ label: 'médicaments', time: '09:00' });

    // --- process A: the reminder fires, opens the ack window ---
    const sayA = vi.fn(async () => {});
    const notifyA = vi.fn(async () => {});
    await runReminderTick(T0, { say: sayA, notify: notifyA, windowMs: 10_000, renagMs: 5000, renagMax: 1 });
    expect(notifyA).toHaveBeenCalledTimes(1); // fired
    expect(pendingAcks(T0.getTime(), 10_000)).toHaveLength(1);
    await flush();

    // --- CRASH: in-memory pending is lost ---
    resetAcks();
    expect(pendingAcks(T0.getTime(), 10_000)).toHaveLength(0);

    // --- process B restarts, restores pending from disk ---
    await loadPendingAcks();
    expect(pendingAcks(T0.getTime(), 10_000)).toHaveLength(1); // survived the restart

    // --- later, past the window, with no ack → still escalates to Telegram + logs "missed" ---
    const sayB = vi.fn(async () => {});
    const notifyB = vi.fn(async () => {});
    const later = new Date(T0.getTime() + 11_000);
    await runReminderTick(later, { say: sayB, notify: notifyB, windowMs: 10_000, renagMs: 5000, renagMax: 1 });
    expect(notifyB).toHaveBeenCalledTimes(1);
    expect(notifyB.mock.calls[0]![0]).toContain('Pas de confirmation'); // the missed-dose escalation
    expect(pendingAcks(later.getTime(), 10_000)).toHaveLength(0); // expired
  });

  it('never throws when the pending file is absent/corrupt', async () => {
    await expect(loadPendingAcks()).resolves.toBeUndefined(); // no file yet
  });
});
