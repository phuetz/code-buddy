/** Local, append-only record of Lisa's autonomous decisions and actions. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getCompanionConductor } from './orchestrator.js';
import { resolveAwayClock } from './away-mode.js';
import type { PresenceContext } from '../memory/presence-injector.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import type { LisaPulseEvent } from './lisa-pulse.js';

export interface LisaJournalEntry {
  id: string;
  at: string;
  kind: LisaPulseEvent['kind'];
  what: string;
  why: string;
  result?: string;
  mandateId?: string;
  checkpointId?: string;
}

export function lisaJournalPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEBUDDY_LISA_JOURNAL_FILE || path.join(os.homedir(), '.codebuddy', 'lisa', 'journal.jsonl');
}

function safeText(input: string, max: number): string {
  return input.replace(/[\p{Cc}]+/gu, ' ').slice(0, max);
}

export function appendLisaJournal(event: LisaPulseEvent, file = lisaJournalPath()): LisaJournalEntry {
  const entry: LisaJournalEntry = {
    id: randomUUID(), at: new Date().toISOString(), kind: event.kind,
    what: safeText(event.action?.tool ?? event.kind, 100),
    why: safeText(event.reason, 500),
    ...(event.result ? { result: safeText(event.result, 1000) } : {}),
    ...(event.mandateId ? { mandateId: safeText(event.mandateId, 100) } : {}),
    ...(event.checkpointId ? { checkpointId: event.checkpointId } : {}),
  };
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && !stat.isFile()) throw new Error('Lisa journal is not a regular file');
  if (stat && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('Lisa journal permissions are too broad');
  }
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(entry)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return entry;
}

export function readLisaJournal(file = lisaJournalPath()): LisaJournalEntry[] {
  if (!fs.existsSync(file)) return [];
  if (!fs.lstatSync(file).isFile()) throw new Error('Lisa journal is not a regular file');
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
    const value = JSON.parse(line) as LisaJournalEntry;
    if (!value || typeof value.id !== 'string' || typeof value.at !== 'string' ||
        typeof value.kind !== 'string' || typeof value.why !== 'string') {
      throw new Error('Invalid Lisa journal entry');
    }
    return value;
  });
}

export function todayLisaJournal(now = Date.now(), file = lisaJournalPath()): LisaJournalEntry[] {
  const date = resolveAwayClock(now).localDate;
  return readLisaJournal(file).filter(item => resolveAwayClock(new Date(item.at).getTime()).localDate === date);
}

export function summarizeLisaDay(now = Date.now(), file = lisaJournalPath()): string {
  const entries = todayLisaJournal(now, file);
  const actions = entries.filter(item => item.kind === 'action');
  const failures = entries.filter(item => item.kind === 'failure');
  const decisions = entries.filter(item => item.kind === 'decision_required');
  const lines = [`Lisa aujourd’hui : ${actions.length} action(s) autonome(s), ${failures.length} échec(s), ${decisions.length} décision(s) en attente.`];
  for (const item of [...actions, ...failures, ...decisions].slice(-10)) {
    lines.push(`${item.kind === 'action' ? 'Fait' : item.kind === 'failure' ? 'Échec' : 'À décider'} : ${item.what} — ${item.why}${item.checkpointId ? ` (retour ${item.checkpointId})` : ''}`);
  }
  return lines.join('\n');
}

export function isLisaJournalQuestion(heard: string): boolean {
  const text = heard.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return /(?:qu as tu fait|tu as fait quoi|qu est ce que tu as fait).{0,30}aujourd hui/.test(text);
}

/** A configured owner match, not an arbitrary recognized face, is needed for speech. */
export function hasLisaOwnerPresence(context: PresenceContext, env: NodeJS.ProcessEnv = process.env): boolean {
  const ownerName = env.CODEBUDDY_LISA_OWNER_FACE_NAME?.trim().toLocaleLowerCase();
  return Boolean(ownerName && context.hasMatch && context.name?.trim().toLocaleLowerCase() === ownerName);
}

interface SummaryState { date?: string }
export interface LisaSummaryDependencies {
  now?: () => number;
  isPresent?: () => Promise<boolean>;
  say?: (text: string) => Promise<boolean>;
  telegram?: (text: string) => Promise<boolean>;
  statePath?: string;
  journalPath?: string;
}

/** Delivery is attempted only in the evening and marked only after a confirmed send. */
export async function maybeDeliverLisaEveningSummary(deps: LisaSummaryDependencies = {}): Promise<boolean> {
  if (process.env.CODEBUDDY_LISA_JOURNAL !== 'true') return false;
  const now = (deps.now ?? Date.now)();
  const clock = resolveAwayClock(now);
  if (clock.hour < 20 || clock.hour >= 22) return false;
  const statePath = deps.statePath ?? path.join(os.homedir(), '.codebuddy', 'lisa', 'summary-state.json');
  const state = readJsonAtomicSync<SummaryState>(statePath, {}, {
    mode: 0o600,
    isValid: (value): value is SummaryState => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  });
  if (state.date === clock.localDate) return false;
  const text = summarizeLisaDay(now, deps.journalPath);
  const isPresent = deps.isPresent ?? (async () => {
    try {
      const { readPresenceContext } = await import('../memory/presence-injector.js');
      return hasLisaOwnerPresence(await readPresenceContext());
    } catch { return false; }
  });
  let delivered = false;
  if (await isPresent()) {
    if (!getCompanionConductor().claim('proactive')) return false;
    appendLisaJournal({ kind: 'summary_started', reason: 'Evening summary by voice' }, deps.journalPath);
    const say = deps.say ?? (async (line: string) => {
      const { sayNow } = await import('../sensory/voice-loop.js');
      return sayNow(line, { phoneDelivery: 'never' });
    });
    delivered = await say(text);
  } else {
    appendLisaJournal({ kind: 'summary_started', reason: 'Evening summary by Telegram' }, deps.journalPath);
    const telegram = deps.telegram ?? (async (line: string) => {
      const { sendTelegramAlert } = await import('../sensory/alert.js');
      return sendTelegramAlert(line);
    });
    delivered = await telegram(text);
  }
  if (!delivered) {
    appendLisaJournal({ kind: 'failure', reason: 'Evening summary delivery failed' }, deps.journalPath);
    return false;
  }
  appendLisaJournal({ kind: 'summary', reason: 'Evening summary delivered' }, deps.journalPath);
  writeJsonAtomicSync(statePath, { date: clock.localDate }, { mode: 0o600 });
  return true;
}
