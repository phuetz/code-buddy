/**
 * Bounded kill_process action — red→green for the 05/09 runaway remediation.
 *
 * A live kill requires BOTH dryRun:false on the rule AND CODEBUDDY_RUNAWAY_KILL=true.
 * The pid comes ONLY from the process_runaway percept. process.kill is always spied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import type { BaseEvent } from '../../src/events/types.js';
import {
  executeSensoryAction,
  isDestructiveAction,
  type KillProcessDeps,
  type ProcIdentity,
  type SensoryEventContext,
} from '../../src/sensory/sensory-action-executor.js';
import { validateRule, type SensoryRule } from '../../src/sensory/sensory-rules-engine.js';

const TARGET_PID = 4242;
const START = 12_345;
const UID = 1000;

function identity(over: Partial<ProcIdentity> = {}): ProcIdentity {
  return {
    pid: TARGET_PID,
    ppid: 1,
    comm: 'bash',
    startTime: START,
    uid: UID,
    ...over,
  };
}

function runawayCtx(over: Partial<SensoryEventContext> = {}): SensoryEventContext {
  return {
    modality: 'system',
    kind: 'process_runaway',
    payload: {
      pid: TARGET_PID,
      ppid: 1,
      comm: 'bash',
      startTime: START,
      pcpuTotal: 99.9,
      etimeSec: 9000,
      scope: 'user',
    },
    ...over,
  };
}

function table(entries: ProcIdentity[]): (pid: number) => ProcIdentity | null {
  const map = new Map(entries.map((e) => [e.pid, e]));
  return (pid) => map.get(pid) ?? null;
}

function collectRemediated(): { events: Array<Record<string, unknown>>; off: () => void } {
  const events: Array<Record<string, unknown>> = [];
  const bus = getGlobalEventBus();
  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const m = evt.metadata as { modality?: string; kind?: string; payload?: Record<string, unknown> } | undefined;
    if (m?.modality === 'system' && m.kind === 'process_remediated') {
      events.push(m.payload ?? {});
    }
  });
  return { events, off: () => bus.off(id) };
}

describe('kill_process action', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.CODEBUDDY_RUNAWAY_KILL;
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_RUNAWAY_KILL;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function deps(over: Partial<KillProcessDeps> = {}): KillProcessDeps {
    return {
      readProc: table([identity()]),
      getuid: () => UID,
      selfPid: 9_001,
      ...over,
    };
  }

  it('pid absent → no-op journalisé, aucun process.kill', async () => {
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx(),
      deps({ readProc: () => null }),
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/pid absent/i);
    expect(killSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('pid absent'))).toBe(true);
  });

  it('comm différent → refus, aucun process.kill', async () => {
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx(),
      deps({ readProc: table([identity({ comm: 'sshd' })]) }),
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/comm/i);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('startTime différent → refus (anti PID-reuse)', async () => {
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx(),
      deps({ readProc: table([identity({ startTime: START + 99 })]) }),
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/startTime/i);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('pid = process.pid → refus', async () => {
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx({
        payload: { pid: process.pid, comm: 'node', startTime: START },
      }),
      deps({
        readProc: table([identity({ pid: process.pid, comm: 'node' })]),
        selfPid: process.pid,
      }),
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/self/i);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('pid ancêtre du serveur → refus', async () => {
    const ancestor = 777;
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx({
        payload: { pid: ancestor, comm: 'bash', startTime: 2 },
      }),
      deps({
        selfPid: process.pid,
        readProc: (pid) => {
          if (pid === process.pid) return identity({ pid: process.pid, ppid: ancestor, comm: 'node', startTime: 1 });
          if (pid === ancestor) return identity({ pid: ancestor, ppid: 1, comm: 'bash', startTime: 2 });
          return null;
        },
      }),
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/ancestor/i);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('pid 1 → refus', async () => {
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx({ payload: { pid: 1, comm: 'init', startTime: 1 } }),
      deps({ readProc: table([identity({ pid: 1, comm: 'init', startTime: 1 })]) }),
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/pid 1/i);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('autre uid → refus', async () => {
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx(),
      deps({ readProc: table([identity({ uid: 0 })]) }),
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/uid/i);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('pid négatif (groupe) → refus, jamais process.kill', async () => {
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx({ payload: { pid: -TARGET_PID, comm: 'bash', startTime: START } }),
      deps(),
    );
    expect(res.ok).toBe(false);
    expect(String(res.detail)).toMatch(/invalid pid|pid/i);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('ignore un pid porté par la règle : seul le pid du percept compte', async () => {
    process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false, pid: 1 } as never,
      runawayCtx(),
      deps(),
    );
    expect(res.ok).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(TARGET_PID, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(1, expect.anything());
    expect(killSpy).not.toHaveBeenCalledWith(-TARGET_PID, expect.anything());
  });

  it('dryRun (défaut) → aucun process.kill même si CODEBUDDY_RUNAWAY_KILL=true', async () => {
    process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
    const res = await executeSensoryAction({ type: 'kill_process' }, runawayCtx(), deps());
    expect(res.ok).toBe(true);
    expect(String(res.detail)).toMatch(/dryRun/i);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("sans env, dryRun:false reste un dry-run avec reason:'CODEBUDDY_RUNAWAY_KILL unset'", async () => {
    const col = collectRemediated();
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx(),
      deps(),
    );
    col.off();
    expect(res.ok).toBe(true);
    expect(String(res.detail)).toContain('CODEBUDDY_RUNAWAY_KILL unset');
    expect(killSpy).not.toHaveBeenCalled();
    expect(col.events[0]).toMatchObject({
      pid: TARGET_PID,
      comm: 'bash',
      dryRun: true,
      ok: true,
      reason: 'CODEBUDDY_RUNAWAY_KILL unset',
    });
  });

  it("avec env + dryRun:false → process.kill(pid,'SIGTERM')", async () => {
    process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
    const res = await executeSensoryAction(
      { type: 'kill_process', dryRun: false },
      runawayCtx(),
      deps(),
    );
    expect(res.ok).toBe(true);
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(TARGET_PID, 'SIGTERM');
  });

  it('escalate:true → SIGKILL après graceMs (fake timers)', async () => {
    process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
    vi.useFakeTimers();
    const pending = executeSensoryAction(
      { type: 'kill_process', dryRun: false, escalate: true, graceMs: 5000 },
      runawayCtx(),
      deps(),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(killSpy).toHaveBeenCalledWith(TARGET_PID, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(TARGET_PID, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(4999);
    expect(killSpy).not.toHaveBeenCalledWith(TARGET_PID, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.ok).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(TARGET_PID, 'SIGKILL');
  });

  it('graceMs est borné : 500 → 1000 ; 999999 → 60000', async () => {
    process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
    vi.useFakeTimers();
    const pending = executeSensoryAction(
      { type: 'kill_process', dryRun: false, escalate: true, graceMs: 500 },
      runawayCtx(),
      deps(),
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(killSpy).not.toHaveBeenCalledWith(TARGET_PID, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(killSpy).toHaveBeenCalledWith(TARGET_PID, 'SIGKILL');
  });

  it('après action, émet process_remediated (modality system)', async () => {
    process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
    const col = collectRemediated();
    await executeSensoryAction({ type: 'kill_process', dryRun: false }, runawayCtx(), deps());
    col.off();
    expect(col.events).toHaveLength(1);
    expect(col.events[0]).toMatchObject({
      pid: TARGET_PID,
      comm: 'bash',
      signal: 'SIGTERM',
      dryRun: false,
      ok: true,
    });
  });

  it('sans variable ni règle kill_process : shell/alert inchangés, aucun process.kill (byte-identique)', async () => {
    const shell = await executeSensoryAction(
      { type: 'shell', command: 'printf hi' },
      { kind: 'person_entered' },
    );
    expect(shell.ok).toBe(true);
    expect(shell.detail).toBe('hi');
    expect(killSpy).not.toHaveBeenCalled();
    expect(isDestructiveAction({ type: 'alert' })).toBe(false);
    expect(isDestructiveAction({ type: 'kill_process' })).toBe(false);
    expect(isDestructiveAction({ type: 'kill_process', dryRun: false })).toBe(true);
  });
});

describe('validateRule — kill_process', () => {
  const base = (over: Partial<SensoryRule> = {}): SensoryRule => ({
    id: 'k1',
    match: { modality: 'system', kind: 'process_runaway' },
    action: { type: 'kill_process' },
    ...over,
  });

  it('accepte une règle kill_process sans dryRun:false (défaut dry-run)', () => {
    const v = validateRule(base());
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('accepte dryRun:false si match.kind est process_runaway', () => {
    const v = validateRule(base({ action: { type: 'kill_process', dryRun: false } }));
    expect(v.ok).toBe(true);
  });

  it('REFUSE kill_process dont match.kind n’est pas process_runaway', () => {
    const v = validateRule({
      id: 'bad',
      match: { kind: 'person_entered' },
      action: { type: 'kill_process', dryRun: true },
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/process_runaway/);
  });

  it('REFUSE un pid libre dans la règle', () => {
    const v = validateRule(
      base({ action: { type: 'kill_process', pid: 4242 } as never }),
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/pid/i);
  });
});
