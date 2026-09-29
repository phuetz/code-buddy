/**
 * Idle loop — what the companion usefully does when it's ALONE.
 *
 * The mirror of the presence loop: when no one's here, it does one useful thing per cycle. The
 * heart of this file is the SAFETY MODEL, because acting unattended is the one place the
 * conservative default isn't automatically protective.
 *
 * Safe by construction — an ALLOWLIST, not a denylist:
 *   When alone, the companion's default output is a REVIEWABLE ARTIFACT in the idle log ("here's
 *   what I noticed / drafted while you were away") — it changes NOTHING in your world. It may act
 *   without review ONLY for this tiny closed set:
 *     1. consolidate / journal memory,
 *     2. tidy temp + free disk + rotate companion logs,
 *     3. write a DRAFT to ~/.codebuddy/drafts/ (a reversible file),
 *     4. READ-ONLY status checks (git status, lint --check),
 *     5. assemble a brief from the above + reminders.
 *   Anything else → an artifact (a suggestion), never an action.
 *
 * Three hard NEVERs (unattended): no git writes / branches / PRs / fix-ci; no unbounded test/build
 * loops (the disk-guard lesson); no paid-model escalation ($0/local only). Plus: opt-in (default
 * OFF), alone-only, hourly + total caps, never during quiet hours. Never-throws; injectable.
 *
 * @module companion/idle-loop
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, appendFile, stat, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { isCanonicalDialogueHearingPercept } from './dialogue-percepts.js';
import type { CompanionPercept } from './percepts.js';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';

/** The closed allowlist of operations the idle loop may perform WITHOUT review (printable). */
export const IDLE_ACT_ALLOWLIST = [
  'journal-memory', // consolidate the day into a written summary
  'tidy-disk', // free temp + rotate companion logs
  'write-draft', // write a reversible file under ~/.codebuddy/drafts
  'read-status', // read-only git status / lint --check
  'assemble-brief', // compose a brief from the above + reminders
] as const;
export type IdleAct = (typeof IDLE_ACT_ALLOWLIST)[number];

export interface IdleArtifact {
  kind: 'journal' | 'status' | 'brief' | 'suggestion';
  title: string;
  body: string;
  /** A safe act this task performed (must be on IDLE_ACT_ALLOWLIST), or undefined if it only observed. */
  acted?: IdleAct;
}

export interface IdleCtx {
  now: Date;
  hour: number;
  /** Recent transcripts / percepts for the journal. */
  recentSummaries: string[];
  /** Read-only repo status lines (e.g. git porcelain). */
  repoStatus: string[];
  /** Due/today's reminders for the brief. */
  reminders: string[];
}

export interface IdleTask {
  id: string;
  /** Min gap before THIS task runs again. */
  cadenceMs: number;
  /** Produce an artifact (and optionally note a safe act it performed), or null if not due. */
  run: (ctx: IdleCtx) => IdleArtifact | null;
}

export interface IdleDeps {
  now?: () => Date;
  /** Is NO ONE here (the inverse of presence)? Default: presence-injector says absent. */
  isAlone?: () => boolean | Promise<boolean>;
  recentSummaries?: () => Promise<string[]>;
  repoStatus?: () => Promise<string[]>;
  reminders?: () => Promise<string[]>;
  /** Persist the artifact (default: append to the idle log). */
  record?: (item: IdleArtifact, now: Date) => Promise<void>;
  tasks?: IdleTask[];
  hourlyCap?: number;
  tickMs?: number;
}

// ── delivery: the "while you were away" log ───────────────────────────

function idleLogFile(): string {
  return process.env.CODEBUDDY_IDLE_LOG_FILE || getCodeBuddyPath('companion', 'idle-log.jsonl');
}

async function defaultRecord(item: IdleArtifact, now: Date): Promise<void> {
  try {
    const file = idleLogFile();
    await mkdir(join(file, '..'), { recursive: true });
    try {
      const info = await stat(file);
      if (info.size > 1024 * 1024) await rename(file, `${file}.1`);
    } catch {
      /* no file yet */
    }
    await appendFile(file, `${JSON.stringify({ ts: now.toISOString(), ...item })}\n`, 'utf8');
  } catch (err) {
    logger.warn(`[idle] could not record artifact: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── default context sources (all read-only / $0) ──────────────────────

async function defaultIsAlone(): Promise<boolean> {
  try {
    const { readPresenceContext } = await import('../memory/presence-injector.js');
    const p = await readPresenceContext();
    return !(p as { hasMatch?: boolean; hasUnknownFace?: boolean })?.hasMatch &&
      !(p as { hasUnknownFace?: boolean })?.hasUnknownFace;
  } catch {
    return false; // unknown → assume NOT alone (conservative: don't act)
  }
}

async function defaultRecentSummaries(): Promise<string[]> {
  try {
    const { readRecentCompanionPercepts } = await import('./percepts.js');
    // Read a wider bounded window so nearby ambient TV cannot hide older
    // canonical dialogue or non-hearing observations from the 12-item journal.
    const recent = await readRecentCompanionPercepts({ limit: 60 });
    return selectIdleJournalSummaries(recent);
  } catch {
    return [];
  }
}

/** Preserve non-hearing observations, but never journal rejected ambient speech as dialogue. */
export function selectIdleJournalSummaries(percepts: CompanionPercept[]): string[] {
  return percepts
    .filter(
      (percept) =>
        percept.modality !== 'hearing' || isCanonicalDialogueHearingPercept(percept)
    )
    .map((percept) => percept.summary)
    .filter(Boolean)
    .slice(0, 12);
}

/** READ-ONLY `git status --porcelain -b` (no writes, no network). Empty on any error. */
async function defaultRepoStatus(): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const child = spawn('git', ['status', '--porcelain=v1', '-b'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      const t = setTimeout(() => child.kill(), 5000);
      child.stdout.on('data', (d) => (out += String(d)));
      child.on('error', () => {
        clearTimeout(t);
        resolve([]);
      });
      child.on('close', () => {
        clearTimeout(t);
        resolve(out.split('\n').filter(Boolean).slice(0, 40));
      });
    } catch {
      resolve([]);
    }
  });
}

async function defaultReminders(): Promise<string[]> {
  try {
    const { listReminders } = await import('./reminders.js');
    return (await listReminders()).filter((r) => r.enabled !== false).map((r) => `${r.time} — ${r.label}`);
  } catch {
    return [];
  }
}

// ── default task library (all safe + $0: templates, no paid LLM) ──────

export const DEFAULT_IDLE_TASKS: IdleTask[] = [
  {
    id: 'journal',
    cadenceMs: 6 * 3600_000,
    run: (ctx) => {
      if (ctx.recentSummaries.length === 0) return null;
      const body = `Pendant que tu étais là aujourd'hui, j'ai noté :\n- ${ctx.recentSummaries.slice(0, 8).join('\n- ')}`;
      return { kind: 'journal', title: `Journal du ${ctx.now.toISOString().slice(0, 10)}`, body, acted: 'journal-memory' };
    },
  },
  {
    id: 'status',
    cadenceMs: 2 * 3600_000,
    run: (ctx) => {
      if (ctx.repoStatus.length === 0) return null;
      const branch = ctx.repoStatus.find((l) => l.startsWith('##')) ?? '';
      const changes = ctx.repoStatus.filter((l) => !l.startsWith('##'));
      const body =
        changes.length === 0
          ? `Repo propre. ${branch}`.trim()
          : `${changes.length} fichier(s) en cours. ${branch}\n${changes.slice(0, 15).join('\n')}`;
      return { kind: 'status', title: 'État du repo (lecture seule)', body, acted: 'read-status' };
    },
  },
  {
    id: 'brief',
    cadenceMs: 12 * 3600_000,
    run: (ctx) => {
      // Morning brief: only in the morning.
      if (ctx.hour < 6 || ctx.hour >= 11) return null;
      const parts: string[] = [];
      if (ctx.reminders.length) parts.push(`Rappels du jour : ${ctx.reminders.join(' ; ')}.`);
      if (ctx.repoStatus.filter((l) => !l.startsWith('##')).length) {
        parts.push(`Du travail en cours sur le repo (${ctx.repoStatus.filter((l) => !l.startsWith('##')).length} fichiers).`);
      }
      if (parts.length === 0) return null;
      return { kind: 'brief', title: 'Brief du matin', body: parts.join('\n'), acted: 'assemble-brief' };
    },
  },
];

// ── the conductor ─────────────────────────────────────────────────────

const lastRanByTask = new Map<string, number>();
let ranTimestamps: number[] = [];
export function resetIdleState(): void {
  lastRanByTask.clear();
  ranTimestamps = [];
}

function isQuietHour(hour: number): boolean {
  const spec = process.env.CODEBUDDY_COMPANION_QUIET || '22-8';
  const m = spec.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const [start, end] = [Number(m[1]), Number(m[2])];
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

function hourlyCap(deps: IdleDeps): number {
  if (deps.hourlyCap !== undefined) return deps.hourlyCap;
  const n = Number(process.env.CODEBUDDY_COMPANION_IDLE_HOURLY_CAP);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * One pass of the idle conductor. Exposed for tests (inject clock/gates/sources). Returns the
 * artifact it produced (or null when it stayed idle). Never-throws. $0 by construction — the tasks
 * assemble facts via templates; no paid model is ever called here.
 */
export async function runIdleTick(deps: IdleDeps = {}): Promise<IdleArtifact | null> {
  try {
    if (process.env.CODEBUDDY_COMPANION_IDLE !== 'true') return null;
    const now = (deps.now ?? (() => new Date()))();
    const hour = now.getHours();
    if (isQuietHour(hour)) return null; // not at night
    if (!(await (deps.isAlone ?? defaultIsAlone)())) return null; // ONLY when no one's here

    const nowMs = now.getTime();
    ranTimestamps = ranTimestamps.filter((t) => nowMs - t < 3600_000);
    if (ranTimestamps.length >= hourlyCap(deps)) return null;

    const ctx: IdleCtx = {
      now,
      hour,
      recentSummaries: await (deps.recentSummaries ?? defaultRecentSummaries)(),
      repoStatus: await (deps.repoStatus ?? defaultRepoStatus)(),
      reminders: await (deps.reminders ?? defaultReminders)(),
    };

    for (const task of deps.tasks ?? DEFAULT_IDLE_TASKS) {
      const last = lastRanByTask.get(task.id) ?? Number.NEGATIVE_INFINITY;
      if (nowMs - last < task.cadenceMs) continue;
      const artifact = task.run(ctx);
      if (!artifact) continue;
      // SAFETY: a task may only claim an act that's on the closed allowlist; anything else is a
      // bug → drop the act, keep the observation as a reviewable artifact (never an unlisted action).
      if (artifact.acted && !IDLE_ACT_ALLOWLIST.includes(artifact.acted)) {
        logger.warn(`[idle] task ${task.id} claimed non-allowlisted act '${artifact.acted}' → recorded as suggestion only`);
        artifact.acted = undefined;
        artifact.kind = 'suggestion';
      }
      lastRanByTask.set(task.id, nowMs);
      ranTimestamps.push(nowMs);
      await (deps.record ?? defaultRecord)(artifact, now);
      logger.info(`[idle] ${task.id} → ${artifact.kind}: ${artifact.title}`);
      return artifact;
    }
    return null;
  } catch (err) {
    logger.warn(`[idle] tick failed → nothing: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Start the idle loop on its own interval. Returns teardown. */
export function wireIdleLoop(deps: IdleDeps = {}): () => void {
  const tickMs = deps.tickMs ?? (Number(process.env.CODEBUDDY_COMPANION_IDLE_TICK_MS) || 600_000); // 10 min
  const timer = setInterval(() => {
    void runIdleTick(deps);
  }, tickMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`Companion idle: Enabled (tick ${Math.round(tickMs / 1000)}s, $0 only, artifacts to idle-log)`);
  return () => clearInterval(timer);
}
