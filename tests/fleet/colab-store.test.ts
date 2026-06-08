import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FleetColabStore, defaultFleetAgentId } from '../../src/fleet/colab-store';

describe('FleetColabStore', () => {
  let dir: string;
  let store: FleetColabStore;
  let idSeq: number;

  function seedTasks(tasks: unknown[]): void {
    writeFileSync(join(dir, 'colab-tasks.json'), JSON.stringify({
      version: '0.1',
      comment: 'human comment that must be preserved',
      tasks,
    }, null, 2));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'colab-store-'));
    idSeq = 0;
    store = new FleetColabStore({
      dir,
      agentId: 'ministar-linux/code-buddy',
      now: () => 1_000_000,
      generateId: (p) => `${p}-${++idSeq}`,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('isAutoClaimable (safety guardrail)', () => {
    it('allows open + unclaimed + non-critical', () => {
      expect(store.isAutoClaimable({ status: 'open', priority: 'high', claimedBy: null })).toBe(true);
    });
    it('never auto-claims critical tasks', () => {
      expect(store.isAutoClaimable({ status: 'open', priority: 'critical', claimedBy: null })).toBe(false);
    });
    it('rejects already-claimed or non-open tasks', () => {
      expect(store.isAutoClaimable({ status: 'open', priority: 'high', claimedBy: 'other' })).toBe(false);
      expect(store.isAutoClaimable({ status: 'in_progress', priority: 'high', claimedBy: null })).toBe(false);
    });
  });

  describe('nextClaimable', () => {
    beforeEach(() => {
      seedTasks([
        { id: 't-low', title: 'low', status: 'open', priority: 'low', claimedBy: null },
        { id: 't-high', title: 'high', status: 'open', priority: 'high', claimedBy: null },
        { id: 't-claimed', title: 'claimed high', status: 'open', priority: 'high', claimedBy: 'someone' },
        { id: 't-crit', title: 'critical', status: 'open', priority: 'critical', claimedBy: null },
        { id: 't-done', title: 'done', status: 'completed', priority: 'high', claimedBy: 'x' },
      ]);
    });

    it('picks the highest-priority open + unclaimed + non-critical task', () => {
      expect(store.nextClaimable()?.id).toBe('t-high');
    });

    it('excludes critical unless explicitly allowed', () => {
      // Claim the two non-critical open tasks so only t-crit remains.
      store.claim('t-high');
      store.claim('t-low');
      expect(store.nextClaimable()).toBeNull();
      expect(store.nextClaimable({ allowCritical: true })?.id).toBe('t-crit');
    });
  });

  describe('claim', () => {
    beforeEach(() => {
      seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'high', claimedBy: null }]);
    });

    it('marks the task in_progress with claimant + timestamp', () => {
      const claimed = store.claim('t1');
      expect(claimed.status).toBe('in_progress');
      expect(claimed.claimedBy).toBe('ministar-linux/code-buddy');
      expect(claimed.claimedAt).toBe(new Date(1_000_000).toISOString());
    });

    it('throws when claiming a task already owned by another agent', () => {
      store.claim('t1', 'other/agent');
      expect(() => store.claim('t1')).toThrow(/already claimed/);
    });

    it('throws when the task is not open (and unclaimed)', () => {
      store.blockTask('t1', 'needs input');
      expect(() => store.claim('t1', 'x')).toThrow(/not open/);
    });
  });

  describe('completeTask', () => {
    beforeEach(() => {
      seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'high', claimedBy: null }]);
    });

    it('marks completed and appends a worklog entry', () => {
      store.claim('t1');
      const { task, worklog } = store.completeTask('t1', {
        summary: 'did the thing',
        filesModified: [{ file: 'a.ts', changes: 'edit' }],
        elapsedSeconds: 42,
        nextSteps: ['next'],
      });
      expect(task.status).toBe('completed');
      expect(task.completedAt).toBe(new Date(1_000_000).toISOString());
      expect(worklog.taskId).toBe('t1');
      expect(worklog.summary).toBe('did the thing');
      expect(worklog.elapsedSeconds).toBe(42);
      expect(store.listWorklog()).toHaveLength(1);
    });
  });

  describe('block / release / add', () => {
    beforeEach(() => {
      seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'high', claimedBy: null }]);
    });

    it('blocks with a reason', () => {
      expect(store.blockTask('t1', 'needs key').status).toBe('blocked');
      expect(store.getTask('t1')?.blockedReason).toBe('needs key');
    });

    it('releases a claimed task back to open', () => {
      store.claim('t1');
      const released = store.releaseTask('t1');
      expect(released.status).toBe('open');
      expect(released.claimedBy).toBeNull();
    });

    it('adds a new open task with defaults', () => {
      const task = store.addTask({ title: 'new work', priority: 'low' });
      expect(task.status).toBe('open');
      expect(task.priority).toBe('low');
      expect(task.createdBy).toBe('ministar-linux/code-buddy');
      expect(store.listTasks({ status: 'open' }).map((t) => t.title)).toContain('new work');
    });
  });

  describe('presence', () => {
    it('updates and lists presence, and detects stale agents', () => {
      const lateStore = new FleetColabStore({ dir, agentId: 'a/x', now: () => 100_000, generateId: (p) => p });
      lateStore.updatePresence({ status: 'active', currentTask: 'doing x' });

      const nowStore = new FleetColabStore({ dir, agentId: 'b/y', now: () => 100_000 + 70_000, generateId: (p) => p });
      nowStore.updatePresence({ status: 'active' });

      const presence = nowStore.listPresence();
      expect(presence['a/x']?.currentTask).toBe('doing x');
      expect(presence['b/y']?.status).toBe('active');

      // a/x last seen at 100_000; now is 170_000 -> stale beyond 60s.
      expect(nowStore.stalePresence(60_000)).toEqual(['a/x']);
    });
  });

  describe('persistence', () => {
    it('preserves the human version/comment fields on write', () => {
      seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'low', claimedBy: null }]);
      store.claim('t1');
      const raw = JSON.parse(readFileSync(join(dir, 'colab-tasks.json'), 'utf-8')) as { version: string; comment: string };
      expect(raw.version).toBe('0.1');
      expect(raw.comment).toBe('human comment that must be preserved');
    });
  });

  describe('dependencies (DAG)', () => {
    it('a task with unmet dependencies is not claimable', () => {
      seedTasks([
        { id: 'parent', title: 'p', status: 'open', priority: 'high', claimedBy: null },
        { id: 'child', title: 'c', status: 'open', priority: 'high', claimedBy: null, dependsOn: ['parent'] },
      ]);
      expect(store.nextClaimable()?.id).toBe('parent');
      expect(() => store.claim('child')).toThrow(/unmet dependencies: parent/);
    });

    it('the child becomes claimable once the parent is completed', () => {
      seedTasks([
        { id: 'parent', title: 'p', status: 'open', priority: 'low', claimedBy: null },
        { id: 'child', title: 'c', status: 'open', priority: 'high', claimedBy: null, dependsOn: ['parent'] },
      ]);
      expect(store.nextClaimable()?.id).toBe('parent'); // child (high) is blocked
      store.claim('parent');
      store.completeTask('parent', { summary: 'done' });
      expect(store.nextClaimable()?.id).toBe('child'); // now unblocked
      expect(store.claim('child').status).toBe('in_progress');
    });

    it('treats a missing dependency id as unmet', () => {
      seedTasks([{ id: 'child', title: 'c', status: 'open', priority: 'high', claimedBy: null, dependsOn: ['ghost'] }]);
      expect(store.nextClaimable()).toBeNull();
      expect(store.unmetDependencies({ dependsOn: ['ghost'] }, store.listTasks())).toEqual(['ghost']);
    });

    it('link/unlink edges, rejecting self-links and unknown deps', () => {
      seedTasks([
        { id: 'a', title: 'a', status: 'open', priority: 'high', claimedBy: null },
        { id: 'b', title: 'b', status: 'open', priority: 'high', claimedBy: null },
      ]);
      expect(store.link('b', 'a').dependsOn).toEqual(['a']);
      expect(() => store.claim('b')).toThrow(/unmet dependencies: a/);
      expect(store.unlink('b', 'a')).toBe(true);
      expect(store.unlink('b', 'a')).toBe(false);
      expect(() => store.link('a', 'a')).toThrow(/cannot depend on itself/);
      expect(() => store.link('a', 'ghost')).toThrow(/Unknown dependency/);
    });
  });

  describe('claim TTL / lease (reclaim a crashed agent)', () => {
    const claimedAt = new Date(5_000).toISOString();
    function seedInProgress(): void {
      writeFileSync(join(dir, 'colab-tasks.json'), JSON.stringify({
        version: '0.1',
        tasks: [{ id: 't1', title: 'task', status: 'in_progress', priority: 'high', claimedBy: 'dead/agent', claimedAt }],
      }, null, 2));
    }

    it('treats an in_progress task with an expired claim as reclaimable', () => {
      seedInProgress();
      const ttlStore = new FleetColabStore({ dir, agentId: 'me/cb', claimTtlMs: 1000, now: () => 10_000 });
      expect(ttlStore.isClaimExpired({ status: 'in_progress', claimedAt })).toBe(true);
      expect(ttlStore.nextClaimable()?.id).toBe('t1');
      const claimed = ttlStore.claim('t1'); // reclaim the dead agent's task
      expect(claimed.claimedBy).toBe('me/cb');
      expect(claimed.status).toBe('in_progress');
    });

    it('does NOT reclaim a fresh claim still held by another agent', () => {
      seedInProgress();
      const ttlStore = new FleetColabStore({ dir, agentId: 'me/cb', claimTtlMs: 1000, now: () => 5_500 });
      expect(ttlStore.isClaimExpired({ status: 'in_progress', claimedAt })).toBe(false);
      expect(ttlStore.nextClaimable()).toBeNull();
      expect(() => ttlStore.claim('t1')).toThrow(/already claimed/);
    });

    it('reclaimExpired() sweeps expired claims back to open', () => {
      seedInProgress();
      const ttlStore = new FleetColabStore({ dir, claimTtlMs: 1000, now: () => 10_000 });
      expect(ttlStore.reclaimExpired()).toEqual(['t1']);
      expect(ttlStore.getTask('t1')?.status).toBe('open');
      expect(ttlStore.getTask('t1')?.claimedBy).toBeNull();
    });

    it('a TTL of 0 disables expiry', () => {
      const ttlStore = new FleetColabStore({ dir, claimTtlMs: 0, now: () => 1e12 });
      expect(ttlStore.isClaimExpired({ status: 'in_progress', claimedAt })).toBe(false);
    });
  });

  describe('defaultFleetAgentId', () => {
    it('is shaped host/repo', () => {
      expect(defaultFleetAgentId('/home/x/code-buddy')).toMatch(/^[^/]+\/code-buddy$/);
    });
  });
});
