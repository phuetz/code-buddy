/**
 * Skill activity telemetry (comparatif plan P2).
 *
 * Records when a skill is VIEWED (`skill_view`, `skill_manage view`) or USED
 * (matched into a turn, executed by `SkillExecutor`). It covers every skill
 * tier — bundled, managed, workspace, imported and authored — keyed by skill
 * name, independently of the Skills Hub lockfile (hub-installed only) and of
 * the learning score store (`.codebuddy/learning/skill-usage.json`, which
 * scores run outcomes and must not count a mere view as a success).
 *
 * Storage contract:
 * - append-only JSONL (`events.jsonl`), one small line per event, written with
 *   O_APPEND so concurrent processes never lose an increment (lines stay far
 *   below PIPE_BUF; no read-modify-write);
 * - reads are strictly read-only and skip malformed/truncated lines;
 * - recording never throws and never touches SKILL.md; an unwritable store
 *   logs one warning per process and the calling tool still succeeds.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export type SkillActivityKind = 'view' | 'use';

export interface SkillActivityEvent {
  v: 1;
  skill: string;
  kind: SkillActivityKind;
  at: string;
  source?: string;
}

export interface SkillActivitySummary {
  skill: string;
  viewCount: number;
  useCount: number;
  lastViewedAt?: string;
  lastUsedAt?: string;
  /** Latest of lastViewedAt / lastUsedAt. */
  lastActivityAt: string;
}

export interface SkillActivityOptions {
  /** Store directory override (tests). Defaults to CODEBUDDY_SKILL_USAGE_DIR or ~/.codebuddy/skill-usage. */
  dir?: string;
  now?: Date;
  source?: string;
}

const MAX_NAME_LENGTH = 200;
const MAX_SOURCE_LENGTH = 64;
let warnedUnwritable = false;

export function getSkillUsageDir(dir?: string): string {
  return path.resolve(dir ?? process.env.CODEBUDDY_SKILL_USAGE_DIR ?? path.join(os.homedir(), '.codebuddy', 'skill-usage'));
}

function eventsPath(dir?: string): string {
  return path.join(getSkillUsageDir(dir), 'events.jsonl');
}

/** Append one activity event. Returns false (never throws) when it could not be recorded. */
export function recordSkillActivity(
  skillName: string,
  kind: SkillActivityKind,
  options: SkillActivityOptions = {},
): boolean {
  const skill = typeof skillName === 'string' ? skillName.trim() : '';
  if (!skill || skill.length > MAX_NAME_LENGTH || /[\r\n]/.test(skill)) return false;
  const event: SkillActivityEvent = {
    v: 1,
    skill,
    kind,
    at: (options.now ?? new Date()).toISOString(),
    ...(options.source ? { source: options.source.slice(0, MAX_SOURCE_LENGTH) } : {}),
  };
  try {
    const file = eventsPath(options.dir);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'a' });
    return true;
  } catch (error) {
    if (!warnedUnwritable) {
      warnedUnwritable = true;
      logger.warn('Skill activity telemetry is not writable; skill tools keep working without it', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }
}

function isEvent(value: unknown): value is SkillActivityEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return e.v === 1
    && typeof e.skill === 'string'
    && (e.kind === 'view' || e.kind === 'use')
    && typeof e.at === 'string'
    && !Number.isNaN(Date.parse(e.at));
}

/** Aggregate all recorded events by skill name. Read-only; malformed lines are ignored. */
export function readSkillActivity(options: Pick<SkillActivityOptions, 'dir'> = {}): Map<string, SkillActivitySummary> {
  const summaries = new Map<string, SkillActivitySummary>();
  let contents = '';
  try {
    contents = fs.readFileSync(eventsPath(options.dir), 'utf8');
  } catch {
    return summaries;
  }
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isEvent(parsed)) continue;
    const current = summaries.get(parsed.skill) ?? {
      skill: parsed.skill,
      viewCount: 0,
      useCount: 0,
      lastActivityAt: parsed.at,
    };
    if (parsed.kind === 'view') {
      current.viewCount += 1;
      if (!current.lastViewedAt || parsed.at > current.lastViewedAt) current.lastViewedAt = parsed.at;
    } else {
      current.useCount += 1;
      if (!current.lastUsedAt || parsed.at > current.lastUsedAt) current.lastUsedAt = parsed.at;
    }
    if (parsed.at > current.lastActivityAt) current.lastActivityAt = parsed.at;
    summaries.set(parsed.skill, current);
  }
  return summaries;
}

/** Most recently active first. */
export function listSkillActivity(options: Pick<SkillActivityOptions, 'dir'> = {}): SkillActivitySummary[] {
  return [...readSkillActivity(options).values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export function resetSkillActivityWarningForTests(): void {
  warnedUnwritable = false;
}
