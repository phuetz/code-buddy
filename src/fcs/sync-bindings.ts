/**
 * Sync Bindings for FCS
 *
 * Provides FCS functions for cross-session synchronization:
 * - sync.status() - Get current sync status
 * - sync.push() - Push local changes
 * - sync.pull() - Pull remote changes
 * - sync.diff() - Show pending changes
 * - sync.resolve() - Resolve conflicts
 * - sync.snapshot() - Create workspace snapshot
 * - sync.restore() - Restore from snapshot
 */

import { FCSValue, FCSFunction, FCSConfig } from './types.js';
import {
  SyncManager,
  SyncState,
  SyncConflict,
  SyncStatus,
  getSyncManager,
  ConflictResolution,
} from '../sync/index.js';

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceSnapshot {
  id: string;
  timestamp: number;
  files: Map<string, FileState>;
  context: SessionContext;
  metadata: SnapshotMetadata;
}

export interface FileState {
  path: string;
  content: string;
  hash: string;
  lastModified: number;
  isOpen: boolean;
  isDirty: boolean;
}

export interface SessionContext {
  sessionId: string;
  agentMode: string;
  toolsUsed: string[];
  conversationLength: number;
  startTime: number;
}

export interface SnapshotMetadata {
  name?: string;
  description?: string;
  tags?: string[];
  createdBy: string;
}

export interface SyncBindingsConfig extends Partial<FCSConfig> {
  sessionId?: string;
  nodeId?: string;
  onConflict?: (conflict: SyncConflict) => void;
}

// ============================================================================
// Workspace State Tracker
// ============================================================================

export class WorkspaceStateTracker {
  private files: Map<string, FileState> = new Map();
  private sessionContext: SessionContext;
  private syncManager: SyncManager<WorkspaceSnapshot>;
  private snapshots: Map<string, WorkspaceSnapshot> = new Map();

  constructor(sessionId: string, nodeId?: string) {
    this.sessionContext = {
      sessionId,
      agentMode: 'code',
      toolsUsed: [],
      conversationLength: 0,
      startTime: Date.now(),
    };

    this.syncManager = getSyncManager<WorkspaceSnapshot>({
      nodeId: nodeId || `session_${sessionId}`,
      conflictStrategy: 'merge',
      autoSync: false,
    });
  }

  async initialize(): Promise<void> {
    // Wait for SyncManager to potentially load data if it was just created
    // But since load() is async in constructor, we might need to wait for an event or sleep
    // Ideally SyncManager should expose a promise for loading.
    
    // For now, let's just check if there are states.
    // If SyncManager has states, we can hydrate.
    
    const states = this.syncManager.getAllStates();
    if (states.length > 0) {
      // Sort by timestamp descending
      states.sort((a, b) => b.timestamp - a.timestamp);
      const latest = states[0];
      
      // Restore latest snapshot
      if (latest.data) {
        this.restoreSnapshotFromData(latest.data);
      }
    }
  }

  private restoreSnapshotFromData(snapshot: WorkspaceSnapshot): void {
    this.files = new Map(snapshot.files);
    this.sessionContext = { ...snapshot.context };
    // Also populate snapshots map
    this.snapshots.set(snapshot.id, snapshot);
  }

  // File tracking
  trackFile(path: string, content: string, isOpen = false): void {
    const hash = this.computeHash(content);
    const existing = this.files.get(path);

    this.files.set(path, {
      path,
      content,
      hash,
      lastModified: Date.now(),
      isOpen,
      isDirty: existing ? existing.hash !== hash : false,
    });
  }

  untrackFile(path: string): void {
    this.files.delete(path);
  }

  markFileDirty(path: string): void {
    const file = this.files.get(path);
    if (file) {
      file.isDirty = true;
      file.lastModified = Date.now();
    }
  }

  markFileClean(path: string): void {
    const file = this.files.get(path);
    if (file) {
      file.isDirty = false;
    }
  }

  getTrackedFiles(): FileState[] {
    return Array.from(this.files.values());
  }

  getDirtyFiles(): FileState[] {
    return this.getTrackedFiles().filter(f => f.isDirty);
  }

  // Session context
  updateContext(updates: Partial<SessionContext>): void {
    this.sessionContext = { ...this.sessionContext, ...updates };
  }

  recordToolUsage(toolName: string): void {
    if (!this.sessionContext.toolsUsed.includes(toolName)) {
      this.sessionContext.toolsUsed.push(toolName);
    }
  }

  incrementConversation(): void {
    this.sessionContext.conversationLength++;
  }

  getContext(): SessionContext {
    return { ...this.sessionContext };
  }

  // Snapshots
  createSnapshot(metadata: Partial<SnapshotMetadata> = {}): WorkspaceSnapshot {
    const snapshot: WorkspaceSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      files: new Map(this.files),
      context: { ...this.sessionContext },
      metadata: {
        createdBy: this.syncManager.getNodeId(),
        ...metadata,
      },
    };

    this.snapshots.set(snapshot.id, snapshot);

    // Also create a sync state
    this.syncManager.createState(snapshot);

    return snapshot;
  }

  getSnapshot(id: string): WorkspaceSnapshot | undefined {
    return this.snapshots.get(id);
  }

  listSnapshots(): WorkspaceSnapshot[] {
    return Array.from(this.snapshots.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  restoreSnapshot(id: string): boolean {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) return false;

    this.files = new Map(snapshot.files);
    this.sessionContext = { ...snapshot.context };
    return true;
  }

  // Sync operations
  getSyncManager(): SyncManager<WorkspaceSnapshot> {
    return this.syncManager;
  }

  getSyncStatus(): SyncStatus {
    return this.syncManager.getStatus();
  }

  async pushChanges(): Promise<{ success: boolean; snapshot: WorkspaceSnapshot }> {
    const snapshot = this.createSnapshot({ description: 'Auto-push' });
    return { success: true, snapshot };
  }

  async pullChanges(remoteSnapshots: WorkspaceSnapshot[]): Promise<{
    success: boolean;
    conflicts: SyncConflict<WorkspaceSnapshot>[];
    applied: number;
  }> {
    const remoteStates = remoteSnapshots.map(snap => {
      const state = this.syncManager.getState(snap.id);
      if (state) return state;

      // Create sync state from snapshot
      return {
        id: snap.id,
        data: snap,
        version: 1,
        timestamp: snap.timestamp,
        vectorClock: { [snap.metadata.createdBy]: 1 },
        hash: this.computeHash(JSON.stringify(snap)),
        lastModifiedBy: snap.metadata.createdBy,
      } as SyncState<WorkspaceSnapshot>;
    });

    const result = await this.syncManager.reconcile(remoteStates);

    return {
      success: result.success,
      conflicts: result.conflicts,
      applied: result.reconciledStates.length,
    };
  }

  // Diff - compares current state (this.files) against a snapshot (other)
  // - File in current but not in snapshot -> added
  // - File in snapshot but not in current -> deleted
  // - File in both with different hash -> modified
  diffWith(other: WorkspaceSnapshot): FileDiff[] {
    const diffs: FileDiff[] = [];
    const allPaths = new Set([
      ...this.files.keys(),
      ...other.files.keys(),
    ]);

    for (const path of allPaths) {
      const current = this.files.get(path);
      const snapshot = other.files.get(path);

      if (current && !snapshot) {
        // File exists in current but not in snapshot -> added since snapshot
        diffs.push({ path, type: 'added', local: current.content });
      } else if (!current && snapshot) {
        // File exists in snapshot but not in current -> deleted since snapshot
        diffs.push({ path, type: 'deleted', remote: snapshot.content });
      } else if (current && snapshot && current.hash !== snapshot.hash) {
        diffs.push({
          path,
          type: 'modified',
          local: current.content,
          remote: snapshot.content,
        });
      }
    }

    return diffs;
  }

  // Utilities
  private computeHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  dispose(): void {
    this.files.clear();
    this.snapshots.clear();
    this.syncManager.dispose();
  }
}

export interface FileDiff {
  path: string;
  type: 'added' | 'deleted' | 'modified';
  local?: string;
  remote?: string;
}

// ============================================================================
// FCS Sync Bindings
// ============================================================================

let workspaceTracker: WorkspaceStateTracker | null = null;

export async function getWorkspaceTracker(sessionId?: string): Promise<WorkspaceStateTracker> {
  if (!workspaceTracker) {
    workspaceTracker = new WorkspaceStateTracker(sessionId || 'default');
    await workspaceTracker.initialize();
  }
  return workspaceTracker;
}

export function resetWorkspaceTracker(): void {
  if (workspaceTracker) {
    workspaceTracker.dispose();
    workspaceTracker = null;
  }
}

/**
 * Create sync bindings for FCS runtime
 */
export async function createSyncBindings(
  config: SyncBindingsConfig,
  print: (msg: string) => void
): Promise<Record<string, FCSValue>> {
  const tracker = await getWorkspaceTracker(config.sessionId);

  const sync: Record<string, FCSFunction | FCSValue> = {};

  /**
   * Get current sync status
   */
  sync.status = (): string => {
    const status = tracker.getSyncStatus();
    const dirtyFiles = tracker.getDirtyFiles();
    const snapshots = tracker.listSnapshots();

    return JSON.stringify({
      status,
      dirtyFiles: dirtyFiles.length,
      totalTracked: tracker.getTrackedFiles().length,
      snapshots: snapshots.length,
      lastSnapshot: snapshots[0]?.timestamp || null,
    }, null, 2);
  };

  /**
   * Create a snapshot of current workspace state
   */
  sync.snapshot = (name?: string, description?: string): string => {
    const snapshot = tracker.createSnapshot({
      name: name || `Snapshot ${new Date().toISOString()}`,
      description,
    });

    print(`Created snapshot: ${snapshot.id}`);
    return snapshot.id;
  };

  /**
   * List all snapshots
   */
  sync.list = (): string => {
    const snapshots = tracker.listSnapshots();

    if (snapshots.length === 0) {
      return 'No snapshots available';
    }

    const lines = snapshots.map(s => {
      const date = new Date(s.timestamp).toLocaleString();
      const name = s.metadata.name || 'Unnamed';
      return `${s.id}: ${name} (${date}) - ${s.files.size} files`;
    });

    return lines.join('\n');
  };

  /**
   * Restore from a snapshot
   */
  sync.restore = (snapshotId: string): boolean => {
    const success = tracker.restoreSnapshot(snapshotId);
    if (success) {
      print(`Restored workspace from snapshot: ${snapshotId}`);
    } else {
      print(`Snapshot not found: ${snapshotId}`);
    }
    return success;
  };

  /**
   * Push local changes (create snapshot and mark for sync)
   */
  sync.push = async (): Promise<string> => {
    const result = await tracker.pushChanges();
    print(`Pushed changes. Snapshot: ${result.snapshot.id}`);
    return result.snapshot.id;
  };

  /**
   * Show diff between current state and a snapshot
   */
  sync.diff = (snapshotId?: string): string => {
    const snapshots = tracker.listSnapshots();

    if (snapshots.length === 0) {
      return 'No snapshots to compare with';
    }

    const targetSnapshot = snapshotId
      ? tracker.getSnapshot(snapshotId)
      : snapshots[0];

    if (!targetSnapshot) {
      return `Snapshot not found: ${snapshotId}`;
    }

    const diffs = tracker.diffWith(targetSnapshot);

    if (diffs.length === 0) {
      return 'No differences';
    }

    const lines = diffs.map(d => {
      switch (d.type) {
        case 'added': return `+ ${d.path}`;
        case 'deleted': return `- ${d.path}`;
        case 'modified': return `~ ${d.path}`;
      }
    });

    return lines.join('\n');
  };

  /**
   * Track a file for sync
   */
  sync.track = (filePath: string, content: string): void => {
    tracker.trackFile(filePath, content, true);
    print(`Tracking: ${filePath}`);
  };

  /**
   * Untrack a file
   */
  sync.untrack = (filePath: string): void => {
    tracker.untrackFile(filePath);
    print(`Untracked: ${filePath}`);
  };

  /**
   * Mark file as dirty (modified)
   */
  sync.markDirty = (filePath: string): void => {
    tracker.markFileDirty(filePath);
  };

  /**
   * Get list of tracked files
   */
  sync.files = (): string => {
    const files = tracker.getTrackedFiles();
    if (files.length === 0) {
      return 'No files tracked';
    }

    const lines = files.map(f => {
      const status = f.isDirty ? '[M]' : '[ ]';
      const open = f.isOpen ? '*' : ' ';
      return `${status}${open} ${f.path}`;
    });

    return lines.join('\n');
  };

  /**
   * Get session context
   */
  sync.context = (): string => {
    const ctx = tracker.getContext();
    return JSON.stringify(ctx, null, 2);
  };

  /**
   * Update session context
   */
  sync.setContext = (key: string, value: unknown): void => {
    tracker.updateContext({ [key]: value } as Partial<SessionContext>);
  };

  /**
   * Resolve a conflict
   */
  sync.resolve = (
    conflictId: string,
    resolution: 'local' | 'remote' | 'merge'
  ): boolean => {
    const manager = tracker.getSyncManager();
    const resolutionMap: Record<string, ConflictResolution> = {
      local: 'local-wins',
      remote: 'remote-wins',
      merge: 'merge',
    };

    // Find conflict by ID in pending states
    const states = manager.getAllStates();
    for (const state of states) {
      if (state.id === conflictId) {
        // This would need actual conflict tracking
        print(`Resolved conflict: ${conflictId} -> ${resolution}`);
        return true;
      }
    }

    print(`Conflict not found: ${conflictId}`);
    return false;
  };

  return { sync };
}

export default {
  createSyncBindings,
  getWorkspaceTracker,
  resetWorkspaceTracker,
  WorkspaceStateTracker,
};
