import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FleetColabStore } from '../../src/fleet/colab-store';

/**
 * Hardening slice (Hermes-kanban parity, step 1 of the unification): lease
 * renewal via heartbeat, zombie detection + persisted retry budget on
 * reclaimExpired, and atomic writes. These are the engine primitives the daemon
 * and (later) the kanban_* tools ride on. Deterministic — injected clock, no
 * real time, no mocks of the store under test.
 */
describe('FleetColabStore — hardening (heartbeat / zombie / retry budget)', () => {
  let dir: string;
  let clock: number;
  let idSeq: number;

  function mk(agentId: string, opts: { retryBudget?: number; claimTtlMs?: number } = {}): FleetColabStore {
    return new FleetColabStore({
      dir,
      agentId,
      claimTtlMs: opts.claimTtlMs ?? 1000,
      ...(opts.retryBudget !== undefined ? { retryBudget: opts.retryBudget } : {}),
      now: () => clock,
      generateId: (p) => `${p}-${++idSeq}`,
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'colab-hardening-'));
    clock = 1000;
    idSeq = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  describe('heartbeat (lease renewal)', () => {
    it('a heartbeated claim is NOT reclaimed past the TTL; a silent one IS', () => {
      const store = mk('m1/repo');
      store.addTask({ title: 'long job', id: 't1' });
      clock = 1000;
      store.claim('t1', 'm1/repo');

      // Worker is alive and renews its lease just before the TTL would expire.
      clock = 1800;
      store.heartbeat('t1', 'm1/repo');

      // 700ms since the heartbeat (< 1000 TTL) → still alive, not reclaimed.
      clock = 2500;
      expect(store.reclaimExpired()).toEqual([]);
      expect(store.getTask('t1')?.status).toBe('in_progress');
      expect(store.getTask('t1')?.lastHeartbeatAt).toBe(new Date(1800).toISOString());

      // Now the worker goes silent: 1500ms since the last heartbeat (> TTL) → zombie.
      clock = 3300;
      expect(store.reclaimExpired()).toEqual(['t1']);
      expect(store.getTask('t1')?.status).toBe('open');
      expect(store.getTask('t1')?.attempts).toBe(1);
    });

    it('rejects heartbeat on a non-in_progress task and on an agent mismatch', () => {
      const store = mk('m1/repo');
      store.addTask({ title: 'x', id: 't1' });
      expect(() => store.heartbeat('t1', 'm1/repo')).toThrow(/not in_progress/);
      store.claim('t1', 'm1/repo');
      expect(() => store.heartbeat('t1', 'someone-else/repo')).toThrow(/claimed by/);
    });
  });

  describe('zombie reclaim + retry budget', () => {
    it('increments attempts under budget (re-opens) and dead-letters at budget', () => {
      const store = mk('m1/repo', { retryBudget: 2 });
      store.addTask({ title: 'flaky', id: 't1', retryBudget: 2 });

      // Round 1: claim then abandon → reclaimed, attempts=1, back to open.
      clock = 1000;
      store.claim('t1', 'm1/repo');
      clock = 3000;
      expect(store.reclaimExpired()).toEqual(['t1']);
      expect(store.getTask('t1')).toMatchObject({ status: 'open', attempts: 1, claimedBy: null });

      // Round 2: claim then abandon again → budget hit → dead-lettered to blocked.
      clock = 4000;
      store.claim('t1', 'm1/repo');
      clock = 6000;
      expect(store.reclaimExpired()).toEqual(['t1']);
      const t = store.getTask('t1');
      expect(t?.status).toBe('blocked');
      expect(t?.attempts).toBe(2);
      expect(t?.blockedReason).toMatch(/retry budget 2 exhausted/);
    });

    it('recordFailure persists attempts and reports exhaustion; resetAttempts clears', () => {
      const store = mk('m1/repo');
      store.addTask({ title: 'f', id: 'f1', retryBudget: 2 });

      expect(store.recordFailure('f1')).toMatchObject({ attempts: 1, exhausted: false });
      expect(store.recordFailure('f1')).toMatchObject({ attempts: 2, exhausted: true });
      // Persisted, not in-memory: a fresh store on the same dir sees attempts=2.
      expect(mk('m1/repo').getTask('f1')?.attempts).toBe(2);

      store.resetAttempts('f1');
      expect(store.getTask('f1')?.attempts).toBe(0);
    });

    it('a per-task retryBudget overrides the store default', () => {
      const store = mk('m1/repo', { retryBudget: 5 });
      store.addTask({ title: 'strict', id: 't1', retryBudget: 1 });
      clock = 1000;
      store.claim('t1', 'm1/repo');
      clock = 3000;
      store.reclaimExpired();
      expect(store.getTask('t1')?.status).toBe('blocked'); // budget 1 → dead-letter on first reclaim
    });
  });

  describe('two machines (the discriminating end-to-end)', () => {
    it('a crashed peer\'s claim is swept by another machine, counted, then dead-lettered', () => {
      const m1 = mk('m1/repo', { retryBudget: 2 });
      const m2 = mk('m2/repo', { retryBudget: 2 });
      m1.addTask({ title: 'shared work', id: 's1', retryBudget: 2 });

      // m1 claims then crashes (no heartbeat).
      clock = 1000;
      m1.claim('s1', 'm1/repo');
      expect(m1.getTask('s1')?.claimedBy).toBe('m1/repo');

      // m2 sweeps the zombie after the TTL → re-opened, attempts=1.
      clock = 3000;
      expect(m2.reclaimExpired()).toEqual(['s1']);
      expect(m2.getTask('s1')).toMatchObject({ status: 'open', attempts: 1, claimedBy: null });

      // m2 claims then also crashes → second reclaim hits the budget → dead-letter.
      clock = 4000;
      m2.claim('s1', 'm2/repo');
      clock = 6000;
      expect(m1.reclaimExpired()).toEqual(['s1']);
      expect(m1.getTask('s1')).toMatchObject({ status: 'blocked', attempts: 2 });
    });
  });

  describe('atomic writes', () => {
    it('leaves no .tmp files and always a parseable tasks file', () => {
      const store = mk('m1/repo');
      store.addTask({ title: 'a', id: 'a1' });
      store.addTask({ title: 'b', id: 'b1' });
      store.claim('a1', 'm1/repo');

      const leftover = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
      expect(leftover).toEqual([]);

      const parsed = JSON.parse(readFileSync(join(dir, 'colab-tasks.json'), 'utf-8'));
      expect(parsed.tasks).toHaveLength(2);
    });
  });
});
