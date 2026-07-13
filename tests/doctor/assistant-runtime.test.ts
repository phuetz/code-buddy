import { describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_REPAIR_SERVICES,
  formatAssistantRuntimeDoctorReport,
  isAssistantRepairService,
  runAssistantRuntimeDoctor,
  type AssistantRepairState,
  type AssistantRepairStateStore,
  type UserServiceController,
} from '../../src/doctor/assistant-runtime.js';

function createServiceController(
  state: 'active' | 'inactive' | 'failed' | 'unknown' = 'active',
): UserServiceController & {
  getActiveState: ReturnType<typeof vi.fn>;
  isLoaded: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
} {
  return {
    getActiveState: vi.fn(async () => state),
    isLoaded: vi.fn(async () => true),
    restart: vi.fn(async () => true),
  };
}

function createStateStore(initial: AssistantRepairState = { version: 1, attempts: [] }):
  AssistantRepairStateStore & {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  } {
  let state = structuredClone(initial);
  return {
    read: vi.fn(async () => structuredClone(state)),
    write: vi.fn(async (next: AssistantRepairState) => {
      state = structuredClone(next);
    }),
  };
}

const okFetch = vi.fn(async () => ({ ok: true, status: 200 }));
const openTcp = vi.fn(async () => true);

describe('assistant runtime doctor', () => {
  it('checks eight known organs without mutating anything in safe mode', async () => {
    const services = createServiceController();
    const stateStore = createStateStore();
    const report = await runAssistantRuntimeDoctor(
      {},
      {
        fetchImpl: okFetch,
        tcpProbe: openTcp,
        services,
        repairStateStore: stateStore,
        now: () => 1_700_000_000_000,
        platform: 'linux',
      },
    );

    expect(report.status).toBe('healthy');
    expect(report.summary).toEqual({ healthy: 8, unhealthy: 0, unknown: 0, total: 8 });
    expect(report.probes.map((probe) => probe.id)).toEqual([
      'brain',
      'pocket-tts',
      'cowork-cdp',
      'ollama-local',
      'sensory-bridge',
      'buddy-sense',
      'vision-eye',
      'telegram',
    ]);
    expect(report.repair.requested).toBe(false);
    expect(stateStore.read).not.toHaveBeenCalled();
    expect(stateStore.write).not.toHaveBeenCalled();
    expect(services.isLoaded).not.toHaveBeenCalled();
    expect(services.restart).not.toHaveBeenCalled();
  });

  it('bounds a fetch implementation that ignores AbortSignal', async () => {
    const hangingFetch = vi.fn(
      async (url: string): Promise<{ ok: boolean; status: number }> =>
        url.includes(':3055')
          ? await new Promise<{ ok: boolean; status: number }>(() => undefined)
          : { ok: true, status: 200 },
    );
    const startedAt = Date.now();
    const report = await runAssistantRuntimeDoctor(
      { probeTimeoutMs: 50 },
      {
        fetchImpl: hangingFetch,
        tcpProbe: openTcp,
        services: createServiceController(),
        now: Date.now,
        platform: 'linux',
      },
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(report.probes.find((probe) => probe.id === 'brain')).toMatchObject({
      status: 'unhealthy',
      detail: 'timeout',
    });
  });

  it('restarts only unhealthy allowlisted loaded services and enforces the per-run limit', async () => {
    const services = createServiceController('inactive');
    const stateStore = createStateStore();
    const report = await runAssistantRuntimeDoctor(
      { repair: true, maxRepairsPerRun: 2 },
      {
        fetchImpl: vi.fn(async () => ({ ok: false, status: 503 })),
        tcpProbe: vi.fn(async () => false),
        services,
        repairStateStore: stateStore,
        now: () => 100_000,
        platform: 'linux',
      },
    );

    expect(report.repair.candidates.length).toBe(7);
    expect(report.repair.attempts).toHaveLength(2);
    expect(services.restart).toHaveBeenCalledTimes(2);
    for (const [service] of services.restart.mock.calls) {
      expect(isAssistantRepairService(String(service))).toBe(true);
    }
    expect(report.repair.skipped.filter((item) => item.reason === 'per-run-limit')).toHaveLength(5);
    expect(stateStore.write).toHaveBeenCalledTimes(2);
  });

  it('deduplicates brain and sensory failures into one restart candidate', async () => {
    const services = createServiceController();
    const report = await runAssistantRuntimeDoctor(
      { repair: true },
      {
        fetchImpl: vi.fn(async (url: string) => ({ ok: !url.includes(':3055'), status: 503 })),
        tcpProbe: vi.fn(async () => false),
        services,
        repairStateStore: createStateStore(),
        now: () => 100_000,
        platform: 'linux',
      },
    );

    expect(report.repair.candidates).toEqual(['buddy-vision-brain']);
    expect(services.restart).toHaveBeenCalledWith('buddy-vision-brain', expect.any(Number));
    expect(services.restart).toHaveBeenCalledTimes(1);
  });

  it('honours the persistent per-service cooldown', async () => {
    const services = createServiceController();
    const stateStore = createStateStore({
      version: 1,
      attempts: [{ service: 'buddy-vision-brain', attemptedAt: 99_000 }],
    });
    const report = await runAssistantRuntimeDoctor(
      { repair: true },
      {
        fetchImpl: vi.fn(async (url: string) => ({ ok: !url.includes(':3055'), status: 503 })),
        tcpProbe: openTcp,
        services,
        repairStateStore: stateStore,
        now: () => 100_000,
        platform: 'linux',
      },
    );

    expect(services.restart).not.toHaveBeenCalled();
    expect(report.repair.skipped).toEqual([
      {
        service: 'buddy-vision-brain',
        reason: 'cooldown',
        cooldownRemainingMs: 299_000,
      },
    ]);
  });

  it('enforces the persistent global repair window limit', async () => {
    const services = createServiceController();
    const stateStore = createStateStore({
      version: 1,
      attempts: [
        { service: 'buddy-sense', attemptedAt: 95_000 },
        { service: 'buddy-vision-eye', attemptedAt: 96_000 },
      ],
    });
    const report = await runAssistantRuntimeDoctor(
      { repair: true, maxRepairsPerWindow: 2 },
      {
        fetchImpl: vi.fn(async (url: string) => ({ ok: !url.includes(':3055'), status: 503 })),
        tcpProbe: openTcp,
        services,
        repairStateStore: stateStore,
        now: () => 100_000,
        platform: 'linux',
      },
    );

    expect(services.restart).not.toHaveBeenCalled();
    expect(report.repair.skipped).toEqual([
      { service: 'buddy-vision-brain', reason: 'global-rate-limit' },
    ]);
  });

  it('fails closed when the unit is not loaded or repair state is unavailable', async () => {
    const services = createServiceController();
    services.isLoaded.mockResolvedValue(false);
    const unhealthyBrain = vi.fn(async (url: string) => ({
      ok: !url.includes(':3055'),
      status: 503,
    }));
    const notLoaded = await runAssistantRuntimeDoctor(
      { repair: true },
      {
        fetchImpl: unhealthyBrain,
        tcpProbe: openTcp,
        services,
        repairStateStore: createStateStore(),
        now: () => 100_000,
        platform: 'linux',
      },
    );
    expect(notLoaded.repair.skipped[0]?.reason).toBe('service-not-loaded');
    expect(services.restart).not.toHaveBeenCalled();

    services.isLoaded.mockResolvedValue(true);
    const unavailableStore: AssistantRepairStateStore = {
      read: vi.fn(async () => {
        throw new Error('secret repair storage error');
      }),
      write: vi.fn(async () => undefined),
    };
    const unavailable = await runAssistantRuntimeDoctor(
      { repair: true },
      {
        fetchImpl: unhealthyBrain,
        tcpProbe: openTcp,
        services,
        repairStateStore: unavailableStore,
        now: () => 100_000,
        platform: 'linux',
      },
    );
    expect(unavailable.repair.skipped[0]?.reason).toBe('repair-state-unavailable');
    expect(services.restart).not.toHaveBeenCalled();
  });

  it('does not treat unknown systemd probes as repair candidates or leak dependency errors', async () => {
    const marker = 'DO_NOT_LEAK_THIS_API_SECRET';
    const services = createServiceController('unknown');
    const report = await runAssistantRuntimeDoctor(
      { repair: true },
      {
        fetchImpl: vi.fn(async () => {
          throw new Error(marker);
        }),
        tcpProbe: vi.fn(async () => {
          throw new Error(marker);
        }),
        services,
        repairStateStore: createStateStore(),
        now: () => 100_000,
        platform: 'linux',
      },
    );

    expect(services.restart).toHaveBeenCalledTimes(3);
    expect(report.repair.candidates).not.toContain('buddy-sense');
    expect(report.repair.candidates).not.toContain('buddy-vision-eye');
    expect(report.repair.candidates).not.toContain('lisa-telegram');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain('OPENAI_API_KEY');
    expect(serialized).not.toContain('process.env');
  });

  it('has a closed repair allowlist and a clear human safe-mode report', async () => {
    expect(ASSISTANT_REPAIR_SERVICES).not.toContain('codebuddy-a2a');
    expect(ASSISTANT_REPAIR_SERVICES).not.toContain('codebuddy-fleet');
    expect(isAssistantRepairService('malicious.service')).toBe(false);

    const report = await runAssistantRuntimeDoctor(
      {},
      {
        fetchImpl: vi.fn(async () => ({ ok: false, status: 503 })),
        tcpProbe: vi.fn(async () => false),
        services: createServiceController('inactive'),
        now: () => 100_000,
        platform: 'linux',
      },
    );
    const output = formatAssistantRuntimeDoctorReport(report);
    expect(output).toContain('Safe diagnosis only: no service was changed.');
    expect(output).toContain('buddy assistant doctor --repair');
  });
});
