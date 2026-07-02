/**
 * Reminders — the robot reminds Patrice to do things (meds…) and he flags them done.
 *
 * Persisted as JSON (companion-subsystem style, like sensory-rules.json) so it's portable and
 * hand-editable: `~/.codebuddy/reminders.json` (definitions) + `~/.codebuddy/companion/
 * reminder-log.jsonl` (fired/done/missed events). The store reuses the `Reminder` *shape* of
 * `src/memory/prospective-memory.ts` but NOT its SQLite engine.
 *
 * SAFETY is the point — this is health. A false "taken" → a missed or double dose, and ambient
 * speech gets mis-attributed ("c'est fait" about dinner must not mark the meds done). So an
 * acknowledgement binds ONLY when (a) an explicit done-phrase is heard AND (b) a reminder is
 * actually pending in its ack window. It never fires from the chime-in LLM or free-floating
 * ambient speech; the caller reads the bind back aloud so a mis-bind is audible + correctable.
 *
 * @module companion/reminders
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, appendFile, stat, rename } from 'node:fs/promises';
import { logger } from '../utils/logger.js';

/** A reminder definition (shape mirrors prospective-memory's Reminder; stored as JSON). */
export interface Reminder {
  id: string;
  /** Short name, e.g. "médicaments". */
  label: string;
  /** Spoken/sent text; defaults to a phrase built from the label. */
  message?: string;
  /** Local time of day, 'HH:MM'. */
  time: string;
  /** Days of week it applies (0=Sun … 6=Sat). Empty/undefined = every day. */
  days?: number[];
  enabled: boolean;
  createdAt: string;
  /** ISO of the last time it fired — used to fire once per daily occurrence. */
  lastFiredAt?: string;
  /** ISO of the last acknowledgement. */
  lastDoneAt?: string;
}

export type ReminderLogEvent = 'fired' | 'done' | 'missed' | 'renag';

function remindersFile(): string {
  return process.env.CODEBUDDY_REMINDERS_FILE || join(homedir(), '.codebuddy', 'reminders.json');
}
function logFile(): string {
  return process.env.CODEBUDDY_REMINDER_LOG_FILE || join(homedir(), '.codebuddy', 'companion', 'reminder-log.jsonl');
}

// ── store ─────────────────────────────────────────────────────────────

export async function loadReminders(): Promise<Reminder[]> {
  try {
    const raw = (await readFile(remindersFile(), 'utf8')).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.reminders) ? parsed.reminders : [];
    return list.filter((r: unknown): r is Reminder => !!r && typeof (r as Reminder).id === 'string');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.warn(`[reminders] could not read store: ${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }
}

export async function saveReminders(list: Reminder[]): Promise<void> {
  const file = remindersFile();
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(list, null, 2), 'utf8');
}

/** 'HH:MM' validator. */
export function isValidTime(t: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim());
}

export interface AddReminderInput {
  label: string;
  time: string;
  days?: number[];
  message?: string;
  now?: Date;
}

export async function addReminder(input: AddReminderInput): Promise<Reminder> {
  if (!input.label?.trim()) throw new Error('reminder needs a label');
  if (!isValidTime(input.time)) throw new Error(`invalid time '${input.time}' (expected HH:MM)`);
  const now = input.now ?? new Date();
  const reminder: Reminder = {
    id: `r-${now.getTime().toString(36)}-${Math.floor((now.getTime() % 1000) + 1).toString(36)}`,
    label: input.label.trim(),
    ...(input.message ? { message: input.message.trim() } : {}),
    time: input.time.trim(),
    ...(input.days && input.days.length ? { days: input.days } : {}),
    enabled: true,
    createdAt: now.toISOString(),
  };
  const list = await loadReminders();
  list.push(reminder);
  await saveReminders(list);
  return reminder;
}

export async function removeReminder(id: string): Promise<boolean> {
  const list = await loadReminders();
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return false;
  await saveReminders(next);
  return true;
}

export async function listReminders(): Promise<Reminder[]> {
  return loadReminders();
}

// ── due detection ─────────────────────────────────────────────────────

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Is the reminder due now (time reached today, right day, not already fired this occurrence)? */
export function isDue(r: Reminder, now: Date): boolean {
  if (!r.enabled) return false;
  if (r.days && r.days.length > 0 && !r.days.includes(now.getDay())) return false;
  const [h, m] = r.time.split(':').map(Number);
  if (h === undefined || m === undefined) return false;
  const occ = new Date(now);
  occ.setHours(h, m, 0, 0);
  if (now < occ) return false; // not yet time today
  if (r.lastFiredAt) {
    const lf = new Date(r.lastFiredAt);
    if (sameDay(lf, occ) && lf >= occ) return false; // already fired this occurrence
  }
  return true;
}

export async function dueReminders(now: Date): Promise<Reminder[]> {
  return (await loadReminders()).filter((r) => isDue(r, now));
}

// ── persistence of state transitions ──────────────────────────────────

export async function logReminderEvent(
  event: ReminderLogEvent,
  reminder: Pick<Reminder, 'id' | 'label'>,
  extra: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<void> {
  try {
    const file = logFile();
    await mkdir(join(file, '..'), { recursive: true });
    try {
      const info = await stat(file);
      if (info.size > 1024 * 1024) await rename(file, `${file}.1`);
    } catch {
      /* no file yet */
    }
    await appendFile(
      file,
      `${JSON.stringify({ ts: now.toISOString(), event, id: reminder.id, label: reminder.label, ...extra })}\n`,
      'utf8',
    );
  } catch (err) {
    logger.warn(`[reminders] could not log ${event}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function patchReminder(id: string, patch: Partial<Reminder>): Promise<Reminder | null> {
  const list = await loadReminders();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx]!, ...patch };
  await saveReminders(list);
  return list[idx]!;
}

export async function markFired(id: string, now: Date = new Date()): Promise<Reminder | null> {
  const r = await patchReminder(id, { lastFiredAt: now.toISOString() });
  if (r) await logReminderEvent('fired', r, {}, now);
  return r;
}

/** Enable/disable a reminder (admin). Returns the updated reminder, or null if not found. */
export async function setReminderEnabled(id: string, enabled: boolean): Promise<Reminder | null> {
  return patchReminder(id, { enabled });
}

export async function markDone(id: string, via: 'voice' | 'telegram' | 'cli', now: Date = new Date()): Promise<Reminder | null> {
  const r = await patchReminder(id, { lastDoneAt: now.toISOString() });
  if (r) await logReminderEvent('done', r, { via }, now);
  closeAck(id);
  return r;
}

// ── pending-ack registry (in-memory) ──────────────────────────────────
// Shared between the runner (which opens acks when a reminder fires) and the speech path
// (which matches "c'est fait"). A bare singleton: the daemon is one process.

interface PendingAck {
  id: string;
  label: string;
  firedAt: number;
  nags: number;
}
const pending = new Map<string, PendingAck>();

export function ackWindowMs(): number {
  const n = Number(process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : 300_000; // 5 min
}

export function openAck(reminder: Pick<Reminder, 'id' | 'label'>, nowMs: number): void {
  pending.set(reminder.id, { id: reminder.id, label: reminder.label, firedAt: nowMs, nags: 0 });
  void savePendingAcks();
}
export function closeAck(id: string): void {
  if (pending.delete(id)) void savePendingAcks();
}
export function bumpNag(id: string): number {
  const a = pending.get(id);
  if (!a) return 0;
  a.nags += 1;
  void savePendingAcks();
  return a.nags;
}
/** Pending acks still inside the window, newest first. */
export function pendingAcks(nowMs: number, windowMs = ackWindowMs()): PendingAck[] {
  return [...pending.values()].filter((a) => nowMs - a.firedAt < windowMs).sort((x, y) => y.firedAt - x.firedAt);
}
/** Expire (return + drop) acks whose window elapsed — the "missed" candidates. */
export function expireAcks(nowMs: number, windowMs = ackWindowMs()): PendingAck[] {
  const expired = [...pending.values()].filter((a) => nowMs - a.firedAt >= windowMs);
  for (const a of expired) pending.delete(a.id);
  if (expired.length) void savePendingAcks();
  return expired;
}
/** Test seam. */
export function resetAcks(): void {
  pending.clear();
}

// ── pending-ack PERSISTENCE (survive a restart mid-window — health safety) ──
// Without this, a `buddy server` restart between a reminder firing and the ack silently loses
// the pending ack: no re-nag, and — worse — NO `missed` log. The registry is mirrored to disk on
// every mutation and reloaded at runner start, so a fired-but-unacked dose still escalates.

function pendingAcksFile(): string {
  return (
    process.env.CODEBUDDY_REMINDER_PENDING_FILE || join(homedir(), '.codebuddy', 'companion', 'pending-acks.json')
  );
}

async function savePendingAcks(): Promise<void> {
  try {
    const file = pendingAcksFile();
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify([...pending.values()]), 'utf8');
  } catch (err) {
    logger.warn(`[reminders] could not persist pending acks: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Restore the pending-ack registry from disk (call at runner start). Never-throws. */
export async function loadPendingAcks(): Promise<void> {
  try {
    const raw = (await readFile(pendingAcksFile(), 'utf8')).trim();
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    for (const a of list) {
      if (a && typeof a.id === 'string' && Number.isFinite(a.firedAt)) {
        pending.set(a.id, {
          id: a.id,
          label: typeof a.label === 'string' ? a.label : a.id,
          firedAt: a.firedAt,
          nags: Number.isFinite(a.nags) ? a.nags : 0,
        });
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.warn(`[reminders] could not load pending acks: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── the safety-critical matcher ───────────────────────────────────────

/** Explicit, INTENTIONAL "I did it" phrases. Tightened hard because a false bind marks a dose
 *  taken and is uncorrectable: NO bare "fait"/"pris", no "c'est bon", no "oui … fait". "j'ai pris"
 *  binds only when terminal OR followed by a medication/object noun (so "j'ai pris mes clés" /
 *  "on a pris le train" / "c'est parfait" do NOT match). */
// Medication/object nouns confirming an intentional dose ack. May appear
// mid-sentence ("j'ai pris mes gouttes du soir"). NOTE: no bare articles here.
const MED_NOUN =
  '(?:le |la |les |mes? |mon |ma |du |de la )?(?:m[ée]dicaments?|comprim[ée]s?|cachets?|pilules?|traitement|gouttes?)';
const DONE_PHRASE = new RegExp(
  [
    "c'?est fait",
    "c'?est pris",
    // "j'ai pris" binds ONLY when: terminal, OR followed by a medication noun,
    // OR followed by a bare article/ça that is itself TERMINAL (elided object:
    // "j'ai pris le" / "j'ai pris ça"). A bare "le/la/les/ça" MID-sentence must
    // NOT bind — "j'ai pris le train" / "j'ai pris le métro ce matin" are not
    // dose acknowledgements, and a false bind marks a dose taken uncorrectably.
    // (`(?=\\s|[.,!?]|$)` not `\\b`: a noun ending in an accent like "comprimé"
    //  fails an ASCII `\\b`.)
    `j'?ai (?:bien )?pris(?=\\s*[.!?]?\\s*$|\\s+${MED_NOUN}(?=\\s|[.,!?]|$)|\\s+(?:le|la|les|[cç]a)\\s*[.!?]?\\s*$)`,
    "je l(?:es?)?'?ai pris(?=\\s*[.!?]?\\s*$)",
    '\\bdone\\b',
    '\\btaken\\b',
  ].join('|'),
  'i',
);

/**
 * Does this transcript acknowledge a pending reminder? Returns the reminder id to mark done, or
 * null. PURE (no mutation): binds ONLY when an explicit done-phrase is heard AND a reminder is
 * pending in its window. Multiple pending → the most-recently-fired (read-back disambiguates).
 */
export function matchAck(text: string, nowMs: number, windowMs = ackWindowMs()): string | null {
  if (!text || !DONE_PHRASE.test(text)) return null;
  const candidates = pendingAcks(nowMs, windowMs);
  return candidates[0]?.id ?? null;
}

/** Spoken confirmation read back after a bind, so a mis-bind is audible + correctable. */
export function reminderReadback(label: string): string {
  return `Ok, je note que c'est fait : ${label}.`;
}

/** The spoken/sent reminder text. */
export function reminderMessage(r: Reminder): string {
  return r.message?.trim() || `Patrice, c'est l'heure : ${r.label}.`;
}

const CREATE_VERB = /\b(rappelle[- ]?moi|rappelle moi|pense à me rappeler|note de)\b/i;

/**
 * Parse a spoken reminder-creation request ("rappelle-moi mes médicaments à 9h") into an
 * AddReminderInput, or null if it isn't one. Pure + deterministic (unit-testable without a mic).
 * Intentionally simple: needs a creation verb AND a parseable time.
 */
export function parseVoiceReminder(text: string): AddReminderInput | null {
  const t = (text ?? '').trim();
  if (!t || !CREATE_VERB.test(t)) return null;
  // NB: `\b` before "à" fails (à isn't an ASCII word char), so anchor on start/space instead.
  const tm = t.match(/(?:^|\s)(?:à|a)\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i) || t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!tm) return null;
  const hh = parseInt(tm[1]!, 10);
  const mm = tm[2] ? parseInt(tm[2], 10) : 0;
  if (hh > 23 || mm > 59) return null;
  const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const label =
    t
      .replace(CREATE_VERB, ' ')
      .replace(/(?:^|\s)(?:à|a)\s*\d{1,2}\s*(?:h|:)\s*\d{0,2}/i, ' ')
      .replace(/\b\d{1,2}:\d{2}\b/, ' ')
      .replace(/\b(de|d'|tous les jours|chaque jour|stp|s'il te pla[iî]t|mon|ma|mes)\b/gi, ' ')
      .replace(/[.,!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'rappel';
  return { label, time };
}
