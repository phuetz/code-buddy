/**
 * GK23 E1 — pointing CODEBUDDY_REMINDERS_FILE must also isolate pending acks,
 * snoozes and the reminder log. Otherwise a test (or a custom store) silently
 * writes into ~/.codebuddy/companion/pending-acks.json.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  makeWorkDir,
  snapshotEnv,
  restoreEnv,
  isolateStores,
} from './gk23-harness.js';
import {
  openAck,
  snoozeReminder,
  whenRemindersPersisted,
  resetAcks,
  resetSnoozes,
  addReminder,
} from '../../src/companion/reminders.js';

let snap: Record<string, string | undefined>;
let work: string;

beforeEach(async () => {
  snap = snapshotEnv();
  work = await makeWorkDir('e1-');
  resetAcks();
  resetSnoozes();
});

afterEach(async () => {
  await whenRemindersPersisted();
  restoreEnv(snap);
});

describe('GK23 E1 — REMINDERS_FILE isolates companion stores', () => {
  it('writes pending-acks and snoozes next to the reminders file, not under $HOME/.codebuddy/companion', async () => {
    // HOME is a decoy. The store lives ELSEWHERE so a homedir() fallback is a
    // visible leak — the product must follow CODEBUDDY_REMINDERS_FILE.
    const stores = isolateStores(work, { pendingEnv: false });
    const customDir = path.join(work, 'custom-store');
    const remindersFile = path.join(customDir, 'reminders.json');
    process.env.CODEBUDDY_REMINDERS_FILE = remindersFile;
    delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
    delete process.env.CODEBUDDY_REMINDER_PENDING_FILE;
    delete process.env.CODEBUDDY_REMINDER_SNOOZE_FILE;

    const expectedPending = path.join(customDir, 'companion', 'pending-acks.json');
    const expectedSnooze = path.join(customDir, 'companion', 'snoozes.json');
    const leakedPending = path.join(stores.home, '.codebuddy', 'companion', 'pending-acks.json');

    await addReminder({ label: 'médicaments', time: '09:00' });
    openAck({ id: 'r-meds', label: 'médicaments' }, 1_000);
    snoozeReminder('r-meds', 'médicaments', 5_000);
    await whenRemindersPersisted();

    expect(existsSync(expectedPending), `pending-acks should follow reminders file at ${expectedPending}`).toBe(
      true,
    );
    expect(existsSync(expectedSnooze), `snoozes should follow reminders file at ${expectedSnooze}`).toBe(true);

    const leaked = existsSync(leakedPending) ? await readFile(leakedPending, 'utf8') : '';
    expect(leaked.includes('r-meds'), 'must not leak pending acks into $HOME/.codebuddy/companion').toBe(false);
    expect(expectedPending).not.toBe(leakedPending);
  });
});
