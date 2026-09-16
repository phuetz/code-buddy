/**
 * GK23 E3 — `buddy remind` usage must name agenda and --date; the real CLI
 * add/list/agenda/rm path is exercised against an isolated HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  makeWorkDir,
  snapshotEnv,
  restoreEnv,
  isolateStores,
  runBuddy,
  localDateKey,
} from '../companion/gk23-harness.js';
import { whenRemindersPersisted, resetAcks, resetSnoozes } from '../../src/companion/reminders.js';

let snap: Record<string, string | undefined>;

beforeEach(async () => {
  snap = snapshotEnv();
  const work = await makeWorkDir('cli-');
  isolateStores(work);
  resetAcks();
  resetSnoozes();
});

afterEach(async () => {
  await whenRemindersPersisted();
  restoreEnv(snap);
});

describe('GK23 E3 — buddy remind CLI usage', () => {
  it('unknown action lists agenda among the subcommands', async () => {
    const result = await runBuddy(['remind', 'nope']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/agenda/);
    expect(result.stdout).toMatch(/add\|list\|agenda\|done\|rm/);
  });

  it('add without --at mentions --date', async () => {
    const result = await runBuddy(['remind', 'add', 'train']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/--date/);
  });
});

describe('GK23 — buddy remind add/list/agenda/rm (real CLI)', () => {
  it('adds a dated one-shot and a recurring reminder, lists them, shows agenda, then removes', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = localDateKey(tomorrow);

    const addShot = await runBuddy(['remind', 'add', 'train', '--at', '10:38', '--date', date]);
    expect(addShot.exitCode).toBe(0);
    expect(addShot.stdout).toMatch(/one-shot/);
    expect(addShot.stdout).toContain(date);
    expect(addShot.stdout).not.toMatch(/\[reminders\]/);

    const addDaily = await runBuddy(['remind', 'add', 'médicaments', '--at', '09:00']);
    expect(addDaily.exitCode).toBe(0);
    expect(addDaily.stdout).toMatch(/daily/);

    const list = await runBuddy(['remind', 'list']);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toMatch(/train/);
    expect(list.stdout).toMatch(/médicaments/);
    expect(list.stdout).toMatch(/once/);

    const agenda = await runBuddy(['remind', 'agenda', '--ahead', '2']);
    expect(agenda.exitCode).toBe(0);
    expect(agenda.stdout).toMatch(/train/);
    expect(agenda.stdout).toMatch(/ponctuel/);
    expect(agenda.stdout).toMatch(/médicaments/);
    expect(agenda.stdout).toMatch(/récurrent/);

    const trainId = /Added (r-\S+): "train"/.exec(addShot.stdout)?.[1];
    expect(trainId).toBeTruthy();
    const rm = await runBuddy(['remind', 'rm', trainId!]);
    expect(rm.exitCode).toBe(0);
    expect(rm.stdout).toMatch(/Removed/);
    const listAfter = await runBuddy(['remind', 'list']);
    expect(listAfter.stdout).not.toMatch(/train/);
    expect(listAfter.stdout).toMatch(/médicaments/);
  });
});
