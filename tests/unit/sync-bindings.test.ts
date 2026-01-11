/**
 * Sync Bindings Tests
 *
 * Tests the FCS sync bindings and WorkspaceStateTracker
 */

import {
  WorkspaceStateTracker,
  createSyncBindings,
  getWorkspaceTracker,
  resetWorkspaceTracker,
  type FileState,
  type WorkspaceSnapshot,
} from '../../src/fcs/sync-bindings.js';
import { resetSyncManager } from '../../src/sync/index.js';

describe('WorkspaceStateTracker', () => {
  let tracker: WorkspaceStateTracker;

  beforeEach(() => {
    resetSyncManager();
    resetWorkspaceTracker();
    tracker = new WorkspaceStateTracker('test-session', 'test-node');
  });

  afterEach(() => {
    tracker.dispose();
    resetSyncManager();
    resetWorkspaceTracker();
  });

  describe('File Tracking', () => {
    it('should track files', () => {
      tracker.trackFile('/test/file.ts', 'const x = 1;', true);

      const files = tracker.getTrackedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('/test/file.ts');
      expect(files[0].content).toBe('const x = 1;');
      expect(files[0].isOpen).toBe(true);
    });

    it('should untrack files', () => {
      tracker.trackFile('/test/file.ts', 'content');
      tracker.untrackFile('/test/file.ts');

      expect(tracker.getTrackedFiles()).toHaveLength(0);
    });

    it('should mark files as dirty when content changes', () => {
      tracker.trackFile('/test/file.ts', 'original');
      tracker.trackFile('/test/file.ts', 'modified');

      const files = tracker.getTrackedFiles();
      expect(files[0].isDirty).toBe(true);
    });

    it('should mark files clean', () => {
      tracker.trackFile('/test/file.ts', 'content');
      tracker.markFileDirty('/test/file.ts');
      tracker.markFileClean('/test/file.ts');

      const files = tracker.getTrackedFiles();
      expect(files[0].isDirty).toBe(false);
    });

    it('should get dirty files only', () => {
      tracker.trackFile('/clean.ts', 'clean');
      tracker.trackFile('/dirty.ts', 'dirty');
      tracker.markFileDirty('/dirty.ts');

      const dirty = tracker.getDirtyFiles();
      expect(dirty).toHaveLength(1);
      expect(dirty[0].path).toBe('/dirty.ts');
    });
  });

  describe('Session Context', () => {
    it('should return initial context', () => {
      const ctx = tracker.getContext();
      expect(ctx.sessionId).toBe('test-session');
      expect(ctx.agentMode).toBe('code');
      expect(ctx.toolsUsed).toEqual([]);
      expect(ctx.conversationLength).toBe(0);
    });

    it('should update context', () => {
      tracker.updateContext({ agentMode: 'plan' });

      const ctx = tracker.getContext();
      expect(ctx.agentMode).toBe('plan');
    });

    it('should record tool usage', () => {
      tracker.recordToolUsage('read');
      tracker.recordToolUsage('edit');
      tracker.recordToolUsage('read'); // Duplicate

      const ctx = tracker.getContext();
      expect(ctx.toolsUsed).toEqual(['read', 'edit']);
    });

    it('should increment conversation length', () => {
      tracker.incrementConversation();
      tracker.incrementConversation();

      expect(tracker.getContext().conversationLength).toBe(2);
    });
  });

  describe('Snapshots', () => {
    it('should create snapshots', () => {
      tracker.trackFile('/test.ts', 'content');

      const snapshot = tracker.createSnapshot({ name: 'Test Snapshot' });

      expect(snapshot.id).toMatch(/^snap_/);
      expect(snapshot.metadata.name).toBe('Test Snapshot');
      expect(snapshot.files.size).toBe(1);
    });

    it('should list snapshots in reverse chronological order', async () => {
      tracker.createSnapshot({ name: 'First' });
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      tracker.createSnapshot({ name: 'Second' });

      const snapshots = tracker.listSnapshots();
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].metadata.name).toBe('Second');
    });

    it('should get snapshot by id', () => {
      const snapshot = tracker.createSnapshot({ name: 'Test' });

      const retrieved = tracker.getSnapshot(snapshot.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.metadata.name).toBe('Test');
    });

    it('should restore from snapshot', () => {
      tracker.trackFile('/file1.ts', 'original');
      const snapshot = tracker.createSnapshot();

      tracker.trackFile('/file2.ts', 'new file');
      expect(tracker.getTrackedFiles()).toHaveLength(2);

      const success = tracker.restoreSnapshot(snapshot.id);
      expect(success).toBe(true);
      expect(tracker.getTrackedFiles()).toHaveLength(1);
    });

    it('should return false for non-existent snapshot', () => {
      const success = tracker.restoreSnapshot('non-existent');
      expect(success).toBe(false);
    });
  });

  describe('Diff', () => {
    it('should detect added files', () => {
      const snapshot = tracker.createSnapshot();
      tracker.trackFile('/new.ts', 'new content');

      const diffs = tracker.diffWith(snapshot);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].type).toBe('added');
      expect(diffs[0].path).toBe('/new.ts');
    });

    it('should detect modified files', () => {
      tracker.trackFile('/file.ts', 'original');
      const snapshot = tracker.createSnapshot();
      tracker.trackFile('/file.ts', 'modified');

      const diffs = tracker.diffWith(snapshot);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].type).toBe('modified');
    });

    it('should detect deleted files', () => {
      tracker.trackFile('/file.ts', 'content');
      const snapshot = tracker.createSnapshot();
      tracker.untrackFile('/file.ts');

      const diffs = tracker.diffWith(snapshot);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].type).toBe('deleted');
    });

    it('should detect no differences for identical state', () => {
      tracker.trackFile('/file.ts', 'content');
      const snapshot = tracker.createSnapshot();

      const diffs = tracker.diffWith(snapshot);
      expect(diffs).toHaveLength(0);
    });
  });

  describe('Sync Operations', () => {
    it('should get sync status', () => {
      const status = tracker.getSyncStatus();
      expect(status).toBe('idle');
    });

    it('should push changes', async () => {
      tracker.trackFile('/file.ts', 'content');

      const result = await tracker.pushChanges();
      expect(result.success).toBe(true);
      expect(result.snapshot.id).toMatch(/^snap_/);
    });
  });
});

describe('FCS Sync Bindings', () => {
  let bindings: Record<string, unknown>;
  const logs: string[] = [];

  beforeEach(async () => {
    resetSyncManager();
    resetWorkspaceTracker();
    logs.length = 0;

    bindings = await createSyncBindings(
      { sessionId: 'test-session' },
      (msg: string) => logs.push(msg)
    );
  });

  afterEach(() => {
    resetSyncManager();
    resetWorkspaceTracker();
  });

  it('should create sync namespace', () => {
    expect(bindings.sync).toBeDefined();
    expect(typeof bindings.sync).toBe('object');
  });

  it('should provide status function', () => {
    const sync = bindings.sync as Record<string, unknown>;
    expect(typeof sync.status).toBe('function');

    const status = (sync.status as () => string)();
    expect(status).toContain('status');
    expect(status).toContain('dirtyFiles');
  });

  it('should provide snapshot function', () => {
    const sync = bindings.sync as Record<string, unknown>;
    expect(typeof sync.snapshot).toBe('function');

    const id = (sync.snapshot as (name?: string) => string)('Test');
    expect(id).toMatch(/^snap_/);
    expect(logs).toContain(`Created snapshot: ${id}`);
  });

  it('should provide list function', () => {
    const sync = bindings.sync as Record<string, unknown>;

    // Initially empty
    let list = (sync.list as () => string)();
    expect(list).toBe('No snapshots available');

    // After creating snapshot
    (sync.snapshot as () => string)();
    list = (sync.list as () => string)();
    expect(list).toContain('snap_');
  });

  it('should provide track/untrack functions', () => {
    const sync = bindings.sync as Record<string, unknown>;

    (sync.track as (path: string, content: string) => void)('/test.ts', 'content');
    expect(logs).toContain('Tracking: /test.ts');

    const files = (sync.files as () => string)();
    expect(files).toContain('/test.ts');

    (sync.untrack as (path: string) => void)('/test.ts');
    expect(logs).toContain('Untracked: /test.ts');
  });

  it('should provide diff function', () => {
    const sync = bindings.sync as Record<string, unknown>;

    // No snapshots
    let diff = (sync.diff as () => string)();
    expect(diff).toBe('No snapshots to compare with');

    // Create snapshot and check diff
    (sync.track as (path: string, content: string) => void)('/file.ts', 'content');
    (sync.snapshot as () => string)();

    diff = (sync.diff as () => string)();
    expect(diff).toBe('No differences');
  });

  it('should provide context functions', () => {
    const sync = bindings.sync as Record<string, unknown>;

    const context = (sync.context as () => string)();
    expect(context).toContain('sessionId');
    expect(context).toContain('test-session');

    (sync.setContext as (key: string, value: unknown) => void)('agentMode', 'plan');
    const updated = (sync.context as () => string)();
    expect(updated).toContain('plan');
  });
});

describe('Singleton Behavior', () => {
  beforeEach(() => {
    resetSyncManager();
    resetWorkspaceTracker();
  });

  afterEach(() => {
    resetSyncManager();
    resetWorkspaceTracker();
  });

  it('should return same tracker instance', async () => {
    const tracker1 = await getWorkspaceTracker('session1');
    const tracker2 = await getWorkspaceTracker('session2');
    expect(tracker1).toBe(tracker2);
  });

  it('should create new instance after reset', async () => {
    const before = await getWorkspaceTracker('session1');
    resetWorkspaceTracker();
    const after = await getWorkspaceTracker('session2');
    expect(before).not.toBe(after);
  });
});
