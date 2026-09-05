/**
 * System vitals emitter (Phase 1 + audit fixes) — hermetic, no hardware, no real /proc.
 * The runaway tests exercise the REAL instantaneous-CPU semantics: they inject two-snapshot
 * jiffies deltas (not a pre-baked cpuPct), so they would FAIL against the old `ps -o pcpu`
 * lifetime-average approach (audit BUG-01). Also covers PID reuse (BUG-05), no-purge on read
 * failure (BUG-06), ignore-list emptying (BUG-08) and exact comm match (BUG-09).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runSystemVitalsPass,
  _resetSystemVitalsState,
  type ProcSample,
  type SystemVitalsDeps,
  type SystemVitalsKind,
} from '../../src/sensory/system-vitals-emitter.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

interface Emitted {
  kind: SystemVitalsKind;
  salience: number;
  payload: Record<string, unknown>;
}

const CLK = 100; // clock ticks per second for the tests

function baseDeps(over: Partial<SystemVitalsDeps> = {}): {
  deps: SystemVitalsDeps;
  emitted: Emitted[];
} {
  const emitted: Emitted[] = [];
  const deps: SystemVitalsDeps = {
    readMemory: () => ({ rssMb: 100, heapUsedMb: 50 }),
    readLoad: () => 0.5,
    readGpu: async () => null,
    readFleet: () => ({ utilization: null, saturated: false }),
    readDisk: () => ({ freePercent: 80, freeBytes: 8_000_000_000 }),
    readProcesses: () => [],
    emit: (kind, salience, payload) => emitted.push({ kind, salience, payload }),
    runawayCounters: new Map<number, number>(),
    runawayPrev: new Map(),
    clkTck: CLK,
    ...over,
  };
  return { deps, emitted };
}

/**
 * A single mutable process whose cumulative CPU jiffies + wall clock advance between passes,
 * modeling REAL /proc sampling. `cpuFraction` is the instantaneous CPU used over the interval.
 */
function makeSpinScenario(opts: {
  pid?: number;
  comm?: string;
  startTime?: number;
  etimeStart?: number;
}) {
  let clock = 1_000_000; // ms
  let jiffies = 3_000; // cumulative CPU jiffies so far (could be large for an "old" process)
  let etime = opts.etimeStart ?? 7200; // seconds of life (default: a 2h-old process)
  let startTime = opts.startTime ?? 500;
  const pid = opts.pid ?? 4242;
  const comm = opts.comm ?? 'bash';

  return {
    now: () => clock,
    readProcesses: (): ProcSample[] => [
      { pid, ppid: 1, comm, cpuJiffies: jiffies, startTime, etimeSec: etime },
    ],
    /** Advance one sampling interval: dtSec of wall time, using cpuFraction of a core. */
    advance(dtSec: number, cpuFraction: number) {
      clock += dtSec * 1000;
      jiffies += Math.round(cpuFraction * CLK * dtSec);
      etime += dtSec;
    },
    /** Simulate PID reuse: a brand-new process takes the same pid. */
    reuse(newStartTime: number) {
      startTime = newStartTime;
      jiffies = 0;
      etime = 0;
    },
  };
}

beforeEach(() => _resetSystemVitalsState());
afterEach(() => {
  delete process.env.CODEBUDDY_RUNAWAY_CPU_PCT;
  delete process.env.CODEBUDDY_RUNAWAY_PASSES;
  delete process.env.CODEBUDDY_DISK_LOW_PCT;
  delete process.env.CODEBUDDY_RUNAWAY_SCOPE;
  delete process.env.CODEBUDDY_RUNAWAY_IGNORE_COMM;
  delete process.env.CODEBUDDY_RUNAWAY_CPU_BASIS;
});

describe('runaway guard — INSTANTANEOUS CPU via jiffies delta (BUG-01)', () => {
  it('detects an OLD process that suddenly spins at 100% (the ps-average approach would miss it)', async () => {
    const scn = makeSpinScenario({ etimeStart: 7200 });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      runawayCpuPct: 90,
      runawayPasses: 2,
    });

    await runSystemVitalsPass(deps); // pass 1: first sighting → baseline, no delta, no count
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);

    scn.advance(1, 1.0); // 100% CPU for 1s
    await runSystemVitalsPass(deps); // pass 2: delta → 100% → count 1
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);

    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // pass 3: count 2 == runawayPasses → emit
    const ev = emitted.filter((e) => e.kind === 'process_runaway');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ pid: 4242, comm: 'bash', scope: 'server', passes: 2 });
    expect(ev[0]!.payload.pcpu as number).toBeGreaterThanOrEqual(95);
    expect(ev[0]!.payload.etimeSec as number).toBeGreaterThanOrEqual(7200);
  });

  it('does NOT flag a long-lived process with a high lifetime average but currently idle', async () => {
    const scn = makeSpinScenario({ etimeStart: 7200 });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      runawayCpuPct: 90,
      runawayPasses: 2,
    });
    await runSystemVitalsPass(deps); // baseline
    for (let i = 0; i < 5; i++) {
      scn.advance(1, 0.0); // idle
      await runSystemVitalsPass(deps);
    }
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
  });

  it('a first-sighting pass never counts (no delta available yet)', async () => {
    const scn = makeSpinScenario({});
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      runawayCpuPct: 90,
      runawayPasses: 1,
    });
    await runSystemVitalsPass(deps); // even with passes:1, first sighting has no delta
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // now a delta exists → 100% → emit
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });

  it('a dip below threshold resets the consecutive counter', async () => {
    const scn = makeSpinScenario({});
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      runawayCpuPct: 90,
      runawayPasses: 2,
    });
    await runSystemVitalsPass(deps); // baseline
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // count 1
    scn.advance(1, 0.1); // 10% → below → reset
    await runSystemVitalsPass(deps);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // count restarts at 1
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // count 2 → emit
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });

  it('reads thresholds from env when not injected', async () => {
    process.env.CODEBUDDY_RUNAWAY_CPU_PCT = '50';
    process.env.CODEBUDDY_RUNAWAY_PASSES = '1';
    const scn = makeSpinScenario({ comm: 'weird' });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      runawayCpuPct: undefined,
      runawayPasses: undefined,
    });
    await runSystemVitalsPass(deps); // baseline
    scn.advance(1, 0.6); // 60% > 50%
    await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });
});

describe('PID reuse (BUG-05)', () => {
  it('a reused pid does not inherit the previous counter', async () => {
    const scn = makeSpinScenario({});
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      runawayCpuPct: 90,
      runawayPasses: 2,
    });
    await runSystemVitalsPass(deps); // baseline
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // count 1 for the ORIGINAL process
    scn.reuse(9999); // original dies, a new young process takes pid 4242
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // reuse detected → counter reset, new baseline, no count
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // new process count 1
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // new process count 2 → emit (fresh, not inherited)
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });
});

describe('read failure does NOT purge counters (BUG-06)', () => {
  it('a null read keeps the consecutive counter intact', async () => {
    const scn = makeSpinScenario({});
    let failNext = false;
    const { deps, emitted } = baseDeps({
      readProcesses: () => (failNext ? null : scn.readProcesses()),
      now: scn.now,
      runawayCpuPct: 90,
      runawayPasses: 3,
    });
    await runSystemVitalsPass(deps); // baseline
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // count 1
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // count 2
    failNext = true; // ps times out → reader returns null. Must NOT purge the counter.
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // skipped, count stays 2
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
    failNext = false;
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps); // count 3 → emit (would be < 3 if purge had happened)
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });
});

describe('comm ignore list (BUG-08 empty, BUG-09 exact match)', () => {
  it('a default-ignored comm (ffmpeg) never raises process_runaway', async () => {
    const scn = makeSpinScenario({ comm: 'ffmpeg' });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      ignoreComm: undefined,
      runawayCpuPct: 90,
      runawayPasses: 1,
    });
    await runSystemVitalsPass(deps);
    for (let i = 0; i < 4; i++) {
      scn.advance(1, 1.0);
      await runSystemVitalsPass(deps);
    }
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
  });

  it('BUG-08: CODEBUDDY_RUNAWAY_IGNORE_COMM="" empties the list (node becomes watchable)', async () => {
    process.env.CODEBUDDY_RUNAWAY_IGNORE_COMM = '';
    const scn = makeSpinScenario({ comm: 'node' });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      ignoreComm: undefined, // env is set to '' → ignore NOTHING
      runawayCpuPct: 90,
      runawayPasses: 1,
    });
    await runSystemVitalsPass(deps);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });

  it('BUG-09: exact match only — "nodemapper" is NOT immunized by "node"', async () => {
    const scn = makeSpinScenario({ comm: 'nodemapper' });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      ignoreComm: ['node'],
      runawayCpuPct: 90,
      runawayPasses: 1,
    });
    await runSystemVitalsPass(deps);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });

  it('BUG-09: the exact comm IS ignored', async () => {
    const scn = makeSpinScenario({ comm: 'node' });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      ignoreComm: ['node'],
      runawayCpuPct: 90,
      runawayPasses: 1,
    });
    await runSystemVitalsPass(deps);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
  });
});

describe('multi-core payload + CODEBUDDY_RUNAWAY_CPU_BASIS (HEARTWATCH v2)', () => {
  /**
   * Fake `/proc` sample: 4 logical CPUs, one process burning 3.5 cores (350 % of one core).
   * pcpuOfMachine = 350 / 4 = 87.5. Threshold 90 fires on `core` (compat) and does NOT fire
   * on `machine`.
   */
  function fourCore350() {
    const scn = makeSpinScenario({ comm: 'bash' });
    return scn;
  }

  async function runUntilDelta(
    scn: ReturnType<typeof makeSpinScenario>,
    over: Partial<SystemVitalsDeps>,
  ) {
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      nproc: 4,
      runawayCpuPct: 90,
      runawayPasses: 1,
      ...over,
    });
    await runSystemVitalsPass(deps); // baseline
    scn.advance(1, 3.5); // 350 % of one core for 1 s
    await runSystemVitalsPass(deps);
    return { emitted };
  }

  it('350 % on 4 cores → pcpuOfMachine 87.5 and runaway under default core basis', async () => {
    const { emitted } = await runUntilDelta(fourCore350(), {});
    const ev = emitted.filter((e) => e.kind === 'process_runaway');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({
      pid: 4242,
      comm: 'bash',
      pcpu: 350,
      pcpuTotal: 350,
      pcpuOfMachine: 87.5,
      cores: 4,
    });
  });

  it('same 350 % on 4 cores does NOT runaway under basis=machine with threshold 90', async () => {
    const { emitted } = await runUntilDelta(fourCore350(), { cpuBasis: 'machine' });
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
  });

  it('CODEBUDDY_RUNAWAY_CPU_BASIS=machine (env, no dep) also refuses 87.5 < 90', async () => {
    process.env.CODEBUDDY_RUNAWAY_CPU_BASIS = 'machine';
    const { emitted } = await runUntilDelta(fourCore350(), { cpuBasis: undefined });
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
  });

  it('unset BASIS is byte-identical: 100 % of one core still trips threshold 90 on an 8-core host', async () => {
    // If the default accidentally compared pcpuOfMachine (100/8 = 12.5), this would miss.
    const scn = makeSpinScenario({ comm: 'bash' });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      nproc: 8,
      runawayCpuPct: 90,
      runawayPasses: 1,
    });
    await runSystemVitalsPass(deps);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
    expect(emitted.find((e) => e.kind === 'process_runaway')!.payload).toMatchObject({
      pcpuTotal: 100,
      pcpuOfMachine: 12.5,
      cores: 8,
    });
  });
});

describe('scope tagging', () => {
  it('user scope tags the payload and is honored', async () => {
    const scn = makeSpinScenario({ comm: 'bash' });
    const { deps, emitted } = baseDeps({
      readProcesses: scn.readProcesses,
      now: scn.now,
      scope: 'user',
      runawayCpuPct: 90,
      runawayPasses: 1,
    });
    await runSystemVitalsPass(deps);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps);
    const ev = emitted.filter((e) => e.kind === 'process_runaway');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ scope: 'user', pid: 4242, ppid: 1 });
  });
});

describe('resource percepts', () => {
  it('always emits a resource_threshold pulse carrying the snapshot', async () => {
    const { deps, emitted } = baseDeps();
    await runSystemVitalsPass(deps);
    const pulse = emitted.find((e) => e.kind === 'resource_threshold');
    expect(pulse).toBeDefined();
    expect(pulse!.payload).toMatchObject({ rssMb: 100, heapUsedMb: 50, load1: 0.5, diskPct: 20 });
  });

  it('emits disk_low when used disk >= threshold', async () => {
    const { deps, emitted } = baseDeps({
      readDisk: () => ({ freePercent: 5, freeBytes: 100 }),
      diskLowPct: 90,
    });
    await runSystemVitalsPass(deps);
    expect(emitted.find((e) => e.kind === 'disk_low')!.payload).toMatchObject({ diskPct: 95 });
  });

  it('does NOT emit disk_low below threshold', async () => {
    const { deps, emitted } = baseDeps({
      readDisk: () => ({ freePercent: 50, freeBytes: 100 }),
      diskLowPct: 90,
    });
    await runSystemVitalsPass(deps);
    expect(emitted.find((e) => e.kind === 'disk_low')).toBeUndefined();
  });

  it('emits fleet_saturated when the fleet reader reports saturation', async () => {
    const { deps, emitted } = baseDeps({
      readFleet: () => ({ utilization: 1.2, saturated: true }),
    });
    await runSystemVitalsPass(deps);
    expect(emitted.find((e) => e.kind === 'fleet_saturated')!.payload).toMatchObject({
      fleetUtilization: 1.2,
    });
  });
});

describe('robustness + byte-identical', () => {
  it('never throws when a reader throws; still emits the pulse', async () => {
    const { deps, emitted } = baseDeps({
      readGpu: async () => {
        throw new Error('nvidia-smi missing');
      },
      readProcesses: () => {
        throw new Error('proc failed');
      },
    });
    await expect(runSystemVitalsPass(deps)).resolves.toBeDefined();
    expect(emitted.find((e) => e.kind === 'resource_threshold')).toBeDefined();
  });

  it('(flag off) a fully-injected pass never touches the real global bus', async () => {
    const seen: unknown[] = [];
    const bus = getGlobalEventBus();
    const id = bus.on('sensory:perception', (evt) => seen.push(evt));
    const scn = makeSpinScenario({});
    const { deps } = baseDeps({ readProcesses: scn.readProcesses, now: scn.now });
    await runSystemVitalsPass(deps);
    scn.advance(1, 1.0);
    await runSystemVitalsPass(deps);
    bus.off(id);
    expect(seen).toHaveLength(0);
  });
});
