/**
 * System vitals emitter (Phase 1) — hermetic, no hardware, no real `ps`.
 * Proves: runaway detection after N CONSECUTIVE passes, no premature/under-threshold
 * emission, disk_low / fleet_saturated convenience percepts, the resource_threshold
 * pulse, and that a below-threshold pass resets the consecutive counter.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runSystemVitalsPass,
  _resetSystemVitalsState,
  type ChildProcInfo,
  type SystemVitalsDeps,
  type SystemVitalsKind,
} from '../../src/sensory/system-vitals-emitter.js';

interface Emitted {
  kind: SystemVitalsKind;
  salience: number;
  payload: Record<string, unknown>;
}

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
    readChildren: () => [],
    emit: (kind, salience, payload) => emitted.push({ kind, salience, payload }),
    runawayCounters: new Map<number, number>(),
    ...over,
  };
  return { deps, emitted };
}

beforeEach(() => _resetSystemVitalsState());
afterEach(() => {
  delete process.env.CODEBUDDY_RUNAWAY_CPU_PCT;
  delete process.env.CODEBUDDY_RUNAWAY_PASSES;
  delete process.env.CODEBUDDY_DISK_LOW_PCT;
});

describe('runSystemVitalsPass — runaway guard', () => {
  it('(a) emits process_runaway only after N consecutive over-threshold passes', async () => {
    const runaway: ChildProcInfo[] = [
      { pid: 4242, comm: 'bash', cpuPct: 99.9, etimeSec: 9000 },
    ];
    const { deps, emitted } = baseDeps({
      readChildren: () => runaway,
      runawayCpuPct: 90,
      runawayPasses: 3,
    });

    await runSystemVitalsPass(deps);
    await runSystemVitalsPass(deps);
    // passes 1 and 2: no runaway yet
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);

    await runSystemVitalsPass(deps);
    // pass 3 (== N): runaway fires
    const runawayEvents = emitted.filter((e) => e.kind === 'process_runaway');
    expect(runawayEvents).toHaveLength(1);
    expect(runawayEvents[0]!.payload).toMatchObject({
      pid: 4242,
      comm: 'bash',
      cpuPct: 99.9,
      etimeSec: 9000,
      passes: 3,
    });
  });

  it('(b) emits nothing runaway below threshold', async () => {
    const { deps, emitted } = baseDeps({
      readChildren: () => [{ pid: 7, comm: 'node', cpuPct: 12, etimeSec: 100 }],
      runawayCpuPct: 90,
      runawayPasses: 3,
    });
    for (let i = 0; i < 5; i++) await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
  });

  it('(b) emits nothing runaway with fewer than N passes', async () => {
    const { deps, emitted } = baseDeps({
      readChildren: () => [{ pid: 8, comm: 'bash', cpuPct: 99, etimeSec: 500 }],
      runawayCpuPct: 90,
      runawayPasses: 4,
    });
    await runSystemVitalsPass(deps);
    await runSystemVitalsPass(deps);
    await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
  });

  it('a below-threshold pass RESETS the consecutive counter', async () => {
    let cpu = 99;
    const { deps, emitted } = baseDeps({
      readChildren: () => [{ pid: 9, comm: 'bash', cpuPct: cpu, etimeSec: 500 }],
      runawayCpuPct: 90,
      runawayPasses: 3,
    });
    await runSystemVitalsPass(deps); // 1
    await runSystemVitalsPass(deps); // 2
    cpu = 5; // dips below → resets
    await runSystemVitalsPass(deps);
    cpu = 99;
    await runSystemVitalsPass(deps); // count restarts at 1
    await runSystemVitalsPass(deps); // 2
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
    await runSystemVitalsPass(deps); // 3 → fires
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });

  it('reads the runaway thresholds from env when not injected', async () => {
    process.env.CODEBUDDY_RUNAWAY_CPU_PCT = '50';
    process.env.CODEBUDDY_RUNAWAY_PASSES = '2';
    const { deps, emitted } = baseDeps({
      readChildren: () => [{ pid: 11, comm: 'yes', cpuPct: 60, etimeSec: 30 }],
      runawayCpuPct: undefined,
      runawayPasses: undefined,
    });
    await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(0);
    await runSystemVitalsPass(deps);
    expect(emitted.filter((e) => e.kind === 'process_runaway')).toHaveLength(1);
  });
});

describe('runSystemVitalsPass — resource percepts', () => {
  it('always emits a resource_threshold pulse carrying the snapshot', async () => {
    const { deps, emitted } = baseDeps();
    await runSystemVitalsPass(deps);
    const pulse = emitted.find((e) => e.kind === 'resource_threshold');
    expect(pulse).toBeDefined();
    // disk 80% free → 20% used
    expect(pulse!.payload).toMatchObject({ rssMb: 100, heapUsedMb: 50, load1: 0.5, diskPct: 20 });
  });

  it('emits disk_low when used disk >= threshold', async () => {
    const { deps, emitted } = baseDeps({
      readDisk: () => ({ freePercent: 5, freeBytes: 100 }), // 95% used
      diskLowPct: 90,
    });
    await runSystemVitalsPass(deps);
    const disk = emitted.find((e) => e.kind === 'disk_low');
    expect(disk).toBeDefined();
    expect(disk!.payload).toMatchObject({ diskPct: 95 });
  });

  it('does NOT emit disk_low below threshold', async () => {
    const { deps, emitted } = baseDeps({
      readDisk: () => ({ freePercent: 50, freeBytes: 100 }), // 50% used
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
    const fleet = emitted.find((e) => e.kind === 'fleet_saturated');
    expect(fleet).toBeDefined();
    expect(fleet!.payload).toMatchObject({ fleetUtilization: 1.2 });
  });
});

describe('runSystemVitalsPass — robustness', () => {
  it('never throws when a reader throws; still emits the pulse', async () => {
    const { deps, emitted } = baseDeps({
      readGpu: async () => {
        throw new Error('nvidia-smi missing');
      },
      readChildren: () => {
        throw new Error('ps failed');
      },
    });
    await expect(runSystemVitalsPass(deps)).resolves.toBeDefined();
    expect(emitted.find((e) => e.kind === 'resource_threshold')).toBeDefined();
  });
});
