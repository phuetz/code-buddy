import { DiffFirstManager } from '../../../src/channels/pro/diff-first.js';
import type { FileDiffSummary, PendingDiff } from '../../../src/channels/pro/types.js';

function makeDiff(overrides?: Partial<FileDiffSummary>): FileDiffSummary {
  return {
    path: 'src/index.ts',
    action: 'modify',
    linesAdded: 5,
    linesRemoved: 2,
    excerpt: '+const x = 1;\n-const y = 2;',
    ...overrides,
  };
}

describe('DiffFirstManager', () => {
  let manager: DiffFirstManager;

  beforeEach(() => {
    manager = new DiffFirstManager();
  });

  describe('createPendingDiff', () => {
    it('should create a pending diff with a unique 6-char hex ID', () => {
      const diff = manager.createPendingDiff('chat1', 'user1', 1, [makeDiff()]);
      expect(diff.id).toMatch(/^[0-9a-f]{6}$/);
      expect(diff.chatId).toBe('chat1');
      expect(diff.userId).toBe('user1');
      expect(diff.turnId).toBe(1);
      expect(diff.status).toBe('pending');
      expect(diff.diffs).toHaveLength(1);
    });

    it('should generate unique IDs for successive diffs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const diff = manager.createPendingDiff('chat1', 'user1', i, [makeDiff()]);
        ids.add(diff.id);
      }
      expect(ids.size).toBe(20);
    });

    it('should store plan and fullDiff when provided', () => {
      const diff = manager.createPendingDiff(
        'chat1', 'user1', 1, [makeDiff()],
        'Step 1: modify index', 'full unified diff here'
      );
      expect(diff.plan).toBe('Step 1: modify index');
      expect(diff.fullDiff).toBe('full unified diff here');
    });

    it('should set expiresAt in the future', () => {
      const before = Date.now();
      const diff = manager.createPendingDiff('chat1', 'user1', 1, [makeDiff()]);
      expect(diff.expiresAt).toBeGreaterThan(before);
      expect(diff.expiresAt - diff.createdAt).toBe(30 * 60 * 1000);
    });
  });

  describe('getPendingDiff', () => {
    it('should return the pending diff by ID', () => {
      const created = manager.createPendingDiff('chat1', 'user1', 1, [makeDiff()]);
      const retrieved = manager.getPendingDiff(created.id);
      expect(retrieved).toBe(created);
    });

    it('should return undefined for unknown ID', () => {
      expect(manager.getPendingDiff('000000')).toBeUndefined();
    });
  });

  describe('formatFullDiff', () => {
    it('should return fullDiff when available', () => {
      const pending = manager.createPendingDiff(
        'c', 'u', 1, [makeDiff()], undefined, 'the full diff'
      );
      expect(manager.formatFullDiff(pending)).toBe('the full diff');
    });

    it('should build diff from excerpts when fullDiff is absent', () => {
      const pending = manager.createPendingDiff('c', 'u', 1, [
        makeDiff({ path: 'foo.ts', excerpt: '+added line' }),
      ]);
      const result = manager.formatFullDiff(pending);
      expect(result).toContain('--- a/foo.ts');
      expect(result).toContain('+++ b/foo.ts');
      expect(result).toContain('+added line');
    });
  });

  describe('handleApply', () => {
    it('should apply successfully for the requesting user', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff(), makeDiff()]);
      const result = await manager.handleApply(pending.id, 'user1');
      expect(result.success).toBe(true);
      expect(result.filesApplied).toBe(2);
      expect(manager.getPendingDiff(pending.id)!.status).toBe('applied');
    });

    it('should reject apply from a different user', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      const result = await manager.handleApply(pending.id, 'user2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Only the requesting user');
      expect(manager.getPendingDiff(pending.id)!.status).toBe('pending');
    });

    it('should reject apply for unknown diff ID', async () => {
      const result = await manager.handleApply('badid1', 'user1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject apply for already applied diff', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      await manager.handleApply(pending.id, 'user1');
      const result = await manager.handleApply(pending.id, 'user1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already applied');
    });

    it('should reject apply for expired diff', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      pending.expiresAt = Date.now() - 1000;
      const result = await manager.handleApply(pending.id, 'user1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
      expect(pending.status).toBe('expired');
    });

    it('should invoke onApply callback when set', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      const mockResult = { success: true, filesApplied: 1 };
      manager.onApply = jest.fn().mockResolvedValue(mockResult);

      const result = await manager.handleApply(pending.id, 'user1');
      expect(manager.onApply).toHaveBeenCalledWith(pending);
      expect(result).toEqual(mockResult);
      expect(pending.status).toBe('applied');
    });

    it('should keep status pending if onApply returns failure', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      manager.onApply = jest.fn().mockResolvedValue({
        success: false, filesApplied: 0, error: 'patch failed',
      });

      const result = await manager.handleApply(pending.id, 'user1');
      expect(result.success).toBe(false);
      expect(pending.status).toBe('pending');
    });
  });

  describe('handleCancel', () => {
    it('should cancel successfully for the requesting user', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      const result = await manager.handleCancel(pending.id, 'user1');
      expect(result.success).toBe(true);
      expect(pending.status).toBe('cancelled');
    });

    it('should reject cancel from a different user', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      const result = await manager.handleCancel(pending.id, 'user2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Only the requesting user');
    });

    it('should reject cancel for unknown diff', async () => {
      const result = await manager.handleCancel('nope00', 'user1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject cancel for already cancelled diff', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      await manager.handleCancel(pending.id, 'user1');
      const result = await manager.handleCancel(pending.id, 'user1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already cancelled');
    });

    it('should invoke onCancel callback when set', async () => {
      const pending = manager.createPendingDiff('c', 'user1', 1, [makeDiff()]);
      manager.onCancel = jest.fn().mockResolvedValue(undefined);
      await manager.handleCancel(pending.id, 'user1');
      expect(manager.onCancel).toHaveBeenCalledWith(pending);
    });
  });

  describe('handleViewFull', () => {
    it('should return the full diff for an existing pending diff', () => {
      const pending = manager.createPendingDiff(
        'c', 'u', 1, [makeDiff()], undefined, 'full content'
      );
      expect(manager.handleViewFull(pending.id)).toBe('full content');
    });

    it('should return null for unknown diff ID', () => {
      expect(manager.handleViewFull('missing')).toBeNull();
    });

    it('should build from excerpts when no fullDiff stored', () => {
      const pending = manager.createPendingDiff('c', 'u', 1, [
        makeDiff({ path: 'x.ts', excerpt: '+new' }),
      ]);
      const result = manager.handleViewFull(pending.id);
      expect(result).toContain('--- a/x.ts');
      expect(result).toContain('+new');
    });
  });

  describe('shouldAutoApply', () => {
    it('should return false when threshold is 0', () => {
      expect(manager.shouldAutoApply([makeDiff({ linesAdded: 1, linesRemoved: 0 })])).toBe(false);
    });

    it('should return true when total changes are within threshold', () => {
      const mgr = new DiffFirstManager({ autoApplyThreshold: 10 });
      const result = mgr.shouldAutoApply([
        makeDiff({ linesAdded: 3, linesRemoved: 2 }),
      ]);
      expect(result).toBe(true);
    });

    it('should return false when total changes exceed threshold', () => {
      const mgr = new DiffFirstManager({ autoApplyThreshold: 5 });
      const result = mgr.shouldAutoApply([
        makeDiff({ linesAdded: 3, linesRemoved: 3 }),
      ]);
      expect(result).toBe(false);
    });

    it('should sum across multiple files', () => {
      const mgr = new DiffFirstManager({ autoApplyThreshold: 10 });
      const result = mgr.shouldAutoApply([
        makeDiff({ linesAdded: 3, linesRemoved: 2 }),
        makeDiff({ linesAdded: 4, linesRemoved: 2 }),
      ]);
      expect(result).toBe(false);
    });
  });

  describe('cleanupExpired', () => {
    it('should mark expired pending diffs and return count', () => {
      const d1 = manager.createPendingDiff('c', 'u', 1, [makeDiff()]);
      const d2 = manager.createPendingDiff('c', 'u', 2, [makeDiff()]);
      d1.expiresAt = Date.now() - 1000;

      const cleaned = manager.cleanupExpired();
      expect(cleaned).toBe(1);
      expect(d1.status).toBe('expired');
      expect(d2.status).toBe('pending');
    });

    it('should not count already non-pending diffs as cleaned', async () => {
      const d1 = manager.createPendingDiff('c', 'u', 1, [makeDiff()]);
      await manager.handleCancel(d1.id, 'u');
      d1.expiresAt = Date.now() - 1000;
      expect(manager.cleanupExpired()).toBe(0);
    });
  });

  describe('enforceLimit', () => {
    it('should keep at most 50 pending diffs', () => {
      for (let i = 0; i < 55; i++) {
        manager.createPendingDiff('c', 'u', i, [makeDiff()]);
      }
      const last = manager.createPendingDiff('c', 'u', 99, [makeDiff()]);
      expect(manager.getPendingDiff(last.id)).toBeDefined();
    });

    it('should remove oldest non-pending entries first', async () => {
      const diffs: PendingDiff[] = [];
      for (let i = 0; i < 50; i++) {
        diffs.push(manager.createPendingDiff('c', 'u', i, [makeDiff()]));
      }
      for (let i = 0; i < 5; i++) {
        await manager.handleCancel(diffs[i].id, 'u');
      }
      for (let i = 0; i < 3; i++) {
        manager.createPendingDiff('c', 'u', 100 + i, [makeDiff()]);
      }
      for (let i = 0; i < 3; i++) {
        expect(manager.getPendingDiff(diffs[i].id)).toBeUndefined();
      }
      expect(manager.getPendingDiff(diffs[49].id)).toBeDefined();
    });
  });
});
