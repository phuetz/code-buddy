/**
 * Event follow-ups — the "companion who remembers your day" loop. When Patrice mentions a dated
 * future event IN A CONVERSATION WITH LISA ("j'ai un gros déploiement jeudi"), we capture it and,
 * once the day has passed, Lisa proactively asks how it went ("alors, ce déploiement de jeudi ?").
 *
 * Mined from MySoulmate's `proactiveMessageService` followUp trigger + `autoMemoryService`
 * event capture, adapted to an always-on mic with two deliberate guards:
 *   - **capture only on addressed/engaged turns** (the caller wires this on `onHeard`, which only
 *     fires when the respond gate said yes) — NOT on every ambient/mistranscribed utterance, so
 *     Lisa never follows up on something she overheard from the TV;
 *   - **confirm at capture** (the caller speaks `confirmationLine()` right after) so a mis-heard
 *     capture is corrected immediately instead of ambushing Patrice days later.
 *
 * Extraction is an injectable seam (`EventExtractor`) — default is an LLM (a passive mention isn't a
 * command, so regex can't reliably find it), gated behind a cheap `hasFutureCue()` so the LLM only
 * runs when a future-time word is present. Store + due-logic are pure/deterministic and unit-tested.
 * Best-effort, never-throws. Opt-in via `CODEBUDDY_COMPANION_EVENT_FOLLOWUPS`.
 *
 * @module companion/event-followups
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger.js';

export interface EventFollowUp {
  id: string;
  /** Short label of the event ("le déploiement", "ton rendez-vous médecin"). */
  event: string;
  /** Epoch ms of the START of the event's day. */
  eventDayAt: number;
  /** Epoch ms when the follow-up becomes askable (the day AFTER the event). */
  dueAt: number;
  /** The spoken question Lisa asks once due. */
  followUp: string;
  createdAt: number;
  firedAt?: number;
}

/** What an extractor returns for a single captured event (pre-persistence). */
export interface EventCandidate {
  event: string;
  /** Epoch ms of the start of the event's day. */
  eventDayAt: number;
  followUp: string;
}

/** Pluggable extraction of a future event from an utterance. Default: an LLM (see below). */
export type EventExtractor = (text: string, nowMs: number) => Promise<EventCandidate | null>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Don't ask about an event that came due more than this long ago (Patrice was away → let it lapse). */
export const FOLLOWUP_GRACE_DAYS = 10;
/** Don't capture events further out than this (keeps the LLM's relative-date math honest). */
export const CAPTURE_HORIZON_DAYS = 21;

const FR_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/**
 * Cheap gate: does the utterance contain a future-time cue worth spending an LLM call on? Keeps
 * capture near-$0 on the vast majority of utterances that mention no schedule.
 */
export function hasFutureCue(text: string): boolean {
  return /\b(demain|apr[eè]s-?demain|ce soir|cet apr[eè]s-midi|tout à l'heure|la semaine prochaine|le week-?end|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|dans\s+\d+\s*(?:min|minutes?|heures?|h|jours?|semaines?)|à\s*\d{1,2}\s*h|le\s+\d{1,2}\b)/i.test(
    text ?? '',
  );
}

// ── store ─────────────────────────────────────────────────────────────

function defaultStatePath(): string {
  return (
    process.env.CODEBUDDY_EVENT_FOLLOWUPS_FILE ||
    join(homedir(), '.codebuddy', 'companion', 'event-followups.json')
  );
}

function isEventFollowUp(value: unknown): value is EventFollowUp {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.event === 'string' &&
    typeof entry.eventDayAt === 'number' &&
    typeof entry.dueAt === 'number' &&
    typeof entry.followUp === 'string' &&
    typeof entry.createdAt === 'number' &&
    (entry.firedAt === undefined || typeof entry.firedAt === 'number')
  );
}

export function loadEventFollowUps(statePath = defaultStatePath()): EventFollowUp[] {
  let raw: string;
  try {
    raw = readFileSync(statePath, 'utf8').trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    logger.warn(
      `[event-followups] could not read store: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }
  if (!raw) {
    const msg = `[event-followups] store exists but is empty: ${statePath}`;
    logger.warn(msg);
    throw new Error(msg);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[event-followups] could not parse store: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }
  if (!Array.isArray(parsed)) {
    const msg = `[event-followups] store is not a list: ${statePath}`;
    logger.warn(msg);
    throw new Error(msg);
  }
  const items: EventFollowUp[] = [];
  for (const entry of parsed) {
    if (!isEventFollowUp(entry)) {
      const msg = `[event-followups] store has an invalid entry: ${statePath}`;
      logger.warn(msg);
      throw new Error(msg);
    }
    items.push(entry);
  }
  return items;
}

export function saveEventFollowUps(items: EventFollowUp[], statePath = defaultStatePath()): boolean {
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify(items));
    try {
      renameSync(temporaryPath, statePath);
    } catch {
      writeFileSync(statePath, JSON.stringify(items));
      try {
        unlinkSync(temporaryPath);
      } catch {
        /* already moved/removed */
      }
    }
    return true;
  } catch (err) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      /* best effort cleanup */
    }
    logger.warn(
      `[event-followups] could not persist store: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

/** Add a captured event to the store, returning the persisted follow-up. */
export function addFollowUp(candidate: EventCandidate, nowMs: number, statePath = defaultStatePath()): EventFollowUp {
  const items = loadEventFollowUps(statePath);
  const followUp: EventFollowUp = {
    id: randomBytes(6).toString('hex'),
    event: candidate.event,
    eventDayAt: candidate.eventDayAt,
    dueAt: candidate.eventDayAt + DAY_MS, // ask the day AFTER the event
    followUp: candidate.followUp,
    createdAt: nowMs,
  };
  items.push(followUp);
  if (!saveEventFollowUps(items, statePath)) {
    throw new Error(`[event-followups] could not persist ${statePath}`);
  }
  return followUp;
}

/**
 * The earliest un-fired follow-up that's due now and not yet stale. Prunes (marks fired) anything
 * that came due more than FOLLOWUP_GRACE_DAYS ago so Lisa never asks about a month-old event.
 */
export function dueFollowUp(nowMs: number, statePath = defaultStatePath()): EventFollowUp | null {
  const items = loadEventFollowUps(statePath);
  const graceMs = FOLLOWUP_GRACE_DAYS * DAY_MS;
  let changed = false;
  const fresh: EventFollowUp[] = [];
  for (const e of items) {
    if (e.firedAt == null && nowMs - e.dueAt > graceMs) {
      e.firedAt = nowMs; // too stale — retire silently
      changed = true;
    }
    fresh.push(e);
  }
  if (changed) saveEventFollowUps(fresh, statePath);
  return (
    fresh
      .filter((e) => e.firedAt == null && e.dueAt <= nowMs)
      .sort((a, b) => a.dueAt - b.dueAt)[0] ?? null
  );
}

export function markFired(id: string, nowMs: number, statePath = defaultStatePath()): void {
  const items = loadEventFollowUps(statePath);
  const e = items.find((x) => x.id === id);
  if (e && e.firedAt == null) {
    e.firedAt = nowMs;
    saveEventFollowUps(items, statePath);
  }
}

// ── capture ───────────────────────────────────────────────────────────

/** A short FR day label for the confirmation line ("demain" / "jeudi" / "le 15"). */
function frDayLabel(eventDayMs: number, nowMs: number): string {
  const gapDays = Math.round((startOfDay(eventDayMs) - startOfDay(nowMs)) / DAY_MS);
  if (gapDays === 1) return 'demain';
  if (gapDays >= 2 && gapDays <= 6) return FR_WEEKDAYS[new Date(eventDayMs).getDay()] ?? 'bientôt';
  const d = new Date(eventDayMs);
  return `le ${d.getDate()}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The confirmation Lisa speaks right after capture, so a mis-heard event is corrected on the spot. */
export function confirmationLine(followUp: EventFollowUp, nowMs: number): string {
  return `D'accord — je penserai à te redemander après ${frDayLabel(followUp.eventDayAt, nowMs)} comment s'est passé ${followUp.event}.`;
}

/**
 * Capture a future-event follow-up from an utterance heard IN a conversation with Lisa. Gated by
 * `hasFutureCue`, then the (LLM) extractor, then a sanity window (future, within CAPTURE_HORIZON).
 * Returns the persisted follow-up (so the caller can confirm it aloud), or null. Never throws.
 */
export async function captureEventFollowUp(
  text: string,
  nowMs: number,
  opts: { extractor: EventExtractor; statePath?: string },
): Promise<EventFollowUp | null> {
  try {
    if (!hasFutureCue(text)) return null;
    const candidate = await opts.extractor(text, nowMs);
    if (!candidate || !candidate.event?.trim() || !Number.isFinite(candidate.eventDayAt)) return null;
    const eventDay = startOfDay(candidate.eventDayAt);
    const today = startOfDay(nowMs);
    // Must be in the future and within the capture horizon — rejects past dates and LLM hallucinated
    // far-future dates (both common when the STT text is noisy).
    if (eventDay < today || eventDay - today > CAPTURE_HORIZON_DAYS * DAY_MS) return null;
    return addFollowUp({ ...candidate, eventDayAt: eventDay }, nowMs, opts.statePath);
  } catch (err) {
    logger.warn(`[event-followup] capture failed → skipped: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── default LLM extractor ───────────────────────────────────────────────

/**
 * Default extractor: a cheap LLM pass that returns a dated future event or nothing. A passive
 * mention ("j'ai un déploiement jeudi") isn't a command, so this is genuinely an LLM job; the
 * `hasFutureCue` gate keeps it from running on most utterances.
 */
export function makeLLMEventExtractor(): EventExtractor {
  return async (text: string, nowMs: number): Promise<EventCandidate | null> => {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const { resolveVoiceModel } = await import('../sensory/voice-loop.js');
    const route = await resolveVoiceModel(text);
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    const today = new Date(nowMs);
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const weekday = FR_WEEKDAYS[today.getDay()];
    const sys =
      "Tu extrais UN événement FUTUR daté mentionné par l'utilisateur, pour qu'un assistant puisse lui " +
      'redemander APRÈS comment ça s\'est passé. Réponds STRICTEMENT en JSON, rien d\'autre : ' +
      '{"event": "libellé court", "whenISO": "YYYY-MM-DD", "followUp": "question courte en français"} ' +
      's\'il y a un événement futur avec une date/jour identifiable ; sinon {"event": null}. ' +
      `Aujourd'hui = ${weekday} ${todayISO}. Résous les dates relatives (demain, jeudi, la semaine prochaine) par rapport à ça.`;
    const resp = await client.chat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ] as never,
      [],
    );
    const raw = (resp?.choices?.[0]?.message?.content ?? '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let parsed: { event?: string | null; whenISO?: string; followUp?: string };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
    if (!parsed.event || !parsed.whenISO) return null;
    const when = new Date(`${parsed.whenISO}T00:00:00`);
    if (Number.isNaN(when.getTime())) return null;
    const event = parsed.event.trim();
    return {
      event,
      eventDayAt: when.getTime(),
      followUp: (parsed.followUp?.trim() || `Alors, comment s'est passé ${event} ?`),
    };
  };
}
