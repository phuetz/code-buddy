/**
 * Read-only sensory surveillance status — a small snapshot the running server
 * writes, plus a collector the `buddy sensory status` CLI reads.
 *
 * The snapshot lives at `~/.codebuddy/sensory-status.json` (override
 * `CODEBUDDY_SENSORY_STATUS_FILE`). It is written only when the sensory block
 * of `buddy server` is wired (`CODEBUDDY_SENSORY=true`). Without a snapshot
 * (or with a dead pid) the CLI says « serveur non joignable » and still prints
 * whatever state files exist (rules + last fires).
 *
 * @module sensory/sensory-status
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { getGlobalEventBus } from '../events/event-bus.js';
import type { BaseEvent } from '../events/types.js';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import { FALLBACK_HEARTBEAT_SOURCE, type HeartbeatSource } from './heartbeat-fallback.js';
import { listSensoryRules, readRuleRuns, type SensoryRule } from './sensory-rules-engine.js';

export interface SensoryStatusFlags {
  SENSORY: boolean;
  SYSTEM_VITALS: boolean;
  SCHEDULE_TICKS: boolean;
  DOMAIN_EVENTS: boolean;
  RULES: boolean;
  HEARTBEAT_FALLBACK: boolean;
}

export interface SensoryTreatmentCadence {
  name: string;
  everyBeats: number;
}

export interface SensoryRecentPerception {
  modality: string;
  kind: string;
  receivedAt: number;
  payload?: unknown;
}

export interface SensoryHeartbeatState {
  source: HeartbeatSource;
  lastBeatAt: number | null;
  beat?: number;
}

export interface SensoryStatusSnapshot {
  pid: number;
  startedAt: number;
  updatedAt: number;
  flags: SensoryStatusFlags;
  heartbeat: SensoryHeartbeatState;
  treatments: SensoryTreatmentCadence[];
  recent: SensoryRecentPerception[];
}

export type DisplayHeartbeatSource = 'rust' | 'fallback' | 'aucun';

export interface SensoryRuleStatus {
  id: string;
  name: string;
  enabled: boolean;
  lastFiredAt: number | null;
}

export interface SensoryStatusView {
  serverReachable: boolean;
  serverMessage: string;
  flags: SensoryStatusFlags;
  heartbeat: { source: DisplayHeartbeatSource; lastBeatAt: number | null; lastBeatAgoSec: number | null; beat?: number };
  treatments: SensoryTreatmentCadence[];
  recent: SensoryRecentPerception[];
  rules: SensoryRuleStatus[];
}

const RECENT_CAP = 5;

export function sensoryStatusPath(): string {
  return process.env.CODEBUDDY_SENSORY_STATUS_FILE || join(homedir(), '.codebuddy', 'sensory-status.json');
}

export function flagsFromEnv(env: NodeJS.ProcessEnv = process.env): SensoryStatusFlags {
  return {
    SENSORY: env.CODEBUDDY_SENSORY === 'true',
    SYSTEM_VITALS: env.CODEBUDDY_SYSTEM_VITALS === 'true',
    SCHEDULE_TICKS: env.CODEBUDDY_SCHEDULE_TICKS === 'true',
    DOMAIN_EVENTS: env.CODEBUDDY_DOMAIN_EVENTS === 'true',
    RULES: env.CODEBUDDY_SENSORY_RULES === 'true',
    HEARTBEAT_FALLBACK: env.CODEBUDDY_HEARTBEAT_FALLBACK === 'true',
  };
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isSnapshot(value: unknown): value is SensoryStatusSnapshot {
  if (!value || typeof value !== 'object') return false;
  const o = value as SensoryStatusSnapshot;
  return (
    typeof o.pid === 'number' &&
    typeof o.updatedAt === 'number' &&
    typeof o.startedAt === 'number' &&
    !!o.flags &&
    typeof o.flags === 'object' &&
    !!o.heartbeat &&
    typeof o.heartbeat === 'object' &&
    Array.isArray(o.treatments) &&
    Array.isArray(o.recent)
  );
}

export function readSensoryStatusSnapshot(path = sensoryStatusPath()): SensoryStatusSnapshot | null {
  const value = readJsonAtomicSync<SensoryStatusSnapshot | null>(path, null, { isValid: isSnapshot });
  return value;
}

function persist(snapshot: SensoryStatusSnapshot, path = sensoryStatusPath()): void {
  try {
    writeJsonAtomicSync(path, snapshot, { mode: 0o600 });
  } catch (err) {
    logger.warn(
      `[sensory-status] snapshot write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function displaySource(source: HeartbeatSource | undefined): DisplayHeartbeatSource {
  if (source === 'rust') return 'rust';
  if (source === 'fallback') return 'fallback';
  return 'aucun';
}

function sourceFromEvent(evt: BaseEvent): HeartbeatSource {
  return evt.source === FALLBACK_HEARTBEAT_SOURCE ? 'fallback' : 'rust';
}

export interface WireSensoryStatusDeps {
  treatments: SensoryTreatmentCadence[];
  flags?: SensoryStatusFlags;
  pid?: number;
  now?: () => number;
  path?: string;
}

/**
 * Subscribe to the sensory bus and keep the status snapshot fresh. Returns an
 * unsubscribe/teardown fn (never throws). Wired from `buddy server` inside the
 * existing `CODEBUDDY_SENSORY=true` block — no extra env var.
 */
export function wireSensoryStatusSnapshot(deps: WireSensoryStatusDeps): () => void {
  const now = deps.now ?? Date.now;
  const path = deps.path ?? sensoryStatusPath();
  const snapshot: SensoryStatusSnapshot = {
    pid: deps.pid ?? process.pid,
    startedAt: now(),
    updatedAt: now(),
    flags: deps.flags ?? flagsFromEnv(),
    heartbeat: { source: 'none', lastBeatAt: null },
    treatments: deps.treatments.map((t) => ({ name: t.name, everyBeats: t.everyBeats })),
    recent: [],
  };
  persist(snapshot, path);

  const bus = getGlobalEventBus();
  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    try {
      const m = evt.metadata as
        | { modality?: string; kind?: string; payload?: { beat?: number } }
        | undefined;
      const modality = m?.modality;
      const kind = m?.kind;
      if (!modality || !kind) return;
      const ts = now();
      if (modality === 'vital' && kind === 'heartbeat') {
        snapshot.heartbeat = {
          source: sourceFromEvent(evt),
          lastBeatAt: ts,
          beat: Number.isFinite(Number(m.payload?.beat)) ? Number(m.payload?.beat) : undefined,
        };
        snapshot.updatedAt = ts;
        persist(snapshot, path);
        return;
      }
      if (modality === 'system' || modality === 'time') {
        snapshot.recent.push({
          modality,
          kind,
          receivedAt: ts,
          payload: m.payload,
        });
        if (snapshot.recent.length > RECENT_CAP) snapshot.recent.splice(0, snapshot.recent.length - RECENT_CAP);
        snapshot.updatedAt = ts;
        persist(snapshot, path);
      }
    } catch (err) {
      logger.warn(
        `[sensory-status] snapshot update failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  return () => {
    bus.off(id);
  };
}

function agoSec(ts: number | null, nowMs: number): number | null {
  if (ts === null || !Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((nowMs - ts) / 1000));
}

function ruleEnabled(rule: SensoryRule): boolean {
  return rule.enabled !== false;
}

export interface CollectSensoryStatusDeps {
  now?: () => number;
  snapshot?: SensoryStatusSnapshot | null;
  pidAlive?: (pid: number) => boolean;
  listRules?: () => Promise<SensoryRule[]>;
  listRuns?: (limit: number) => Promise<Array<{ ts: number; rule: string }>>;
  env?: NodeJS.ProcessEnv;
}

export async function collectSensoryStatus(
  deps: CollectSensoryStatusDeps = {},
): Promise<SensoryStatusView> {
  const nowMs = (deps.now ?? Date.now)();
  const snapshot = deps.snapshot === undefined ? readSensoryStatusSnapshot() : deps.snapshot;
  const alive = snapshot ? (deps.pidAlive ?? isPidAlive)(snapshot.pid) : false;

  let serverMessage: string;
  if (!snapshot) {
    serverMessage = 'serveur non joignable';
  } else if (!alive) {
    const age = agoSec(snapshot.updatedAt, nowMs);
    serverMessage = `serveur non joignable (dernier état pid ${snapshot.pid}${age !== null ? `, il y a ${age} s` : ''})`;
  } else {
    const age = agoSec(snapshot.updatedAt, nowMs);
    serverMessage = `serveur pid ${snapshot.pid} en cours${age !== null ? ` (mis à jour il y a ${age} s)` : ''}`;
  }

  const flags = snapshot?.flags ?? flagsFromEnv(deps.env ?? process.env);
  const hb = snapshot?.heartbeat;
  const lastBeatAt = hb?.lastBeatAt ?? null;

  let rules: SensoryRuleStatus[] = [];
  try {
    const loaded = await (deps.listRules ?? listSensoryRules)();
    const runs = await (deps.listRuns ?? readRuleRuns)(200);
    const lastFire = new Map<string, number>();
    for (const run of runs) {
      if (!lastFire.has(run.rule)) lastFire.set(run.rule, run.ts);
    }
    rules = loaded.map((r) => ({
      id: r.id,
      name: r.name?.trim() || r.id,
      enabled: ruleEnabled(r),
      lastFiredAt: lastFire.get(r.id) ?? null,
    }));
  } catch (err) {
    logger.warn(
      `[sensory-status] rules/runs read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    serverReachable: alive,
    serverMessage,
    flags,
    heartbeat: {
      source: displaySource(hb?.source),
      lastBeatAt,
      lastBeatAgoSec: agoSec(lastBeatAt, nowMs),
      beat: hb?.beat,
    },
    treatments: snapshot?.treatments ?? [],
    recent: snapshot?.recent ?? [],
    rules,
  };
}

function flagLine(flags: SensoryStatusFlags): string {
  return (
    `SENSORY=${flags.SENSORY ? 'on' : 'off'}  ` +
    `SYSTEM_VITALS=${flags.SYSTEM_VITALS ? 'on' : 'off'}  ` +
    `SCHEDULE_TICKS=${flags.SCHEDULE_TICKS ? 'on' : 'off'}  ` +
    `DOMAIN_EVENTS=${flags.DOMAIN_EVENTS ? 'on' : 'off'}  ` +
    `RULES=${flags.RULES ? 'on' : 'off'}  ` +
    `HEARTBEAT_FALLBACK=${flags.HEARTBEAT_FALLBACK ? 'on' : 'off'}`
  );
}

function formatAgo(sec: number | null): string {
  if (sec === null) return 'jamais';
  return `il y a ${sec} s`;
}

export function formatSensoryStatus(view: SensoryStatusView, asJson = false): string {
  if (asJson) {
    return JSON.stringify(view, null, 2);
  }
  const lines: string[] = [];
  lines.push(`Serveur : ${view.serverMessage}`);
  lines.push(`Flags   : ${flagLine(view.flags)}`);
  const beatAgo =
    view.heartbeat.source === 'aucun'
      ? 'aucun'
      : `${view.heartbeat.source} (dernier beat ${formatAgo(view.heartbeat.lastBeatAgoSec)})`;
  lines.push(`Battement : ${beatAgo}`);
  if (view.treatments.length) {
    lines.push('Traitements :');
    for (const t of view.treatments) {
      lines.push(`  • ${t.name}  every ${t.everyBeats} beat(s)`);
    }
  } else {
    lines.push('Traitements : (aucun enregistré)');
  }
  if (view.recent.length) {
    lines.push('Dernières perceptions system/time :');
    for (const p of view.recent) {
      const age = agoSec(p.receivedAt, Date.now());
      lines.push(`  • ${p.modality}/${p.kind}  ${formatAgo(age)}`);
    }
  } else {
    lines.push('Dernières perceptions system/time : (aucune)');
  }
  if (view.rules.length) {
    lines.push('Règles :');
    for (const r of view.rules) {
      const fire = r.lastFiredAt === null ? 'jamais déclenchée' : `dernier déclenchement ${formatAgo(agoSec(r.lastFiredAt, Date.now()))}`;
      lines.push(`  • ${r.name}  ${r.enabled ? 'activée' : 'désactivée'}  ${fire}`);
    }
  } else {
    lines.push('Règles : (aucune chargée)');
  }
  return lines.join('\n');
}
