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
  setReminderEnabled,
  isOneShot,
  openAck,
  bumpNag,
  pendingAcks,
  expireAcks,
  dueSnoozes,
  consumeSnooze,
  loadReminders,
  reminderMessage,
  logReminderEvent,
  ackWindowMs,
  type Reminder,
} from './reminders.js';

export interface ReminderRunnerDeps {
  /** Speak a line aloud. Default: sayNow (Piper). */
  say?: (text: string) => Promise<void>;
  /** Push a line to Telegram. Default: sendTelegramAlert. */
  notify?: (text: string) => Promise<boolean | void>;
  /** Record a delivered Telegram notification without sending it twice. */
  recordRemote?: (text: string, externalId: string) => Promise<void>;
  /** Record a voice-only re-nag so linked channels can continue from it. */
  recordLocal?: (text: string, externalId: string) => Promise<void>;
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
  // The runner owns its Telegram notification separately; never emit a second
  // voice note through sayNow's legacy environment-controlled phone path.
  await sayNow(text, { phoneDelivery: 'never', ttsRouteHint: 'reminder' });
}
async function defaultNotify(text: string): Promise<boolean> {
  const { sendTelegramAlert } = await import('../sensory/alert.js');
  return sendTelegramAlert(text);
}
async function defaultRecordRemote(text: string, externalId: string): Promise<void> {
  const { recordDeliveredChannelInitiative } = await import(
    '../conversation/voice-continuity.js'
  );
  await recordDeliveredChannelInitiative(text, externalId);
}
async function defaultRecordLocal(text: string, externalId: string): Promise<void> {
  const { getCrossChannelConversationBridge } = await import(
    '../conversation/cross-channel-bridge.js'
  );
  await getCrossChannelConversationBridge().recordVoiceTurn(
    { role: 'assistant', content: text },
    externalId,
  );
}

async function notifyAndRecord(
  text: string,
  externalId: string,
  deps: ReminderRunnerDeps,
  notify: (content: string) => Promise<boolean | void>,
): Promise<void> {
  const accepted = await notify(text);
  if (accepted !== false && (!deps.notify || deps.recordRemote)) {
    await (deps.recordRemote ?? defaultRecordRemote)(text, externalId);
  }
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
      // A one-shot (dated) reminder retires the moment it fires — it must never come back tomorrow.
      // The isDue date check already prevents that, but disabling makes it explicit + visible in the
      // list, and closes any same-day double-fire edge.
      if (isOneShot(r)) await setReminderEnabled(r.id, false);
      openAck(r, nowMs);
      const msg = reminderMessage(r);
      await say(msg);
      await notifyAndRecord(
        `⏰ ${msg}`,
        `reminder:${r.id}:fired:${now.toISOString()}`,
        deps,
        notify,
      );
      logger.info(`[reminders] fired '${r.label}'${isOneShot(r) ? ' (one-shot → retired)' : ''} (awaiting ack)`);
    } catch (err) {
      logger.warn(`[reminders] fire '${r.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 1b. Re-announce any SNOOZED reminders now due (a "rappelle-moi dans 10 min" deferral) — reopens
  // a fresh ack cycle so it can be acked or snoozed again.
  for (const s of dueSnoozes(nowMs)) {
    try {
      const r = (await loadReminders()).find((x) => x.id === s.id);
      const msg = r ? reminderMessage(r) : `C'est l'heure : ${s.label}.`;
      openAck({ id: s.id, label: s.label }, nowMs);
      await say(msg);
      await notifyAndRecord(
        `⏰ ${msg}`,
        `reminder:${s.id}:snoozed:${nowMs}`,
        deps,
        notify,
      );
      await logReminderEvent('fired', { id: s.id, label: s.label }, { snoozed: true }, now);
      const consumed = await consumeSnooze(s.id);
      if (!consumed) {
        logger.warn(`[reminders] snooze re-fire '${s.label}' announced but not consumed durably`);
      }
      logger.info(`[reminders] snoozed reminder re-fired '${s.label}'`);
    } catch (err) {
      logger.warn(`[reminders] snooze re-fire '${s.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Gentle re-nag of still-pending reminders (voice only — don't spam Telegram per nag).
  for (const a of pendingAcks(nowMs, window)) {
    const elapsed = nowMs - a.firedAt;
    if (a.nags < maxNags && elapsed >= gap * (a.nags + 1)) {
      try {
        bumpNag(a.id);
        await logReminderEvent('renag', a, { nag: a.nags }, now);
        const line = `Petit rappel : ${a.label}.`;
        await say(line);
        if (!deps.say || deps.recordLocal) {
          await (deps.recordLocal ?? defaultRecordLocal)(
            line,
            `reminder:${a.id}:renag:${a.firedAt}:${a.nags + 1}`,
          );
        }
      } catch (err) {
        logger.warn(`[reminders] renag '${a.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 3. Escalate the ones whose window lapsed with no ack → Telegram + log 'missed'.
  for (const a of expireAcks(nowMs, window)) {
    try {
      await logReminderEvent('missed', a, {}, now);
      await notifyAndRecord(
        `⚠️ Pas de confirmation : ${a.label}. (à vérifier)`,
        `reminder:${a.id}:missed:${a.firedAt}`,
        deps,
        notify,
      );
      logger.warn(`[reminders] '${a.label}' not acknowledged → escalated to Telegram, logged missed`);
    } catch (err) {
      logger.warn(`[reminders] missed-escalation '${a.label}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Start the interval. Returns a teardown that stops it. */
export function wireReminderRunner(deps: ReminderRunnerDeps = {}): () => void {
  const intervalMs = Number(process.env.CODEBUDDY_REMINDER_TICK_MS) || 60_000;
  // Restore pending acks first: a reminder that fired before a restart must still be re-nagged or
  // escalated to a logged 'missed' — never silently dropped (health safety).
  void (async () => {
    try {
      const { loadPendingAcks, loadSnoozes } = await import('./reminders.js');
      await loadPendingAcks();
      await loadSnoozes(); // restore deferred reminders so a restart mid-snooze still re-announces
    } catch (err) {
      logger.warn(
        `[reminders] could not restore pending acks/snoozes: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  })();
  const timer = setInterval(() => {
    void runReminderTick(new Date(), deps);
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`Reminders: runner started (tick ${Math.round(intervalMs / 1000)}s)`);
  return () => clearInterval(timer);
}
