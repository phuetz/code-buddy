/**
 * System vitals emitter — turns the EXISTING system monitors into heartbeat-paced
 * percepts on the sensory bus, so declarative rules (sensory-rules-engine) can act
 * on resource pressure the same way they act on camera/mic/screen events.
 *
 * This is the event-driven replacement for busy-loop monitoring. It measures NOTHING
 * new: it reads memory-monitor / gpu-monitor / fleet-load / disk-guard and the OS
 * process table, then emits `sensory:perception` events with `modality:'system'`.
 * The heartbeat scheduler's per-organ `inFlight` lock guarantees a slow pass never
 * overlaps itself — one sample per beat, never a loop.
 *
 * The "runaway process" guard is the direct fix for the 2026-09-05 incident (three
 * `bash` children pinned at 99.9 % CPU for 2 h 30, left by an agent): a child above
 * `CODEBUDDY_RUNAWAY_CPU_PCT` (default 90) for `CODEBUDDY_RUNAWAY_PASSES` consecutive
 * passes (default 3) emits a `process_runaway` percept a rule can turn into an alert
 * or a bounded `kill <pid>`.
 *
 * Injection follows `episodic-journal.ts` `runEpisodeConsolidation`: every reader is
 * a dep with a real default, so the pass is hermetically testable. Never throws.
 *
 * @module sensory/system-vitals-emitter
 */
import { execFile } from 'node:child_process';
import { loadavg } from 'node:os';
import { promisify } from 'node:util';
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/** Perceptual kinds this emitter can raise (modality is always `system`). */
export type SystemVitalsKind =
  | 'resource_threshold'
  | 'process_runaway'
  | 'disk_low'
  | 'fleet_saturated';

/** One child process observed in the OS process table. */
export interface ChildProcInfo {
  pid: number;
  comm: string;
  /** Instantaneous CPU percentage (0–100+ across cores, as `ps` reports it). */
  cpuPct: number;
  /** Elapsed wall-clock seconds since the process started. */
  etimeSec: number;
}

/** Normalized resource snapshot. Any field may be null/undefined when unavailable. */
export interface ResourceSnapshot {
  rssMb?: number | null;
  heapUsedMb?: number | null;
  load1?: number | null;
  vramPct?: number | null;
  vramUsedMb?: number | null;
  /** USED disk percentage (0–100), so a rule reads `diskPct >= 90` = 90 % full. */
  diskPct?: number | null;
  diskFreeBytes?: number | null;
  fleetUtilization?: number | null;
  fleetSaturated?: boolean;
}

/** Injectable dependencies — every reader has a real default wrapping an existing monitor. */
export interface SystemVitalsDeps {
  /** Read heap/RSS in MB. Default: `process.memoryUsage()` via memory-monitor semantics. */
  readMemory?: () => { rssMb: number; heapUsedMb: number };
  /** Read the 1-minute load average. Default: `os.loadavg()[0]`. */
  readLoad?: () => number | null;
  /** Read GPU VRAM. Default: gpu-monitor `getStats()`. Returns null when no GPU. */
  readGpu?: () => Promise<{ usagePercent: number; usedVRAM: number } | null>;
  /** Read fleet load. Default: fleet-load `getFleetLoad()`/`isFleetSaturated()`. */
  readFleet?: () => { utilization: number | null; saturated: boolean };
  /** Read disk free space for a path. Default: disk-guard `getFreeSpaceInfo(cwd)`. */
  readDisk?: () => { freePercent: number; freeBytes: number } | null;
  /** Read this process's descendant processes. Default: `ps` snapshot filtered to descendants. */
  readChildren?: () => Promise<ChildProcInfo[]> | ChildProcInfo[];
  /** Emit a percept. Default: direct `getGlobalEventBus().emit('sensory:perception', …)`. */
  emit?: (kind: SystemVitalsKind, salience: number, payload: Record<string, unknown>) => void;
  /** Consecutive-pass counter map keyed by pid. Default: module singleton. */
  runawayCounters?: Map<number, number>;
  /** Override thresholds (else read from env at call time). */
  runawayCpuPct?: number;
  runawayPasses?: number;
  diskLowPct?: number;
}

// Module-level runaway state so consecutive-pass counting survives between beats.
const moduleRunawayCounters = new Map<number, number>();

/** Reset the module runaway state (tests). */
export function _resetSystemVitalsState(): void {
  moduleRunawayCounters.clear();
}

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

// ── default readers (wrap the EXISTING monitors; add no new measurement) ──────

function defaultReadMemory(): { rssMb: number; heapUsedMb: number } {
  const m = process.memoryUsage();
  const toMb = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;
  return { rssMb: toMb(m.rss), heapUsedMb: toMb(m.heapUsed) };
}

function defaultReadLoad(): number | null {
  try {
    const [one] = loadavg();
    return typeof one === 'number' && Number.isFinite(one) ? one : null;
  } catch {
    return null;
  }
}

async function defaultReadGpu(): Promise<{ usagePercent: number; usedVRAM: number } | null> {
  try {
    const { getGPUMonitor } = await import('../hardware/gpu-monitor.js');
    const stats = await getGPUMonitor().getStats();
    if (!stats || stats.totalVRAM <= 0) return null;
    return { usagePercent: stats.usagePercent, usedVRAM: stats.usedVRAM };
  } catch {
    return null;
  }
}

async function defaultReadFleet(): Promise<{ utilization: number | null; saturated: boolean }> {
  try {
    const { getFleetLoad, isFleetSaturated } = await import('../fleet/fleet-load.js');
    return { utilization: getFleetLoad().utilization, saturated: isFleetSaturated() };
  } catch {
    return { utilization: null, saturated: false };
  }
}

async function defaultReadDisk(): Promise<{ freePercent: number; freeBytes: number } | null> {
  try {
    const { getFreeSpaceInfo } = await import('../utils/disk-guard.js');
    const info = getFreeSpaceInfo(process.cwd());
    if (!info) return null;
    return { freePercent: info.freePercent, freeBytes: info.freeBytes };
  } catch {
    return null;
  }
}

/**
 * Default child reader: one `ps` snapshot, filtered to descendants of THIS process.
 * Linux `etimes` gives elapsed seconds. Never throws — returns [] on any failure.
 */
async function defaultReadChildren(): Promise<ChildProcInfo[]> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-eo', 'pid=,ppid=,pcpu=,etimes=,comm='],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
    );
    interface Row {
      pid: number;
      ppid: number;
      cpuPct: number;
      etimeSec: number;
      comm: string;
    }
    const rows: Row[] = [];
    for (const line of stdout.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      // pid ppid pcpu etimes comm(may contain spaces)
      const m = t.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        cpuPct: Number(m[3]),
        etimeSec: Number(m[4]),
        comm: (m[5] ?? '').trim(),
      });
    }
    // Build ppid → children index, then walk descendants of our pid.
    const byPpid = new Map<number, Row[]>();
    for (const r of rows) {
      const arr = byPpid.get(r.ppid) ?? [];
      arr.push(r);
      byPpid.set(r.ppid, arr);
    }
    const out: ChildProcInfo[] = [];
    const seen = new Set<number>();
    const stack = [process.pid];
    while (stack.length) {
      const parent = stack.pop() as number;
      for (const child of byPpid.get(parent) ?? []) {
        if (seen.has(child.pid)) continue;
        seen.add(child.pid);
        out.push({
          pid: child.pid,
          comm: child.comm,
          cpuPct: child.cpuPct,
          etimeSec: child.etimeSec,
        });
        stack.push(child.pid);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function defaultEmit(
  kind: SystemVitalsKind,
  salience: number,
  payload: Record<string, unknown>,
): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'system-vitals',
    metadata: {
      modality: 'system',
      kind,
      salience,
      payload,
    },
  });
}

function clampSalience(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * One system-vitals pass: read the existing monitors, emit a `resource_threshold`
 * pulse carrying the full snapshot (rules attach numeric thresholds to it), then
 * raise the specific `disk_low` / `fleet_saturated` / `process_runaway` percepts.
 *
 * Returns the emitted kinds (for tests/observability). Never throws.
 */
export async function runSystemVitalsPass(deps: SystemVitalsDeps = {}): Promise<SystemVitalsKind[]> {
  const emit = deps.emit ?? defaultEmit;
  const counters = deps.runawayCounters ?? moduleRunawayCounters;
  const cpuThreshold = deps.runawayCpuPct ?? envNum('CODEBUDDY_RUNAWAY_CPU_PCT', 90);
  const runawayPasses = deps.runawayPasses ?? envInt('CODEBUDDY_RUNAWAY_PASSES', 3);
  const diskLowPct = deps.diskLowPct ?? envNum('CODEBUDDY_DISK_LOW_PCT', 90);
  const emitted: SystemVitalsKind[] = [];

  try {
    // ── gather (each reader fails soft to null) ──────────────────────────────
    let rssMb: number | null = null;
    let heapUsedMb: number | null = null;
    try {
      const mem = (deps.readMemory ?? defaultReadMemory)();
      rssMb = mem.rssMb;
      heapUsedMb = mem.heapUsedMb;
    } catch {
      /* soft */
    }

    let load1: number | null = null;
    try {
      load1 = (deps.readLoad ?? defaultReadLoad)();
    } catch {
      /* soft */
    }

    let vramPct: number | null = null;
    let vramUsedMb: number | null = null;
    try {
      const gpu = await (deps.readGpu ?? defaultReadGpu)();
      if (gpu) {
        vramPct = gpu.usagePercent;
        vramUsedMb = gpu.usedVRAM;
      }
    } catch {
      /* soft */
    }

    let fleetUtilization: number | null = null;
    let fleetSaturated = false;
    try {
      const fleet = await (deps.readFleet ?? defaultReadFleet)();
      fleetUtilization = fleet.utilization;
      fleetSaturated = fleet.saturated;
    } catch {
      /* soft */
    }

    let diskPct: number | null = null;
    let diskFreeBytes: number | null = null;
    try {
      const disk = await (deps.readDisk ?? defaultReadDisk)();
      if (disk) {
        // Emit USED percentage so `diskPct >= 90` reads as "90 % full".
        diskPct = Math.round((100 - disk.freePercent) * 10) / 10;
        diskFreeBytes = disk.freeBytes;
      }
    } catch {
      /* soft */
    }

    const snapshot: ResourceSnapshot = {
      rssMb,
      heapUsedMb,
      load1,
      vramPct,
      vramUsedMb,
      diskPct,
      diskFreeBytes,
      fleetUtilization,
      fleetSaturated,
    };

    // ── resource_threshold pulse (the percept rules threshold against) ───────
    // Salience scales with the worst normalized pressure so a rule can also gate
    // on salience if it wants; the numbers themselves live in the payload.
    const pressure = Math.max(
      diskPct ?? 0,
      vramPct ?? 0,
      fleetUtilization !== null ? fleetUtilization * 100 : 0,
    );
    emit('resource_threshold', clampSalience(pressure * 2), { ...snapshot });
    emitted.push('resource_threshold');

    // ── disk_low convenience percept ─────────────────────────────────────────
    if (diskPct !== null && diskPct >= diskLowPct) {
      emit('disk_low', 180, { diskPct, diskFreeBytes });
      emitted.push('disk_low');
    }

    // ── fleet_saturated convenience percept ──────────────────────────────────
    if (fleetSaturated) {
      emit('fleet_saturated', 160, { fleetUtilization });
      emitted.push('fleet_saturated');
    }

    // ── runaway process guard (consecutive-pass CPU counter per pid) ─────────
    let children: ChildProcInfo[] = [];
    try {
      children = await (deps.readChildren ?? defaultReadChildren)();
    } catch {
      children = [];
    }
    const livePids = new Set<number>();
    for (const child of children) {
      if (!Number.isFinite(child.pid)) continue;
      livePids.add(child.pid);
      if (Number.isFinite(child.cpuPct) && child.cpuPct >= cpuThreshold) {
        const next = (counters.get(child.pid) ?? 0) + 1;
        counters.set(child.pid, next);
        if (next >= runawayPasses) {
          emit('process_runaway', 200, {
            pid: child.pid,
            comm: child.comm,
            cpuPct: child.cpuPct,
            etimeSec: child.etimeSec,
            passes: next,
            cpuThreshold,
          });
          emitted.push('process_runaway');
        }
      } else {
        // Below threshold this pass → not consecutive anymore.
        counters.delete(child.pid);
      }
    }
    // Prune counters for pids that have vanished from the table.
    for (const pid of [...counters.keys()]) {
      if (!livePids.has(pid)) counters.delete(pid);
    }
  } catch (err) {
    logger.warn(
      `[system-vitals] pass failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return emitted;
}
