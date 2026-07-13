/**
 * Sensory rules engine — declarative event→action.
 *
 * Loads `~/.codebuddy/sensory-rules.json`, subscribes to `sensory:perception`,
 * matches each event (kind / payload filters / time-of-day window), respects a
 * per-rule cooldown, and dispatches to the action executor. Every firing is
 * audit-logged to `~/.codebuddy/companion/rule-runs.jsonl`. The security model
 * (injection-safe context, destructive-block) lives in sensory-action-executor.
 *
 * @module sensory/sensory-rules-engine
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, appendFile, mkdir, stat, rename, rm } from 'node:fs/promises';
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';
import {
  executeSensoryAction,
  isDestructive,
  type ActionResult,
  type SensoryAction,
  type SensoryEventContext,
} from './sensory-action-executor.js';

export interface SensoryRule {
  id: string;
  name?: string;
  enabled?: boolean;
  match: { modality?: string; kind: string; filters?: Record<string, string>; between?: [string, string] };
  action: SensoryAction;
  cooldownMs?: number;
}

// Path helpers read env at call-time (test isolation), mirroring reminders.ts.
function rulesPath(): string {
  return process.env.CODEBUDDY_SENSORY_RULES_FILE || join(homedir(), '.codebuddy', 'sensory-rules.json');
}
function auditPath(): string {
  return process.env.CODEBUDDY_RULE_RUNS_FILE || join(homedir(), '.codebuddy', 'companion', 'rule-runs.jsonl');
}

const RULE_RUNS_MAX_BYTES = 512 * 1024;

/** Append one rule audit entry while keeping the sidecar bounded to one backup. */
export async function appendRuleRun(run: RuleRun, path = auditPath()): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  let size = 0;
  try {
    size = (await stat(path)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (size > RULE_RUNS_MAX_BYTES) {
    await rm(`${path}.1`, { force: true });
    await rename(path, `${path}.1`);
  }
  await appendFile(path, `${JSON.stringify(run)}\n`, 'utf8');
}

export async function loadSensoryRules(path = rulesPath()): Promise<SensoryRule[]> {
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as { rules?: SensoryRule[] } | SensoryRule[];
    const rules = Array.isArray(data) ? data : (data.rules ?? []);
    return rules.filter((r) => r && r.match?.kind && r.action?.type);
  } catch {
    return [];
  }
}

// ── admin CRUD-lite (the surface `buddy rules` / Cowork call) ──────────

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Validate a rule BEFORE persisting — the same destructive gate the executor uses at fire-time,
 *  moved earlier so a dangerous shell/agent rule is rejected on save, not discovered at 3am. */
export function validateRule(rule: SensoryRule): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!rule || typeof rule.id !== 'string' || !rule.id.trim()) errors.push('rule needs a non-empty id');
  if (!rule?.match?.kind) errors.push('rule.match.kind is required');
  const b = rule?.match?.between;
  if (b && (!Array.isArray(b) || b.length !== 2 || !HHMM.test(b[0]) || !HHMM.test(b[1])))
    errors.push('match.between must be [HH:MM, HH:MM]');
  const a = rule?.action;
  if (!a?.type) errors.push('action.type is required');
  else if (a.type === 'shell') {
    if (!a.command?.trim()) errors.push('shell action needs a command');
    else if (isDestructive(a.command)) errors.push(`shell command rejected (destructive): ${a.command.slice(0, 60)}`);
  } else if (a.type === 'agent') {
    if (!a.prompt?.trim()) errors.push('agent action needs a prompt');
  } else if (a.type === 'webhook') {
    if (!/^https?:\/\//i.test(a.url ?? '')) errors.push('webhook url must start with http(s)://');
  } else if (a.type !== 'alert') {
    errors.push(`unknown action.type '${(a as { type?: string }).type}'`);
  }
  return { ok: errors.length === 0, errors };
}

export async function saveSensoryRules(rules: SensoryRule[], path = rulesPath()): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(rules, null, 2), 'utf8');
}

export const listSensoryRules = loadSensoryRules;

/** Add or replace a rule by id. Rejects (no write) when invalid. */
export async function upsertSensoryRule(rule: SensoryRule): Promise<{ ok: boolean; errors: string[] }> {
  const v = validateRule(rule);
  if (!v.ok) return v;
  const rules = await loadSensoryRules();
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) rules[idx] = rule;
  else rules.push(rule);
  await saveSensoryRules(rules);
  return { ok: true, errors: [] };
}

/** Enable/disable a rule. Returns false if the id wasn't found. */
export async function toggleSensoryRule(id: string, enabled: boolean): Promise<boolean> {
  const rules = await loadSensoryRules();
  const r = rules.find((x) => x.id === id);
  if (!r) return false;
  r.enabled = enabled;
  await saveSensoryRules(rules);
  return true;
}

/** Delete a rule. Returns false if the id wasn't found. */
export async function removeSensoryRule(id: string): Promise<boolean> {
  const rules = await loadSensoryRules();
  const next = rules.filter((r) => r.id !== id);
  if (next.length === rules.length) return false;
  await saveSensoryRules(next);
  return true;
}

export interface RuleRun {
  ts: number;
  rule: string;
  action: string;
  kind?: string;
  ok: boolean;
  detail?: string | null;
}

/** Recent rule fires (newest first) from the audit log — the observe surface. */
export async function readRuleRuns(limit = 20): Promise<RuleRun[]> {
  try {
    const raw = await readFile(auditPath(), 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l) as RuleRun;
        } catch {
          return null;
        }
      })
      .filter((x): x is RuleRun => x !== null);
  } catch {
    return [];
  }
}

/** Is `now` (local HH:MM) within [start,end], wrapping past midnight (e.g. 22:00→06:00)? */
export function withinWindow(now: Date, between?: [string, string]): boolean {
  if (!between) return true;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = toMin(between[0]);
  const b = toMin(between[1]);
  return a <= b ? cur >= a && cur <= b : cur >= a || cur <= b;
}

export function ruleMatches(
  rule: SensoryRule,
  p: { modality?: string; kind?: string; payload?: unknown },
  now: Date,
): boolean {
  if (rule.enabled === false) return false;
  if (rule.match.modality && rule.match.modality !== p.modality) return false;
  if (rule.match.kind !== p.kind) return false;
  if (!withinWindow(now, rule.match.between)) return false;
  if (rule.match.filters) {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(rule.match.filters)) {
      if (String(payload[k] ?? '') !== String(v)) return false;
    }
  }
  return true;
}

export function wireSensoryRules(
  options: {
    rules?: SensoryRule[];
    now?: () => number;
    /** Throttle for the mtime-cached hot-reload stat (ms). Default 2000. 0 = check every event. */
    reloadThrottleMs?: number;
    /** Injectable action executor (tests). Default: executeSensoryAction. */
    execute?: (action: SensoryAction, ctx: SensoryEventContext) => Promise<ActionResult>;
  } = {},
): () => void {
  const bus = getGlobalEventBus();
  const now = options.now ?? (() => Date.now());
  const execute = options.execute ?? executeSensoryAction;
  // When rules are injected (tests for matching) we don't touch the file. Otherwise we load once
  // AND hot-reload on change (admin edits take effect on the running robot — the whole point).
  const fileBacked = !options.rules;
  const reloadThrottleMs = options.reloadThrottleMs ?? 2000;
  let rules: SensoryRule[] = options.rules ?? [];
  let loadedMtimeMs = -1;
  let lastStatAt = Number.NEGATIVE_INFINITY;

  async function maybeReload(t: number): Promise<void> {
    if (!fileBacked) return;
    if (t - lastStatAt < reloadThrottleMs) return;
    lastStatAt = t;
    try {
      const mt = (await stat(rulesPath())).mtimeMs;
      if (mt === loadedMtimeMs) return;
      rules = await loadSensoryRules();
      loadedMtimeMs = mt;
      logger.info(`[rules] reloaded ${rules.length} sensory rule(s)`);
    } catch {
      /* file missing → keep current rules */
    }
  }
  if (fileBacked) void maybeReload(now()); // initial load

  const lastFired = new Map<string, number>();

  const id = bus.on('sensory:perception', async (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    const t = now();
    await maybeReload(t); // pick up admin edits (throttled stat) BEFORE matching this event
    for (const rule of rules) {
      if (!ruleMatches(rule, p, new Date(t))) continue;
      const cd = rule.cooldownMs ?? 0;
      if (cd > 0 && t - (lastFired.get(rule.id) ?? Number.NEGATIVE_INFINITY) < cd) continue;
      lastFired.set(rule.id, t);

      const payload = (p.payload ?? {}) as Record<string, unknown>;
      const ctx: SensoryEventContext = {
        modality: p.modality,
        kind: p.kind,
        salience: p.salience,
        camera: typeof payload.camera === 'string' ? payload.camera : undefined,
        description: typeof payload.description === 'string' ? payload.description : undefined,
        imagePath: typeof payload.imagePath === 'string' ? payload.imagePath : undefined,
        payload,
      };

      void (async () => {
        const res = await execute(rule.action, ctx).catch((e) => ({ ok: false, detail: String(e) }));
        logger.info(`[rules] ${rule.id} (${rule.action.type}) → ${res.ok ? 'ok' : 'FAIL'}${res.detail ? `: ${res.detail.slice(0, 80)}` : ''}`);
        try {
          await appendRuleRun({
            ts: t,
            rule: rule.id,
            action: rule.action.type,
            kind: p.kind,
            ok: res.ok,
            detail: res.detail,
          });
        } catch {
          /* best-effort audit */
        }
      })();
    }
  });
  return () => bus.off(id);
}

export const __test = { ruleMatches, withinWindow, loadSensoryRules };
