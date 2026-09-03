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
import { assertSafeUrl, getSSRFGuard, isLoopbackHttpUrl } from '../security/ssrf-guard.js';

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
const DEFAULT_MAX_IN_FLIGHT = 8;
const DEFAULT_MAX_FIRES_PER_SEC = 8;
const RATE_WINDOW_MS = 1000;

function envPositiveInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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
    if (!isLoopbackHttpUrl(a.url ?? '')) {
      const urlCheck = getSSRFGuard().isSafeUrlSync(a.url ?? '');
      if (!urlCheck.safe) errors.push(`webhook url rejected by SSRF guard: ${urlCheck.reason}`);
    }
  } else if (a.type !== 'alert') {
    errors.push(`unknown action.type '${(a as { type?: string }).type}'`);
  }
  return { ok: errors.length === 0, errors };
}

async function validateRuleForUse(rule: SensoryRule): Promise<{ ok: boolean; errors: string[] }> {
  const validation = validateRule(rule);
  if (!validation.ok || rule.action.type !== 'webhook') return validation;
  if (isLoopbackHttpUrl(rule.action.url)) return validation;

  const urlCheck = await assertSafeUrl(rule.action.url);
  if (!urlCheck.safe) {
    return {
      ok: false,
      errors: [`webhook url rejected by SSRF guard: ${urlCheck.reason}`],
    };
  }
  return validation;
}

export async function saveSensoryRules(rules: SensoryRule[], path = rulesPath()): Promise<void> {
  const validations = await Promise.all(rules.map((rule) => validateRuleForUse(rule)));
  const valid = rules.filter((_, index) => validations[index]?.ok === true);
  const firstInvalid = validations.find((validation) => !validation.ok);
  // A file that an editor filled with only-unsafe rules still fails closed.
  // A mix (unsafe leftover + a new valid rule) drops the unsafe ones so admin
  // add/toggle/remove is not stuck after a hot-reload of a hand-edited file.
  if (valid.length === 0 && rules.length > 0) {
    throw new Error(`Invalid sensory rule: ${firstInvalid?.errors.join('; ') || 'validation failed'}`);
  }
  if (valid.length < rules.length) {
    logger.warn(`[rules] dropped ${rules.length - valid.length} unsafe rule(s) while saving`);
  }
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(valid, null, 2), 'utf8');
}

export const listSensoryRules = loadSensoryRules;

/** Add or replace a rule by id. Rejects (no write) when invalid. */
export async function upsertSensoryRule(rule: SensoryRule): Promise<{ ok: boolean; errors: string[] }> {
  const v = await validateRuleForUse(rule);
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
      const loadedRules = await loadSensoryRules();
      const validations = await Promise.all(loadedRules.map((rule) => validateRuleForUse(rule)));
      rules = loadedRules.filter((_rule, index) => validations[index]?.ok === true);
      const rejectedCount = loadedRules.length - rules.length;
      loadedMtimeMs = mt;
      logger.info(`[rules] reloaded ${rules.length} sensory rule(s)`);
      if (rejectedCount > 0) {
        logger.warn(`[rules] rejected ${rejectedCount} unsafe sensory rule(s) during reload`);
      }
    } catch {
      /* file missing → keep current rules */
    }
  }
  if (fileBacked) void maybeReload(now()); // initial load

  const lastFired = new Map<string, number>();
  const running = new Set<string>();
  const fireTimes = new Map<string, number[]>();
  let inFlight = 0;
  let lastDropLog = 0;
  const maxInFlight = envPositiveInt('CODEBUDDY_RULE_MAX_IN_FLIGHT', DEFAULT_MAX_IN_FLIGHT);
  const maxFiresPerSec = envPositiveInt('CODEBUDDY_RULE_MAX_FIRES_PER_SEC', DEFAULT_MAX_FIRES_PER_SEC);

  const noteDrop = (ruleId: string, reason: string, t: number): void => {
    if (t - lastDropLog < RATE_WINDOW_MS) return;
    lastDropLog = t;
    logger.warn(`[rules] dropping ${ruleId}: ${reason}`);
  };

  const id = bus.on('sensory:perception', async (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    const t = now();
    await maybeReload(t); // pick up admin edits (throttled stat) BEFORE matching this event
    for (const rule of rules) {
      if (!ruleMatches(rule, p, new Date(t))) continue;
      const cd = rule.cooldownMs ?? 0;
      if (cd > 0 && t - (lastFired.get(rule.id) ?? Number.NEGATIVE_INFINITY) < cd) continue;
      if (running.has(rule.id)) {
        noteDrop(rule.id, 'already in flight (loop guard)', t);
        continue;
      }
      if (inFlight >= maxInFlight) {
        noteDrop(rule.id, `in-flight cap ${maxInFlight}`, t);
        continue;
      }
      const recent = (fireTimes.get(rule.id) ?? []).filter((ts) => t - ts < RATE_WINDOW_MS);
      if (recent.length >= maxFiresPerSec) {
        noteDrop(rule.id, `per-second cap ${maxFiresPerSec}`, t);
        continue;
      }
      recent.push(t);
      fireTimes.set(rule.id, recent);
      lastFired.set(rule.id, t);
      running.add(rule.id);
      inFlight += 1;

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
        try {
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
        } finally {
          running.delete(rule.id);
          inFlight = Math.max(0, inFlight - 1);
        }
      })();
    }
  });
  return () => bus.off(id);
}

export const __test = { ruleMatches, withinWindow, loadSensoryRules };
