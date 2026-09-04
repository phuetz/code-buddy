/**
 * GK23 — parcours réel des rappels avec horloge factice, Piper (WAV), faux
 * aplay, faux Telegram. HOME isolé dans _qa/gk23. Jamais le store opérateur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  makeWorkDir,
  snapshotEnv,
  restoreEnv,
  isolateStores,
  runBuddy,
  localDateKey,
  PIPER_BIN,
  PIPER_MODEL,
  REAL_REMINDERS,
  REAL_PENDING,
  REAL_LOG,
  APLAY_BIN,
} from './gk23-harness.js';
import {
  matchAck,
  markDone,
  snoozePending,
  pendingAcks,
  dueSnoozes,
  resetAcks,
  resetSnoozes,
  loadPendingAcks,
  loadSnoozes,
  whenRemindersPersisted,
  listReminders,
  isDue,
} from '../../src/companion/reminders.js';
import { runReminderTick } from '../../src/companion/reminder-runner.js';
import { sendTelegramAlert } from '../../src/sensory/alert.js';
import { sayNow } from '../../src/sensory/voice-loop.js';
import { hasPiper } from '../helpers/cifix2-dependencies.js';

const FAKE_TOKEN = '123456:gk23-fake-token';
const FAKE_CHAT = '4242';
const piperProbe = hasPiper({ piperBin: PIPER_BIN, piperModel: PIPER_MODEL, audioPlayerBin: APLAY_BIN });

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function wavsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.wav'));
}

describe.skipIf(!piperProbe.available)('GK23 — rappels en vrai (horloge factice, Piper, Telegram factice)', () => {
  const realBefore = {
    reminders: existsSync(REAL_REMINDERS) ? sha256File(REAL_REMINDERS) : 'missing',
    pending: existsSync(REAL_PENDING) ? sha256File(REAL_PENDING) : 'missing',
    log: existsSync(REAL_LOG) ? sha256File(REAL_LOG) : 'missing',
  };

  let snap: Record<string, string | undefined>;
  let artifacts: string;
  let telegram: {
    base: string;
    close: () => Promise<void>;
    state: { outbound: Array<{ method: string; text?: string }> };
  };
  let fireDay: Date;
  let oneShotDate: string;

  beforeAll(async () => {
    snap = snapshotEnv();
    const work = await makeWorkDir('e2e-');
    const stores = isolateStores(work);
    artifacts = stores.artifacts;

    const { listenFakeTelegram } = await import('../../_qa/gk10/fake-telegram.mjs');
    telegram = await listenFakeTelegram({ token: FAKE_TOKEN });
    process.env.TELEGRAM_API_BASE = telegram.base;
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = FAKE_TOKEN;
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = FAKE_CHAT;
    process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS = String(20 * 60_000);

    // Jour de tir = DEMAIN 10:38:30 (heure locale), jamais une date figée : les commandes
    // `remind list/agenda` tournent en sous-processus sur l'horloge RÉELLE, et une date
    // d'écriture figée (4 sept. 2026) faisait disparaître le rappel ponctuel de l'agenda
    // dès que l'heure réelle l'avait dépassée (rouge à partir du 04/09/2026 10 h 38).
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    fireDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 38, 30);
    oneShotDate = localDateKey(fireDay);
    resetAcks();
    resetSnoozes();
  }, 30_000);

  afterAll(async () => {
    await whenRemindersPersisted();
    if (telegram) await telegram.close();
    restoreEnv(snap);
    expect(existsSync(REAL_REMINDERS) ? sha256File(REAL_REMINDERS) : 'missing').toBe(realBefore.reminders);
    expect(existsSync(REAL_PENDING) ? sha256File(REAL_PENDING) : 'missing').toBe(realBefore.pending);
    expect(existsSync(REAL_LOG) ? sha256File(REAL_LOG) : 'missing').toBe(realBefore.log);
  });

  it('parcours complet: add → list/agenda → tir (voix+Telegram) → ack du bon rappel → snooze → re-nag×2 → missed → restart → J+1 → rm', async () => {
    const addShot = await runBuddy(['remind', 'add', 'train', '--at', '10:38', '--date', oneShotDate]);
    expect(addShot.exitCode, addShot.stdout + addShot.stderr).toBe(0);
    expect(addShot.stdout).toMatch(/one-shot/);
    const addDaily = await runBuddy(['remind', 'add', 'médicaments', '--at', '10:38']);
    expect(addDaily.exitCode, addDaily.stdout + addDaily.stderr).toBe(0);
    expect(addDaily.stdout).toMatch(/daily/);

    const listed = await runBuddy(['remind', 'list']);
    expect(listed.stdout).toMatch(/train/);
    expect(listed.stdout).toMatch(/médicaments/);

    const agenda = await runBuddy(['remind', 'agenda', '--ahead', '14']);
    expect(agenda.stdout).toMatch(/train/);
    expect(agenda.stdout).toMatch(/médicaments/);

    const beforeWavs = wavsIn(artifacts).length;
    const tFire = fireDay;
    await runReminderTick(tFire, {
      say: (text) => sayNow(text, { phoneDelivery: 'never', ttsRouteHint: 'reminder' }).then(() => undefined),
      notify: (text) => sendTelegramAlert(text),
      recordRemote: async () => {},
      recordLocal: async () => {},
      windowMs: 20 * 60_000,
      renagMs: 4_000,
      renagMax: 2,
    });

    const pending = pendingAcks(tFire.getTime(), 20 * 60_000);
    expect(pending).toHaveLength(2);
    const outboundAfterFire = telegram.state.outbound.filter((o) => o.method === 'sendMessage');
    expect(outboundAfterFire.length).toBeGreaterThanOrEqual(2);
    expect(outboundAfterFire.some((o) => /train/i.test(o.text ?? ''))).toBe(true);
    expect(outboundAfterFire.some((o) => /médicaments/i.test(o.text ?? ''))).toBe(true);
    expect(outboundAfterFire.every((o) => !/\[reminders\]/.test(o.text ?? ''))).toBe(true);
    expect(wavsIn(artifacts).length).toBeGreaterThan(beforeWavs);
    const aplayLog = existsSync(path.join(artifacts, 'aplay.log'))
      ? await readFile(path.join(artifacts, 'aplay.log'), 'utf8')
      : '';
    expect(aplayLog).toMatch(/\.wav/);

    const train = (await listReminders()).find((r) => r.label === 'train')!;
    const meds = (await listReminders()).find((r) => r.label === 'médicaments')!;
    expect(train.enabled).toBe(false); // one-shot retired on fire
    expect(meds.enabled).toBe(true);

    const wrong = matchAck("c'est fait pour le train", tFire.getTime(), 20 * 60_000);
    expect(wrong).toBe(train.id);
    expect(wrong).not.toBe(meds.id);
    await markDone(wrong!, 'voice');
    expect(pendingAcks(tFire.getTime(), 20 * 60_000).map((a) => a.id)).toEqual([meds.id]);

    const snoozed = await snoozePending('dans 10 minutes', tFire.getTime());
    expect(snoozed).toMatchObject({ id: meds.id, delayMs: 10 * 60_000 });
    expect(pendingAcks(tFire.getTime(), 20 * 60_000)).toHaveLength(0);

    await whenRemindersPersisted();
    resetAcks();
    resetSnoozes();
    expect(pendingAcks(tFire.getTime(), 20 * 60_000)).toHaveLength(0);
    expect(dueSnoozes(tFire.getTime() + 10 * 60_000)).toHaveLength(0);
    await loadPendingAcks();
    await loadSnoozes();
    expect(dueSnoozes(tFire.getTime() + 10 * 60_000).map((s) => s.id)).toEqual([meds.id]);
    expect(isDue(train, tFire)).toBe(false);
    expect(isDue(meds, tFire)).toBe(false); // already fired today

    const spoken: string[] = [];
    const tSnoozeDue = new Date(tFire.getTime() + 10 * 60_000);
    const deps = {
      say: async (text: string) => {
        spoken.push(text);
      },
      notify: (text: string) => sendTelegramAlert(text),
      recordRemote: async () => {},
      recordLocal: async () => {},
      windowMs: 15_000,
      renagMs: 4_000,
      renagMax: 2,
    };
    await runReminderTick(tSnoozeDue, deps);
    expect(spoken.some((s) => /médicaments/i.test(s))).toBe(true);
    expect(dueSnoozes(tSnoozeDue.getTime())).toHaveLength(0);
    expect(pendingAcks(tSnoozeDue.getTime(), 15_000).map((a) => a.id)).toEqual([meds.id]);

    spoken.length = 0;
    await runReminderTick(new Date(tSnoozeDue.getTime() + 4_500), deps);
    await runReminderTick(new Date(tSnoozeDue.getTime() + 8_500), deps);
    const nags = spoken.filter((s) => /Petit rappel/.test(s));
    expect(nags).toHaveLength(2);

    const beforeMissed = telegram.state.outbound.length;
    await runReminderTick(new Date(tSnoozeDue.getTime() + 16_000), deps);
    const missed = telegram.state.outbound.slice(beforeMissed).filter((o) => o.method === 'sendMessage');
    expect(missed.some((o) => /Pas de confirmation/.test(o.text ?? ''))).toBe(true);
    expect(pendingAcks(tSnoozeDue.getTime() + 16_000, 15_000)).toHaveLength(0);

    // Lendemain du jour de tir (relatif, jamais figé — même raison que fireDay).
    const nextMorning = new Date(fireDay.getFullYear(), fireDay.getMonth(), fireDay.getDate() + 1, 10, 38, 30);
    const after = await listReminders();
    const trainAfter = after.find((r) => r.id === train.id)!;
    const medsAfter = after.find((r) => r.id === meds.id)!;
    expect(trainAfter.enabled).toBe(false);
    expect(isDue(trainAfter, nextMorning)).toBe(false);
    expect(medsAfter.enabled).toBe(true);
    expect(isDue(medsAfter, nextMorning)).toBe(true);

    const rmMeds = await runBuddy(['remind', 'rm', meds.id]);
    expect(rmMeds.exitCode).toBe(0);
    const rmTrain = await runBuddy(['remind', 'rm', train.id]);
    expect(rmTrain.exitCode).toBe(0);
    const empty = await runBuddy(['remind', 'list']);
    expect(empty.stdout).toMatch(/No reminders yet/);
  }, 180_000);
});
