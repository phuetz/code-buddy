/**
 * Reminder runner — the cadence that fires due reminders, announces them (voice + Telegram),
 * opens the bounded ack window, gently re-nags, and escalates a missed dose to Telegram.
 *
 * Uses a plain interval (not the buddy-sense heartbeat) so reminders work even when the sensory
 * daemon isn't running — a meds reminder must not depend on a camera/mic being up. Delivery is
 * injectable (say / notify) so the whole lifecycle is deterministically testable; never-throws.
 *
 * @module companion/reminder-runner
 */

import { logger } from '../utils/logger.js';
import {
  dueReminders,
  markFired,
  openAck,
  bumpNag,
  pendingAcks,
  expireAcks,
  reminderMessage,
  logReminderEvent,
  ackWindowMs,
  type Reminder,
} from './reminders.js';

export interface ReminderRunnerDeps {
  /** Speak a line aloud. Default: sayNow (Piper). */
  say?: (text: string) => Promise<void>;
  /** Push a line to Telegram. Default: sendTelegramAlert. */
  notify?: (text: string) => Promise<void>;
  /** Gap between re-nags (ms). Default 60000. */
  renagMs?: number;
  /** Max re-nags before the window lapses → missed. Default 2. */
  renagMax?: number;
  /** Ack window (ms). Default from CODEBUDDY_REMINDER_ACK_WINDOW_MS. */
  windowMs?: number;
}

function renagMs(deps: ReminderRunnerDeps): number {
  if (deps.renagMs !== undefined) return deps.renagMs;
  const n = Number(process.env.CODEBUDDY_REMINDER_RENAG_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}
function renagMax(deps: ReminderRunnerDeps): number {
  if (deps.renagMax !== undefined) return deps.renagMax;
  const n = Number(process.env.CODEBUDDY_REMINDER_RENAG_MAX);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

async function defaultSay(text: string): Promise<void> {
  const { sayNow } = await import('../sensory/voice-loop.js');
  await sayNow(text);
}
async function defaultNotify(text: string): Promise<void> {
  const { sendTelegramAlert } = await import('../sensory/alert.js');
  await sendTelegramAlert(text);
}

/**
 * One pass of the reminder loop. Exposed (not just the interval) so tests drive it with a
 * controlled clock + injected delivery. Never-throws.
 */
export async function runReminderTick(now: Date, deps: ReminderRunnerDeps = {}): Promise<void> {
  const say = deps.say ?? defaultSay;
  const notify = deps.notify ?? defaultNotify;
  const window = deps.windowMs ?? ackWindowMs();
  const gap = renagMs(deps);
  const maxNags = renagMax(deps);
  const nowMs = now.getTime();

  // 1. Fire newly-due reminders.
  let due: Reminder[] = [];
  try {
    due = await dueReminders(now);
  } catch (err) {
    logger.warn(`[reminders] due check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const r of due) {
    try {
      await markFired(r.id, now);
      openAck(r, nowMs);
      const msg = reminderMessage(r);
      await say(msg);
      await notify(`⏰ ${msg}`);
      logger.info(`[reminders] fired '${r.label}' (awaiting ack)`);
    } catch (err) {
      logger.warn(`[reminders] fire '${r.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Gentle re-nag of still-pending reminders (voice only — don't spam Telegram per nag).
  for (const a of pendingAcks(nowMs, window)) {
    const elapsed = nowMs - a.firedAt;
    if (a.nags < maxNags && elapsed >= gap * (a.nags + 1)) {
      try {
        bumpNag(a.id);
        await logReminderEvent('renag', a, { nag: a.nags }, now);
        await say(`Petit rappel : ${a.label}.`);
      } catch (err) {
        logger.warn(`[reminders] renag '${a.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 3. Escalate the ones whose window lapsed with no ack → Telegram + log 'missed'.
  for (const a of expireAcks(nowMs, window)) {
    try {
      await logReminderEvent('missed', a, {}, now);
      await notify(`⚠️ Pas de confirmation : ${a.label}. (à vérifier)`);
      logger.warn(`[reminders] '${a.label}' not acknowledged → escalated to Telegram, logged missed`);
    } catch (err) {
      logger.warn(`[reminders] missed-escalation '${a.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Start the interval. Returns a teardown that stops it. */
export function wireReminderRunner(deps: ReminderRunnerDeps = {}): () => void {
  const intervalMs = Number(process.env.CODEBUDDY_REMINDER_TICK_MS) || 60_000;
  const timer = setInterval(() => {
    void runReminderTick(new Date(), deps);
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`Reminders: runner started (tick ${Math.round(intervalMs / 1000)}s)`);
  return () => clearInterval(timer);
}
