/**
 * System vitals emitter — turns the EXISTING system monitors into heartbeat-paced
 * percepts on the sensory bus, so declarative rules (sensory-rules-engine) can act
 * on resource pressure the same way they act on camera/mic/screen events.
 *
 * This is the event-driven replacement for busy-loop monitoring. It measures NOTHING
 * new for the resource snapshot: it reads memory-monitor / gpu-monitor / fleet-load /
 * disk-guard, then emits `sensory:perception` events with `modality:'system'`. The
 * heartbeat scheduler's per-organ `inFlight` lock guarantees a slow pass never overlaps
 * itself — one sample per beat, never a loop.
 *
 * The "runaway process" guard is the direct fix for the 2026-09-05 incident (three
 * `bash` loops pinned at 99.9 % CPU for 2 h 30, left by an agent). CRITICAL (audit BUG-01):
 * `ps -o pcpu` is the LIFETIME average (cputime/realtime), NOT the instantaneous rate — an
 * old process that suddenly spins takes hours to cross 90 %. So we compute INSTANTANEOUS CPU
 * from the delta of `/proc/<pid>/stat` (utime+stime jiffies) between two consecutive passes:
 * `(Δjiffies / clk_tck) / Δwallclock_sec × 100`. A pid seen for the first time has no delta
 * (it does not count that pass). PID reuse is rejected by comparing the process start time.
 *
 * Injection follows `episodic-journal.ts` `runEpisodeConsolidation`: every reader is a dep
 * with a real default, so the pass is hermetically testable. Never throws.
 *
 * @module sensory/system-vitals-emitter
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { loadavg } from 'node:os';
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

/** Perceptual kinds this emitter can raise (modality is always `system`). */
export type SystemVitalsKind =
  | 'resource_threshold'
  | 'process_runaway'
  | 'disk_low'
  | 'fleet_saturated';

/** How wide the runaway-process scan reaches. */
export type RunawayScope = 'server' | 'user';

/**
 * One raw process sample. CPU is carried as CUMULATIVE jiffies (utime+stime), NOT a percentage:
 * the pass derives the instantaneous rate from the delta between passes (audit BUG-01).
 */
export interface ProcSample {
  pid: number;
  /** Parent pid — carried into the alert so the operator knows the tree. */
  ppid?: number;
  comm: string;
  /** Cumulative CPU time in clock ticks (utime+stime from /proc/<pid>/stat). */
  cpuJiffies: number;
  /** Process start time in jiffies (field 22) — identity guard against PID reuse (BUG-05). */
  startTime: number;
  /** Elapsed wall-clock seconds since the process started. */
  etimeSec: number;
}

/** Per-pid snapshot kept between passes to compute the instantaneous CPU delta. */
interface PrevProcSnapshot {
  cpuJiffies: number;
  startTime: number;
  etimeSec: number;
  /** Monotonic-ish wall clock (ms) when this snapshot was taken. */
  sampledAt: number;
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
  /**
   * Read the candidate processes for the runaway scan (raw jiffies). Default: `/proc`, scoped by
   * `scope` (`server` = descendants of process.pid; `user` = all processes of the current uid).
   * Returns `null` to signal a READ FAILURE — the pass then skips the runaway section WITHOUT
   * purging its consecutive counters (audit BUG-06). An empty array means "no processes", which
   * DOES purge dead pids.
   */
  readProcesses?: (scope: RunawayScope) => Promise<ProcSample[] | null> | ProcSample[] | null;
  /** Emit a percept. Default: direct `getGlobalEventBus().emit('sensory:perception', …)`. */
  emit?: (kind: SystemVitalsKind, salience: number, payload: Record<string, unknown>) => void;
  /** Consecutive-pass counter map keyed by pid. Default: module singleton. */
  runawayCounters?: Map<number, number>;
  /** Previous per-pid CPU snapshot map. Default: module singleton. */
  runawayPrev?: Map<number, PrevProcSnapshot>;
  /** Wall clock in ms. Default: `Date.now()`. */
  now?: () => number;
  /** Clock ticks per second (sysconf _SC_CLK_TCK). Default: CODEBUDDY_CLK_TCK or 100. */
  clkTck?: number;
  /** Override thresholds (else read from env at call time). */
  runawayCpuPct?: number;
  runawayPasses?: number;
  diskLowPct?: number;
  /** Runaway scan scope (else CODEBUDDY_RUNAWAY_SCOPE, default 'server'). */
  scope?: RunawayScope;
  /** comm values that never raise process_runaway (else CODEBUDDY_RUNAWAY_IGNORE_COMM). */
  ignoreComm?: string[];
}

// Module-level runaway state so consecutive-pass counting + CPU deltas survive between beats.
const moduleRunawayCounters = new Map<number, number>();
const moduleRunawayPrev = new Map<number, PrevProcSnapshot>();

/** Reset the module runaway state (tests). */
export function _resetSystemVitalsState(): void {
  moduleRunawayCounters.clear();
  moduleRunawayPrev.clear();
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

// ── comm ignore list (BUG-08: distinguish undefined from empty; BUG-09: exact match) ─────

/** comm values expected to run hot legitimately — never raise process_runaway on these. */
const DEFAULT_IGNORE_COMM = [
  'ffmpeg',
  'comfyui',
  'python',
  'python3',
  'node',
  'tsc',
  'vitest',
  'cargo',
  'rustc',
  'esbuild',
];

/**
 * Resolve the ignore list. An EXPLICITLY-SET env var (even "") wins over the defaults, so
 * `CODEBUDDY_RUNAWAY_IGNORE_COMM=""` means "ignore nothing" (audit BUG-08). Only a fully unset
 * source falls back to the defaults.
 */
function resolveIgnoreComm(deps: SystemVitalsDeps): string[] {
  let raw: string[] | undefined;
  if (deps.ignoreComm !== undefined) {
    raw = deps.ignoreComm;
  } else if (process.env.CODEBUDDY_RUNAWAY_IGNORE_COMM !== undefined) {
    raw = process.env.CODEBUDDY_RUNAWAY_IGNORE_COMM.split(',');
  } else {
    raw = DEFAULT_IGNORE_COMM;
  }
  return raw.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** BUG-09: EXACT comm match only — `startsWith` would immunize `nodemapper`, `python_loop`, … */
function isIgnoredComm(comm: string, ignore: string[]): boolean {
  const c = comm.trim().toLowerCase();
  if (!c) return false;
  return ignore.includes(c);
}

function resolveScope(deps: SystemVitalsDeps): RunawayScope {
  if (deps.scope) return deps.scope;
  return process.env.CODEBUDDY_RUNAWAY_SCOPE === 'user' ? 'user' : 'server';
}

function resolveClkTck(deps: SystemVitalsDeps): number {
  if (deps.clkTck && deps.clkTck > 0) return deps.clkTck;
  const env = Number(process.env.CODEBUDDY_CLK_TCK);
  return Number.isFinite(env) && env > 0 ? env : 100;
}

// ── default /proc reader — raw cumulative jiffies + start time (no ps average) ───────────

/** Parse one `/proc/<pid>/stat` line into a ProcSample (without etimeSec, filled by caller). */
function parseStat(pid: number, content: string): Omit<ProcSample, 'etimeSec'> | null {
  // comm (field 2) is wrapped in parens and may itself contain spaces/parens → split on the
  // LAST ')' so the numeric fields after it align.
  const open = content.indexOf('(');
  const close = content.lastIndexOf(')');
  if (open < 0 || close < 0 || close < open) return null;
  const comm = content.slice(open + 1, close);
  const after = content.slice(close + 1).trim().split(/\s+/);
  // after[0]=state(3), after[1]=ppid(4); utime(14)=after[11], stime(15)=after[12], starttime(22)=after[19]
  const ppid = Number(after[1]);
  const utime = Number(after[11]);
  const stime = Number(after[12]);
  const startTime = Number(after[19]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime) || !Number.isFinite(startTime)) return null;
  return {
    pid,
    ppid: Number.isFinite(ppid) ? ppid : undefined,
    comm,
    cpuJiffies: utime + stime,
    startTime,
  };
}

/**
 * Default reader: read `/proc` directly for cumulative CPU jiffies + start time. `scope:'server'`
 * keeps descendants of process.pid; `scope:'user'` keeps every process of the current uid (the
 * orphan-safe mode that catches loops born outside the server tree). Returns `null` on total
 * failure so the pass skips WITHOUT purging counters (BUG-06). Never throws.
 */
function defaultReadProcesses(scope: RunawayScope): ProcSample[] | null {
  let uptimeSec: number;
  let clkTck: number;
  try {
    uptimeSec = Number(readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]);
    clkTck = Number(process.env.CODEBUDDY_CLK_TCK) > 0 ? Number(process.env.CODEBUDDY_CLK_TCK) : 100;
    if (!Number.isFinite(uptimeSec)) return null;
  } catch {
    return null; // /proc unavailable (non-Linux, container without procfs) → skip, don't purge.
  }

  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return null;
  }

  const myUid = process.getuid ? process.getuid() : -1;
  const raw: Array<Omit<ProcSample, 'etimeSec'> & { startTime: number }> = [];
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    // user scope: keep only the current uid's processes (per-pid stat can vanish → skip).
    if (scope === 'user' && myUid >= 0) {
      try {
        if (statSync(`/proc/${pid}`).uid !== myUid) continue;
      } catch {
        continue;
      }
    }
    let content: string;
    try {
      content = readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      continue; // process exited between readdir and read — normal race, skip.
    }
    const parsed = parseStat(pid, content);
    if (parsed) raw.push(parsed);
  }

  const withEtime = (s: Omit<ProcSample, 'etimeSec'>): ProcSample => ({
    ...s,
    etimeSec: Math.max(0, Math.round(uptimeSec - s.startTime / clkTck)),
  });

  if (scope === 'user') {
    return raw.filter((r) => r.pid !== process.pid).map(withEtime);
  }

  // server scope: walk descendants of our pid.
  const byPpid = new Map<number, typeof raw>();
  for (const r of raw) {
    const key = r.ppid ?? -1;
    const arr = byPpid.get(key) ?? [];
    arr.push(r);
    byPpid.set(key, arr);
  }
  const out: ProcSample[] = [];
  const seen = new Set<number>();
  const stack = [process.pid];
  while (stack.length) {
    const parent = stack.pop() as number;
    for (const child of byPpid.get(parent) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      out.push(withEtime(child));
      stack.push(child.pid);
    }
  }
  return out;
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
 * One system-vitals pass: read the existing monitors, emit a `resource_threshold` pulse carrying
 * the full snapshot (rules attach numeric thresholds to it), then raise the specific `disk_low` /
 * `fleet_saturated` / `process_runaway` percepts.
 *
 * Returns the emitted kinds (for tests/observability). Never throws.
 */
export async function runSystemVitalsPass(deps: SystemVitalsDeps = {}): Promise<SystemVitalsKind[]> {
  const emit = deps.emit ?? defaultEmit;
  const counters = deps.runawayCounters ?? moduleRunawayCounters;
  const prev = deps.runawayPrev ?? moduleRunawayPrev;
  const now = (deps.now ?? Date.now)();
  const clkTck = resolveClkTck(deps);
  const cpuThreshold = deps.runawayCpuPct ?? envNum('CODEBUDDY_RUNAWAY_CPU_PCT', 90);
  const runawayPasses = deps.runawayPasses ?? envInt('CODEBUDDY_RUNAWAY_PASSES', 3);
  const diskLowPct = deps.diskLowPct ?? envNum('CODEBUDDY_DISK_LOW_PCT', 90);
  const scope = resolveScope(deps);
  const ignoreComm = resolveIgnoreComm(deps);
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

    // ── runaway process guard: INSTANTANEOUS CPU via jiffies delta ───────────
    // Scope: 'server' = descendants of buddy server; 'user' = ALL uid processes (catches
    // orphans reparented to PID 1 — the 05/09 incident case).
    let samples: ProcSample[] | null;
    try {
      samples = await (deps.readProcesses ?? defaultReadProcesses)(scope);
    } catch {
      samples = null;
    }

    // BUG-06: a read FAILURE (null) skips the section WITHOUT purging counters/prev.
    if (samples !== null) {
      const livePids = new Set<number>();
      for (const s of samples) {
        if (!Number.isFinite(s.pid)) continue;
        // BUG-09: never flag a legitimately-hot process (exact comm match).
        if (isIgnoredComm(s.comm, ignoreComm)) continue;
        livePids.add(s.pid);

        const before = prev.get(s.pid);
        // BUG-05: PID reuse — a different startTime (or a process that got "younger") is a NEW
        // process on the same pid → reset, establish a fresh baseline, do not count this pass.
        const sameProcess =
          !!before && before.startTime === s.startTime && s.etimeSec + 2 >= before.etimeSec;

        let cpuPct: number | null = null;
        if (sameProcess) {
          const dJiffies = s.cpuJiffies - before.cpuJiffies;
          const dtSec = (now - before.sampledAt) / 1000;
          if (dtSec > 0 && dJiffies >= 0) {
            cpuPct = (dJiffies / clkTck / dtSec) * 100;
          }
        } else {
          // First sighting or PID reuse → no valid delta; drop any stale counter.
          counters.delete(s.pid);
        }

        // Record this pass's baseline for the next delta.
        prev.set(s.pid, {
          cpuJiffies: s.cpuJiffies,
          startTime: s.startTime,
          etimeSec: s.etimeSec,
          sampledAt: now,
        });

        if (cpuPct !== null && cpuPct >= cpuThreshold) {
          const next = (counters.get(s.pid) ?? 0) + 1;
          counters.set(s.pid, next);
          if (next >= runawayPasses) {
            emit('process_runaway', 200, {
              pid: s.pid,
              ppid: s.ppid,
              comm: s.comm,
              pcpu: Math.round(cpuPct * 10) / 10,
              etimeSec: s.etimeSec,
              passes: next,
              cpuThreshold,
              scope,
            });
            emitted.push('process_runaway');
          }
        } else if (cpuPct !== null) {
          // Below threshold this pass → not consecutive anymore.
          counters.delete(s.pid);
        }
      }
      // Prune counters + prev for pids that vanished from the table (only when the read succeeded).
      for (const pid of [...counters.keys()]) {
        if (!livePids.has(pid)) counters.delete(pid);
      }
      for (const pid of [...prev.keys()]) {
        if (!livePids.has(pid)) prev.delete(pid);
      }
    }
  } catch (err) {
    logger.warn(
      `[system-vitals] pass failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return emitted;
}
