import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetColabStore } from '../../src/fleet/colab-store';
import { FleetAutonomousLoop, type SelfImproveHook, type TaskExecutor } from '../../src/daemon/autonomous-loop';
import type { ModelTierConfig } from '../../src/agent/model-tier';

const TIER: ModelTierConfig = {
  localModel: 'qwen2.5:7b-instruct',
  localBaseUrl: 'http://localhost:11434/v1',
  escalationModel: 'claude-opus-4-8',
};

const noopExecutor: TaskExecutor = async () => ({ ok: true, summary: 'n/a' });

describe('FleetAutonomousLoop — idle self-improvement trigger', () => {
  let dir: string;
  let store: FleetColabStore;
  let prevFlag: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auto-loop-si-'));
    store = new FleetColabStore({ dir, agentId: 'ministar-linux/code-buddy', now: () => 1_000, generateId: (p) => `${p}-x` });
    writeFileSync(join(dir, 'colab-tasks.json'), JSON.stringify({ version: '0.1', tasks: [] }, null, 2)); // idle
    prevFlag = process.env.CODEBUDDY_SELF_IMPROVE;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (prevFlag === undefined) delete process.env.CODEBUDDY_SELF_IMPROVE;
    else process.env.CODEBUDDY_SELF_IMPROVE = prevFlag;
  });

  function loop(selfImprove: SelfImproveHook, now: () => number = () => 0): FleetAutonomousLoop {
    return new FleetAutonomousLoop({
      store,
      tierConfig: TIER,
      executor: noopExecutor,
      selfImprove,
      selfImproveCooldownMs: 1000,
      now,
      // Hermetic: keep the persisted cooldown inside the tmp dir, never ~/.codebuddy.
      selfImproveStatePath: join(dir, 'idle-cooldown.json'),
    });
  }

  it('does NOT self-improve when the flag is off (plain idle)', async () => {
    delete process.env.CODEBUDDY_SELF_IMPROVE;
    const hook = vi.fn(async () => ({ applied: true, detail: 'x' }));
    const r = await loop(hook).tick();
    expect(r.outcome).toBe('idle');
    expect(hook).not.toHaveBeenCalled();
  });

  it('runs one self-improvement cycle when idle + flag on; reports self_improved', async () => {
    process.env.CODEBUDDY_SELF_IMPROVE = 'true';
    const hook = vi.fn(async () => ({ applied: true, detail: 'authored authored__slugify' }));
    const r = await loop(hook).tick();
    expect(r.outcome).toBe('self_improved');
    expect(r.detail).toContain('authored__slugify');
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('respects the cooldown (no second cycle within the window)', async () => {
    process.env.CODEBUDDY_SELF_IMPROVE = 'true';
    const hook = vi.fn(async () => ({ applied: true, detail: 'x' }));
    let t = 0;
    const l = loop(hook, () => t);
    await l.tick(); // t=0 → runs
    t = 500; // within 1000ms cooldown
    const r2 = await l.tick();
    expect(r2.outcome).toBe('idle');
    expect(r2.detail).toContain('cooldown');
    expect(hook).toHaveBeenCalledTimes(1);
    t = 1500; // past cooldown
    const r3 = await l.tick();
    expect(r3.outcome).toBe('self_improved');
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('persists the cooldown across a restart — a fresh loop stays on cooldown (no unbounded cycle on reboot)', async () => {
    process.env.CODEBUDDY_SELF_IMPROVE = 'true';
    const hook = vi.fn(async () => ({ applied: true, detail: 'x' }));
    let t = 10_000;

    // First process runs a cycle at t=10_000 and persists the timestamp.
    await loop(hook, () => t).tick();
    expect(hook).toHaveBeenCalledTimes(1);

    // Daemon restarts within the cooldown window → a BRAND NEW loop instance
    // (lastSelfImproveAt would be -Infinity without persistence).
    t = 10_500; // 500ms later, cooldown is 1000ms
    const rebooted = loop(hook, () => t);
    const r = await rebooted.tick();

    expect(r.outcome).toBe('idle');
    expect(r.detail).toContain('cooldown');
    expect(hook).toHaveBeenCalledTimes(1); // NOT re-fired on restart

    // Past the window, the restored loop resumes normally.
    t = 11_500;
    const r2 = await rebooted.tick();
    expect(r2.outcome).toBe('self_improved');
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('reports idle (not self_improved) when the cycle keeps nothing', async () => {
    process.env.CODEBUDDY_SELF_IMPROVE = 'true';
    const r = await loop(async () => ({ applied: false, detail: 'all covered' })).tick();
    expect(r.outcome).toBe('idle');
    expect(r.detail).toBe('all covered');
  });

  it('never throws — a hook error becomes a safe idle', async () => {
    process.env.CODEBUDDY_SELF_IMPROVE = 'true';
    const r = await loop(async () => { throw new Error('boom'); }).tick();
    expect(r.outcome).toBe('idle');
    expect(r.detail).toContain('boom');
    expect(store.listPresence()['ministar-linux/code-buddy']?.status).toBe('idle');
  });
});
