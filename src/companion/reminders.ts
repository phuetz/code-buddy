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
  /**
   * ONE-SHOT date, local 'YYYY-MM-DD'. When set, the reminder is due ONLY on that calendar day
   * (recurrence is off — `days` is ignored) and the runner retires it after it fires. This is what
   * a real one-time event ("j'ai un train demain") needs: without it every reminder is a forever
   * daily. Absent ⇒ the legacy recurring-time-of-day behaviour, unchanged.
   */
  date?: string;
  /** Days of week it applies (0=Sun … 6=Sat). Empty/undefined = every day. Ignored when `date` is set. */
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

/** Strict 'YYYY-MM-DD' validator (real calendar day). */
export function isValidDate(d: string): boolean {
  const s = d.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, day] = s.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || day < 1 || day > 31) return false;
  const dt = new Date(y, m - 1, day);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day;
}

/** Local 'YYYY-MM-DD' key for a moment (used to match a one-shot's date against "today"). */
function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** True when the reminder is a one-shot (dated) rather than a recurring time-of-day. */
export function isOneShot(r: Reminder): boolean {
  return typeof r.date === 'string' && r.date.length > 0;
}

export interface AddReminderInput {
  label: string;
  time: string;
  /** One-shot local date 'YYYY-MM-DD' — makes this a single dated reminder, not a daily recurring. */
  date?: string;
  days?: number[];
  message?: string;
  now?: Date;
}

export async function addReminder(input: AddReminderInput): Promise<Reminder> {
  if (!input.label?.trim()) throw new Error('reminder needs a label');
  if (!isValidTime(input.time)) throw new Error(`invalid time '${input.time}' (expected HH:MM)`);
  if (input.date && !isValidDate(input.date)) throw new Error(`invalid date '${input.date}' (expected YYYY-MM-DD)`);
  const now = input.now ?? new Date();
  const reminder: Reminder = {
    id: `r-${now.getTime().toString(36)}-${Math.floor((now.getTime() % 1000) + 1).toString(36)}`,
    label: input.label.trim(),
    ...(input.message ? { message: input.message.trim() } : {}),
    time: input.time.trim(),
    // A dated one-shot ignores the weekly `days` mask (they're contradictory).
    ...(input.date ? { date: input.date.trim() } : input.days && input.days.length ? { days: input.days } : {}),
    enabled: true,
    createdAt: now.toISOString(),
  };
  const list = await loadReminders();
  // Anti-duplicate: saying the same thing twice must not stack identical reminders. An enabled
  // reminder with the same normalized label + time + cadence (date/days) is returned as-is.
  const dupe = list.find((r) => r.enabled && reminderKey(r) === reminderKey(reminder));
  if (dupe) {
    logger.info(`[reminders] duplicate ignored: "${reminder.label}" at ${reminder.time}`);
    return dupe;
  }
  list.push(reminder);
  await saveReminders(list);
  return reminder;
}

/** Identity key for de-duplication: normalized label + time + one-shot date + weekday mask. */
function reminderKey(r: Pick<Reminder, 'label' | 'time' | 'date' | 'days'>): string {
  return `${normLabel(r.label)}|${r.time}|${r.date ?? ''}|${(r.days ?? []).slice().sort((a, b) => a - b).join(',')}`;
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
  if (isOneShot(r)) {
    // A one-shot is due ONLY on its calendar date. A past date never fires (and the runner will
    // have retired it); this is what stops a one-time event from recurring every day.
    if (!isValidDate(r.date!) || localDateKey(now) !== r.date) return false;
  } else if (r.days && r.days.length > 0 && !r.days.includes(now.getDay())) {
    return false;
  }
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
  // For a RECURRING reminder, "done" acks only today's occurrence (a meds reminder must return
  // tomorrow — health safety). For a ONE-SHOT, "done" retires it for good (else "c'est fait" would
  // leave a dead dated reminder enabled). We read the pre-state to decide, then write once.
  const list = await loadReminders();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) {
    closeAck(id);
    return null;
  }
  const retire = isOneShot(list[idx]!);
  list[idx] = { ...list[idx]!, lastDoneAt: now.toISOString(), ...(retire ? { enabled: false } : {}) };
  await saveReminders(list);
  await logReminderEvent('done', list[idx]!, { via, ...(retire ? { retired: true } : {}) }, now);
  closeAck(id);
  return list[idx]!;
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

const FR_WEEKDAYS: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

/** Lowercase + strip diacritics (STT drops accents). */
function normFr(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
}

/**
 * Resolve a French RELATIVE date phrase to a local 'YYYY-MM-DD', or null if none is present.
 * Handles "aujourd'hui/ce soir/ce matin", "demain", "après-demain", a weekday name (next
 * occurrence), and "le N" (day-of-month, this month or next). Deterministic + pure (takes `now`).
 * Deliberately NARROW: only a clear future-date cue makes a reminder one-shot; anything else stays
 * a recurring time-of-day (so "rappelle-moi mes médicaments à 9h" is unchanged).
 */
export function parseRelativeFrenchDate(text: string, now: Date = new Date()): string | null {
  const t = normFr(text);
  const at = (base: Date, addDays: number): string => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays);
    return localDateKey(d);
  };
  if (/\bapres[- ]?demain\b/.test(t)) return at(now, 2);
  if (/\bdemain\b/.test(t)) return at(now, 1);
  if (/\b(aujourd'?hui|ce soir|ce matin|cet apres[- ]?midi|ce midi|tout a l'heure)\b/.test(t)) return at(now, 0);
  // "dans N jours" / "la semaine prochaine".
  const inDays = t.match(/\bdans\s+(\d+)\s+jours?\b/);
  if (inDays) {
    const n = parseInt(inDays[1]!, 10);
    if (n > 0 && n <= 365) return at(now, n);
  }
  if (/\b(la semaine prochaine|dans une semaine)\b/.test(t)) return at(now, 7);
  for (const [name, dow] of Object.entries(FR_WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      let ahead = (dow - now.getDay() + 7) % 7;
      if (ahead === 0) ahead = 7; // "jeudi" said on a Thursday → next Thursday
      return at(now, ahead);
    }
  }
  const dom = t.match(/\ble\s+(\d{1,2})\b/);
  if (dom) {
    const day = parseInt(dom[1]!, 10);
    if (day >= 1 && day <= 31) {
      // This month if the day is still ahead, else next month.
      let month = now.getMonth();
      let year = now.getFullYear();
      if (day <= now.getDate()) {
        month += 1;
        if (month > 11) {
          month = 0;
          year += 1;
        }
      }
      const d = new Date(year, month, day);
      if (d.getDate() === day) return localDateKey(d);
    }
  }
  return null;
}

/**
 * Parse a spoken reminder-creation request ("rappelle-moi mes médicaments à 9h") into an
 * AddReminderInput, or null if it isn't one. Pure + deterministic (unit-testable without a mic).
 * Intentionally simple: needs a creation verb AND a parseable time. A relative-date cue ("demain",
 * "jeudi") makes it a ONE-SHOT (`date` set); otherwise it stays a recurring time-of-day.
 */
export function parseVoiceReminder(text: string, now: Date = new Date()): AddReminderInput | null {
  const t = (text ?? '').trim();
  if (!t || !CREATE_VERB.test(t)) return null;
  // NB: `\b` before "à" fails (à isn't an ASCII word char), so anchor on start/space instead.
  // Accept the spelled-out "heure(s)" too — otherwise "à 9 heures" matched only
  // the "h" of "heures" and left "eures" in the label (a reminder named "eures").
  const tm = t.match(/(?:^|\s)(?:à|a)\s*(\d{1,2})\s*(?:h(?:eures?)?|:)\s*(\d{2})?/i) || t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!tm) return null;
  const hh = parseInt(tm[1]!, 10);
  const mm = tm[2] ? parseInt(tm[2], 10) : 0;
  if (hh > 23 || mm > 59) return null;
  // Lead time — "rappelle-moi 30 min AVANT mon train à 10h38" fires at 10h08 (event − lead), with a
  // label that says how far ahead. Only same-day (a lead crossing midnight keeps the event time).
  let fireH = hh;
  let fireM = mm;
  let leadLabel = '';
  const leadM = t.match(/(\d+)\s*(min|minute|minutes|h|heure|heures)\s+avant/i);
  if (leadM) {
    const nLead = parseInt(leadM[1]!, 10);
    const isHour = /^h/i.test(leadM[2]!);
    const total = hh * 60 + mm - (isHour ? nLead * 60 : nLead);
    if (total >= 0) {
      fireH = Math.floor(total / 60);
      fireM = total % 60;
      leadLabel = ` (dans ${nLead} ${isHour ? `heure${nLead > 1 ? 's' : ''}` : `minute${nLead > 1 ? 's' : ''}`})`;
    }
  }
  const time = `${String(fireH).padStart(2, '0')}:${String(fireM).padStart(2, '0')}`;
  const date = parseRelativeFrenchDate(t, now);
  const label =
    (t
      .replace(CREATE_VERB, ' ')
      .replace(/\b\d+\s*(?:min|minute|minutes|h|heure|heures)\s+avant\b/gi, ' ') // strip the lead phrase
      .replace(/(?:^|\s)(?:à|a)\s*\d{1,2}\s*(?:h(?:eures?)?|:)\s*\d{0,2}/i, ' ')
      .replace(/\b\d{1,2}:\d{2}\b/, ' ')
      // Strip the date cue too, so the label is "train", not "train demain".
      .replace(/\b(apr[èe]s[- ]?demain|demain|aujourd'?hui|ce soir|ce matin|cet apr[èe]s[- ]?midi|ce midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/gi, ' ')
      .replace(/\bdans\s+\d+\s+jours?\b/gi, ' ')
      .replace(/\b(la semaine prochaine|dans une semaine)\b/gi, ' ')
      .replace(/\ble\s+\d{1,2}\b/gi, ' ')
      .replace(/\b(de|d'|tous les jours|chaque jour|stp|s'il te pla[iî]t|mon|ma|mes)\b/gi, ' ')
      .replace(/[.,!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'rappel') + leadLabel;
  return { label, time, ...(date ? { date } : {}) };
}

// ── voice MANAGEMENT of reminders (list / remove / disable) ────────────
// So Patrice can say "supprime le rappel du train" instead of needing the CLI. The parse + fuzzy
// match + spoken-summary logic is pure/testable; `handleReminderVoiceCommand` wires it to the store.

/** Lowercase, strip diacritics + punctuation → clean word sequence (STT-friendly). */
function normLabel(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const REMINDER_LIST_RE =
  /\b(mes rappels|quels rappels|quels sont mes rappels|liste (les|mes) rappels|montre.{0,12}rappels|c est quoi mes rappels|combien de rappels)\b/;
const REMINDER_REMOVE_RE = /\b(oublie|annule|supprime|enleve|efface|retire)\b/;
const REMINDER_DISABLE_RE = /\b(desactive|coupe|suspends?|arrete)\b/;

export type ReminderCommand =
  | { kind: 'list' }
  | { kind: 'agenda'; days: number }
  | { kind: 'remove'; target: string }
  | { kind: 'disable'; target: string };

const REMINDER_AGENDA_RE =
  /\b(mon agenda|mon planning|qu est ce que j ai|qu ai je|quoi de prevu|ce qui est prevu|mes rendez vous|a venir|prochains rappels|prochains jours)\b/;

/** The label fragment after the word "rappel", stripped of stopwords ("du train" → "train"). */
function targetAfterRappel(t: string): string {
  const idx = t.indexOf('rappel');
  let rest = idx >= 0 ? t.slice(idx + 'rappel'.length) : t;
  rest = rest.replace(/^s\b/, ' '); // "rappels"
  return rest
    .replace(/\b(du|de|des|la|le|les|mon|ma|mes|pour|d|a|au|aux|ce|cet|cette)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a spoken reminder-MANAGEMENT command (list / remove / disable), or null. Deliberately does
 * NOT fire on a creation ("rappelle-moi …") or a bare verb without "rappel". Pure + testable.
 */
export function parseReminderCommand(text: string): ReminderCommand | null {
  const t = normLabel(text);
  if (!t) return null;
  const isRemove = REMINDER_REMOVE_RE.test(t);
  const isDisable = REMINDER_DISABLE_RE.test(t);
  // Agenda ("qu'est-ce que j'ai demain / cette semaine") — a calendar view by date.
  if (REMINDER_AGENDA_RE.test(t) && !isRemove && !isDisable && !CREATE_VERB.test(text)) {
    let days = 7;
    if (/\baujourd hui\b/.test(t)) days = 0;
    else if (/\bdemain\b/.test(t)) days = 1;
    return { kind: 'agenda', days };
  }
  // A pure query ("quels sont mes rappels") — but not when a remove/disable/create verb is present.
  if (REMINDER_LIST_RE.test(t) && !isRemove && !isDisable && !CREATE_VERB.test(text)) {
    return { kind: 'list' };
  }
  if (!/\brappel\b/.test(t)) return null; // remove/disable must target "le rappel …"
  if (isDisable) return { kind: 'disable', target: targetAfterRappel(t) };
  if (isRemove) return { kind: 'remove', target: targetAfterRappel(t) };
  return null;
}

/** True when the utterance is a reminder-management command (for the voice shortcut gate). */
export function isReminderVoiceCommand(text: string): boolean {
  return parseReminderCommand(text) !== null;
}

/** Find the reminder that best matches a spoken label fragment (token overlap + substring), or null. */
export function matchReminderByLabel(reminders: Reminder[], target: string): Reminder | null {
  const t = normLabel(target);
  if (!t) return null;
  const tTokens = new Set(t.split(' ').filter(Boolean));
  let best: Reminder | null = null;
  let bestScore = 0;
  for (const r of reminders) {
    const rl = normLabel(r.label);
    let overlap = 0;
    for (const tok of rl.split(' ')) if (tTokens.has(tok)) overlap++;
    const contains = rl.includes(t) || t.includes(rl) ? 2 : 0;
    const score = overlap + contains;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * A spoken cadence phrase for a reminder — "demain" / "aujourd'hui" / "le YYYY-MM-DD" for a one-shot,
 * "chaque lundi, mercredi" for a weekday mask, else "tous les jours". So the confirmation reads back
 * the RECURRENCE (a mis-captured "tous les jours" is now audible — the train-bug class of confusion).
 */
export function reminderCadencePhrase(r: Pick<Reminder, 'date' | 'days'>, now: Date = new Date()): string {
  if (r.date) {
    const today = localDateKey(now);
    const tomorrow = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    if (r.date === today) return "aujourd'hui";
    if (r.date === tomorrow) return 'demain';
    return `le ${r.date}`;
  }
  if (r.days?.length) {
    const names = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return `chaque ${r.days.map((d) => names[d]).filter(Boolean).join(', ')}`;
  }
  return 'tous les jours';
}

// ── AGENDA (a calendar view of upcoming reminder occurrences) ─────────

const FR_DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export interface AgendaEntry {
  id: string;
  label: string;
  /** Epoch ms of the occurrence (local). */
  at: number;
  time: string;
  recurring: boolean;
}

/** Local epoch ms for Y / month0 / day at HH:MM, or null if the time is malformed. */
function occurrenceAt(year: number, month0: number, day: number, time: string): number | null {
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined) return null;
  return new Date(year, month0, day, h, m, 0, 0).getTime();
}

/**
 * Upcoming reminder occurrences over the next `days` days, chronological. A one-shot dated reminder
 * appears once (on its day); a recurring reminder appears once per applicable day in the window
 * (respecting its weekday mask). Past occurrences and disabled reminders are skipped. Pure + testable.
 */
export function agendaFor(reminders: Reminder[], nowMs: number, days: number): AgendaEntry[] {
  const span = Math.max(0, Math.floor(days));
  const base = new Date(nowMs);
  // Window in CALENDAR days: from now through the END of the day `span` days ahead (so "demain" covers
  // ALL of tomorrow, not just now+24h). End-exclusive at the start of the day AFTER the last one.
  const windowEnd = new Date(base.getFullYear(), base.getMonth(), base.getDate() + span + 1, 0, 0, 0, 0).getTime();
  const out: AgendaEntry[] = [];
  for (const r of reminders) {
    if (!r.enabled || !isValidTime(r.time)) continue;
    if (isOneShot(r)) {
      if (!isValidDate(r.date!)) continue;
      const [y, mo, d] = r.date!.split('-').map(Number) as [number, number, number];
      const at = occurrenceAt(y, mo - 1, d, r.time);
      if (at != null && at >= nowMs && at < windowEnd) {
        out.push({ id: r.id, label: r.label, at, time: r.time, recurring: false });
      }
    } else {
      for (let offset = 0; offset <= span; offset++) {
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
        if (r.days && r.days.length > 0 && !r.days.includes(d.getDay())) continue;
        const at = occurrenceAt(d.getFullYear(), d.getMonth(), d.getDate(), r.time);
        if (at != null && at >= nowMs && at < windowEnd) {
          out.push({ id: r.id, label: r.label, at, time: r.time, recurring: true });
        }
      }
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 30);
}

/** A spoken summary of the upcoming agenda, using relative day words (aujourd'hui/demain) when close. */
export function describeAgendaForSpeech(agenda: AgendaEntry[], nowMs: number): string {
  if (agenda.length === 0) return "Tu n'as rien de prévu dans cette période.";
  const n = new Date(nowMs);
  const todayKey = localDateKey(n);
  const tomorrowKey = localDateKey(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1));
  const items = agenda.slice(0, 8).map((e) => {
    const d = new Date(e.at);
    const dk = localDateKey(d);
    const when = dk === todayKey ? "aujourd'hui" : dk === tomorrowKey ? 'demain' : FR_DAY_NAMES[d.getDay()];
    return `${e.label} ${when} à ${e.time}`;
  });
  const head = agenda.length === 1 ? 'Tu as un rappel à venir :' : `Tu as ${agenda.length} rappels à venir :`;
  const tail = agenda.length > 8 ? ` … et ${agenda.length - 8} autres.` : '.';
  return `${head} ${items.join(' ; ')}${tail}`;
}

/** A spoken summary of the active reminders (bounded), or a gentle "none" line. */
export function describeRemindersForSpeech(reminders: Reminder[]): string {
  const active = reminders.filter((r) => r.enabled);
  if (active.length === 0) return "Tu n'as aucun rappel actif pour le moment.";
  const items = active.slice(0, 8).map((r) => `${r.label} à ${r.time} ${reminderCadencePhrase(r)}`);
  const head = active.length === 1 ? 'Tu as un rappel :' : `Tu as ${active.length} rappels :`;
  const tail = active.length > 8 ? ` … et ${active.length - 8} autres.` : '.';
  return `${head} ${items.join(' ; ')}${tail}`;
}

export interface ReminderVoiceDeps {
  /** Speak a line aloud (required). */
  speak: (text: string) => Promise<void>;
  /** Store ops — default to the real store; injectable for tests. */
  list?: () => Promise<Reminder[]>;
  remove?: (id: string) => Promise<boolean>;
  disable?: (id: string) => Promise<Reminder | null>;
  /** Clock for the agenda window (tests). Default Date.now(). */
  now?: number;
}

/**
 * Handle a spoken reminder-management command end to end (parse → match → act → speak). Returns true
 * if the utterance WAS such a command (handled), false otherwise so the caller falls through to
 * create/ack/reply. Never-throws.
 */
export async function handleReminderVoiceCommand(text: string, deps: ReminderVoiceDeps): Promise<boolean> {
  const cmd = parseReminderCommand(text);
  if (!cmd) return false;
  try {
    const reminders = await (deps.list ?? listReminders)();
    if (cmd.kind === 'list') {
      await deps.speak(describeRemindersForSpeech(reminders));
      return true;
    }
    if (cmd.kind === 'agenda') {
      const now = deps.now ?? Date.now();
      await deps.speak(describeAgendaForSpeech(agendaFor(reminders, now, cmd.days), now));
      return true;
    }
    const match = matchReminderByLabel(reminders.filter((r) => r.enabled || cmd.kind === 'remove'), cmd.target);
    if (!match) {
      await deps.speak(cmd.target ? `Je ne trouve pas de rappel « ${cmd.target} ».` : 'De quel rappel parles-tu ?');
      return true;
    }
    if (cmd.kind === 'remove') {
      await (deps.remove ?? removeReminder)(match.id);
      await deps.speak(`C'est fait, j'ai supprimé le rappel : ${match.label}.`);
    } else {
      await (deps.disable ?? ((id: string) => setReminderEnabled(id, false)))(match.id);
      await deps.speak(`D'accord, j'ai désactivé le rappel : ${match.label}.`);
    }
  } catch (err) {
    logger.warn(`[reminders] voice command failed: ${err instanceof Error ? err.message : String(err)}`);
    await deps.speak('Je n\'ai pas réussi à modifier tes rappels, désolée.').catch(() => undefined);
  }
  return true;
}

// ── SNOOZE (defer a fired reminder) ───────────────────────────────────
// "rappelle-moi dans 10 minutes" / "plus tard" while a reminder is pending → re-announce it later
// instead of letting it re-nag then lapse to "missed".

/** Parse a snooze/defer delay (ms) from an utterance, or null. Bare defers default to 10 min. */
export function parseSnooze(text: string): number | null {
  const t = normLabel(text);
  if (!t) return null;
  const m = t.match(/\bdans\s+(\d+)\s*(min|minute|minutes|h|heure|heures)\b/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const ms = /^h/.test(m[2]!) ? n * 3600_000 : n * 60_000;
    return ms > 0 && ms <= 12 * 3600_000 ? ms : null;
  }
  if (/\b(plus tard|repousse|repousser|snooze|tout a l heure|un peu plus tard|dans un moment)\b/.test(t)) {
    return 10 * 60_000;
  }
  return null;
}

interface SnoozedReminder {
  id: string;
  label: string;
  fireAt: number;
}
const snoozes = new Map<string, SnoozedReminder>();

// Snoozes PERSIST (like the pending-ack registry): a `buddy server` restart between a "dans 10 min"
// deferral and its re-announce must NOT silently drop the reminder — for a meds dose that's a missed
// dose. Mirrored to disk on every mutation and reloaded at runner start.
function snoozesFile(): string {
  return (
    process.env.CODEBUDDY_REMINDER_SNOOZE_FILE || join(homedir(), '.codebuddy', 'companion', 'snoozes.json')
  );
}
async function saveSnoozes(): Promise<void> {
  try {
    const file = snoozesFile();
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify([...snoozes.values()]), 'utf8');
  } catch (err) {
    logger.warn(`[reminders] could not persist snoozes: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Restore the snooze registry from disk (call at runner start). Never-throws. */
export async function loadSnoozes(): Promise<void> {
  try {
    const raw = (await readFile(snoozesFile(), 'utf8')).trim();
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    for (const s of list) {
      if (s && typeof s.id === 'string' && Number.isFinite(s.fireAt)) {
        snoozes.set(s.id, { id: s.id, label: typeof s.label === 'string' ? s.label : s.id, fireAt: s.fireAt });
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.warn(`[reminders] could not load snoozes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Schedule a reminder to re-announce at `fireAtMs`. */
export function snoozeReminder(id: string, label: string, fireAtMs: number): void {
  snoozes.set(id, { id, label, fireAt: fireAtMs });
  void saveSnoozes();
}
/** Snoozed reminders now due to re-announce (returned + removed). */
export function dueSnoozes(nowMs: number): Array<{ id: string; label: string }> {
  const due = [...snoozes.values()].filter((s) => nowMs >= s.fireAt);
  for (const s of due) snoozes.delete(s.id);
  if (due.length) void saveSnoozes();
  return due.map((s) => ({ id: s.id, label: s.label }));
}
/** Test seam. */
export function resetSnoozes(): void {
  snoozes.clear();
}

/**
 * If `text` is a snooze AND a reminder is currently pending its ack, defer that reminder: close its
 * ack and schedule a re-announce. Returns the deferral (for the spoken confirmation) or null.
 */
export function snoozePending(text: string, nowMs: number): { id: string; label: string; delayMs: number } | null {
  const delayMs = parseSnooze(text);
  if (delayMs == null) return null;
  const target = pendingAcks(nowMs)[0]; // most-recently-fired pending
  if (!target) return null;
  closeAck(target.id);
  snoozeReminder(target.id, target.label, nowMs + delayMs);
  return { id: target.id, label: target.label, delayMs };
}

/** True when the utterance is a snooze AND a reminder is pending (for the voice shortcut gate). */
export function isSnoozeCommand(text: string, nowMs: number): boolean {
  return parseSnooze(text) != null && pendingAcks(nowMs).length > 0;
}

// ── UNDO (revert the just-created reminder) ───────────────────────────
// The confirm-and-await flow, ambient-style: the creation confirmation already
// reads the label + cadence back; a bare "annule" / "c'est pas ça" within the
// window removes what was just created — a natural spoken correction instead of
// a blocking "confirme ?" dialog. In-memory only: the window is short, and a
// server restart inside it simply forfeits the shortcut (unlike snoozes, no
// meds dose depends on it).

interface UndoableCreation {
  id: string;
  label: string;
  atMs: number;
}
let lastCreated: UndoableCreation | null = null;

/** How long a voice-created reminder stays revocable by a bare "annule" (default 2 min). */
export function undoWindowMs(): number {
  const n = Number(process.env.CODEBUDDY_REMINDER_UNDO_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/** Record a VOICE-created reminder as undo-able (call right after addReminder). */
export function noteCreatedForUndo(r: Pick<Reminder, 'id' | 'label'>, nowMs: number): void {
  lastCreated = { id: r.id, label: r.label, atMs: nowMs };
}

const UNDO_RE = /\b(annule|annuler|annule ca|efface|oublie|c est pas ca|pas ca|non non|je me suis trompe|erreur)\b/;

/**
 * Is this utterance a BARE spoken correction? A targeted "supprime le rappel du
 * train" is parseReminderCommand's job (the text contains "rappel"), and a long
 * sentence is conversation — only a short bare "annule"-class phrase counts.
 */
export function parseUndo(text: string): boolean {
  const t = normLabel(text);
  if (!t) return false;
  if (/\brappels?\b/.test(t)) return false; // targeted management, not a bare undo
  if (t.split(' ').filter(Boolean).length > 6) return false; // long → conversation
  return UNDO_RE.test(t);
}

/**
 * If `text` is a bare undo and a reminder was voice-created within the window,
 * consume the undo slot and return the creation to revert. Pure decision — the
 * caller performs the store removal + spoken confirmation.
 */
export function undoPending(text: string, nowMs: number): { id: string; label: string } | null {
  if (!parseUndo(text)) return null;
  if (!lastCreated || nowMs - lastCreated.atMs > undoWindowMs()) return null;
  const undone = { id: lastCreated.id, label: lastCreated.label };
  lastCreated = null;
  return undone;
}

/** True when the utterance would undo a fresh creation (for the voice shortcut gate). */
export function isUndoCommand(text: string, nowMs: number): boolean {
  return parseUndo(text) && lastCreated !== null && nowMs - lastCreated.atMs <= undoWindowMs();
}

/** Test seam. */
export function resetUndo(): void {
  lastCreated = null;
}
