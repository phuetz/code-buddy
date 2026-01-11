/**
 * Sync Module
 *
 * Provides synchronization capabilities including:
 * - State synchronization between clients/servers
 * - Conflict resolution strategies
 * - State reconciliation
 * - Version tracking and vector clocks
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import path from 'path';
import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface SyncState<T = unknown> {
  id: string;
  data: T;
  version: number;
  timestamp: number;
  vectorClock: VectorClock;
  hash: string;
  lastModifiedBy: string;
}

export interface VectorClock {
  [nodeId: string]: number;
}

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  stateId: string;
  data?: unknown;
  timestamp: number;
  nodeId: string;
  vectorClock: VectorClock;
}

export interface SyncConflict<T = unknown> {
  stateId: string;
  localState: SyncState<T>;
  remoteState: SyncState<T>;
  conflictType: ConflictType;
  resolution?: ConflictResolution;
}

export type ConflictType =
  | 'concurrent-update'
  | 'delete-update'
  | 'update-delete'
  | 'divergent-history';

export type ConflictResolution =
  | 'local-wins'
  | 'remote-wins'
  | 'merge'
  | 'manual';

export interface ConflictResolutionStrategy<T = unknown> {
  canResolve(conflict: SyncConflict<T>): boolean;
  resolve(conflict: SyncConflict<T>): SyncState<T>;
}

export interface SyncConfig {
  nodeId?: string;
  conflictStrategy?: ConflictResolution;
  autoSync?: boolean;
  syncInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
  persistPath?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'conflict';

export interface ReconciliationResult<T = unknown> {
  success: boolean;
  reconciledStates: SyncState<T>[];
  conflicts: SyncConflict<T>[];
  operations: SyncOperation[];
}

// ============================================================================
// Vector Clock Operations
// ============================================================================

export function createVectorClock(nodeId: string): VectorClock {
  return { [nodeId]: 0 };
}

export function incrementVectorClock(
  clock: VectorClock,
  nodeId: string
): VectorClock {
  return {
    ...clock,
    [nodeId]: (clock[nodeId] || 0) + 1,
  };
}

export function mergeVectorClocks(
  clock1: VectorClock,
  clock2: VectorClock
): VectorClock {
  const merged: VectorClock = { ...clock1 };
  for (const [nodeId, value] of Object.entries(clock2)) {
    merged[nodeId] = Math.max(merged[nodeId] || 0, value);
  }
  return merged;
}

export function compareVectorClocks(
  clock1: VectorClock,
  clock2: VectorClock
): 'before' | 'after' | 'concurrent' | 'equal' {
  let before = false;
  let after = false;

  const allNodes = new Set([
    ...Object.keys(clock1),
    ...Object.keys(clock2),
  ]);

  for (const nodeId of allNodes) {
    const v1 = clock1[nodeId] || 0;
    const v2 = clock2[nodeId] || 0;

    if (v1 < v2) before = true;
    if (v1 > v2) after = true;
  }

  if (!before && !after) return 'equal';
  if (before && !after) return 'before';
  if (!before && after) return 'after';
  return 'concurrent';
}

export function isVectorClockDominated(
  clock1: VectorClock,
  clock2: VectorClock
): boolean {
  const comparison = compareVectorClocks(clock1, clock2);
  return comparison === 'before' || comparison === 'equal';
}

// ============================================================================
// State Management
// ============================================================================

export function createSyncState<T>(
  data: T,
  nodeId: string,
  existingClock?: VectorClock
): SyncState<T> {
  const vectorClock = existingClock
    ? incrementVectorClock(existingClock, nodeId)
    : createVectorClock(nodeId);

  return {
    id: generateId('state'),
    data,
    version: 1,
    timestamp: Date.now(),
    vectorClock,
    hash: computeHash(data),
    lastModifiedBy: nodeId,
  };
}

export function updateSyncState<T>(
  state: SyncState<T>,
  data: T,
  nodeId: string
): SyncState<T> {
  return {
    ...state,
    data,
    version: state.version + 1,
    timestamp: Date.now(),
    vectorClock: incrementVectorClock(state.vectorClock, nodeId),
    hash: computeHash(data),
    lastModifiedBy: nodeId,
  };
}

export function computeHash(data: unknown): string {
  let str: string;
  if (data === undefined) {
    str = 'undefined';
  } else if (typeof data === 'string') {
    str = data;
  } else {
    str = JSON.stringify(data);
  }
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// ============================================================================
// Conflict Detection and Resolution
// ============================================================================

export function detectConflict<T>(
  localState: SyncState<T>,
  remoteState: SyncState<T>
): SyncConflict<T> | null {
  if (localState.id !== remoteState.id) {
    return null; // Different states, no conflict
  }

  if (localState.hash === remoteState.hash) {
    return null; // Same content, no conflict
  }

  const comparison = compareVectorClocks(
    localState.vectorClock,
    remoteState.vectorClock
  );

  if (comparison === 'equal' || comparison === 'before' || comparison === 'after') {
    return null; // One dominates the other, no conflict
  }

  return {
    stateId: localState.id,
    localState,
    remoteState,
    conflictType: 'concurrent-update',
  };
}

export class LastWriteWinsStrategy<T> implements ConflictResolutionStrategy<T> {
  canResolve(_conflict: SyncConflict<T>): boolean {
    return true;
  }

  resolve(conflict: SyncConflict<T>): SyncState<T> {
    return conflict.localState.timestamp >= conflict.remoteState.timestamp
      ? conflict.localState
      : conflict.remoteState;
  }
}

export class LocalWinsStrategy<T> implements ConflictResolutionStrategy<T> {
  canResolve(_conflict: SyncConflict<T>): boolean {
    return true;
  }

  resolve(conflict: SyncConflict<T>): SyncState<T> {
    return conflict.localState;
  }
}

export class RemoteWinsStrategy<T> implements ConflictResolutionStrategy<T> {
  canResolve(_conflict: SyncConflict<T>): boolean {
    return true;
  }

  resolve(conflict: SyncConflict<T>): SyncState<T> {
    return conflict.remoteState;
  }
}

export class MergeStrategy<T extends object> implements ConflictResolutionStrategy<T> {
  canResolve(conflict: SyncConflict<T>): boolean {
    return (
      typeof conflict.localState.data === 'object' &&
      typeof conflict.remoteState.data === 'object' &&
      conflict.localState.data !== null &&
      conflict.remoteState.data !== null
    );
  }

  resolve(conflict: SyncConflict<T>): SyncState<T> {
    const mergedData = this.mergeObjects(
      conflict.localState.data,
      conflict.remoteState.data
    );

    return {
      ...conflict.localState,
      data: mergedData,
      version: Math.max(conflict.localState.version, conflict.remoteState.version) + 1,
      timestamp: Date.now(),
      vectorClock: mergeVectorClocks(
        conflict.localState.vectorClock,
        conflict.remoteState.vectorClock
      ),
      hash: computeHash(mergedData),
    };
  }

  private mergeObjects(local: T, remote: T): T {
    const result: Record<string, unknown> = {};
    const allKeys = new Set([
      ...Object.keys(local as object),
      ...Object.keys(remote as object),
    ]);

    for (const key of allKeys) {
      const localVal = (local as Record<string, unknown>)[key];
      const remoteVal = (remote as Record<string, unknown>)[key];

      if (localVal === undefined) {
        result[key] = remoteVal;
      } else if (remoteVal === undefined) {
        result[key] = localVal;
      } else if (
        typeof localVal === 'object' &&
        typeof remoteVal === 'object' &&
        localVal !== null &&
        remoteVal !== null &&
        !Array.isArray(localVal) &&
        !Array.isArray(remoteVal)
      ) {
        result[key] = this.mergeObjects(
          localVal as T,
          remoteVal as T
        );
      } else {
        // For conflicting primitive values, take the local value
        result[key] = localVal;
      }
    }

    return result as T;
  }
}

// ============================================================================
// Sync Manager
// ============================================================================

const DEFAULT_CONFIG: Required<SyncConfig> = {
  nodeId: 'default',
  conflictStrategy: 'local-wins',
  autoSync: false,
  syncInterval: 30000,
  maxRetries: 3,
  retryDelay: 1000,
  persistPath: '.codebuddy/sync',
};

export class SyncManager<T = unknown> extends EventEmitter {
  private config: Required<SyncConfig>;
  private states: Map<string, SyncState<T>> = new Map();
  private pendingOperations: SyncOperation[] = [];
  private conflictStrategy: ConflictResolutionStrategy<T>;
  private status: SyncStatus = 'idle';
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private vfs = UnifiedVfsRouter.Instance;

  constructor(config: SyncConfig = {}) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      nodeId: config.nodeId || generateId('node'),
      ...config,
    };

    // Resolve persist path relative to CWD if not absolute
    if (!path.isAbsolute(this.config.persistPath)) {
      this.config.persistPath = path.join(process.cwd(), this.config.persistPath);
    }

    this.conflictStrategy = this.createStrategy(this.config.conflictStrategy);

    // Load initial state
    this.load().catch(err => console.error('Failed to load sync state:', err));

    if (this.config.autoSync) {
      this.startAutoSync();
    }
  }

  private createStrategy(resolution: ConflictResolution): ConflictResolutionStrategy<T> {
    switch (resolution) {
      case 'remote-wins':
        return new RemoteWinsStrategy<T>();
      case 'merge':
        // MergeStrategy requires object types, use LastWriteWins as fallback for non-objects
        return new MergeStrategy() as unknown as ConflictResolutionStrategy<T>;
      case 'local-wins':
      default:
        return new LocalWinsStrategy<T>();
    }
  }

  getNodeId(): string {
    return this.config.nodeId;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  setStatus(status: SyncStatus): void {
    const previousStatus = this.status;
    this.status = status;
    this.emit('status-changed', { previous: previousStatus, current: status });
  }

  // Persistence
  private async save(): Promise<void> {
    try {
      await this.vfs.ensureDir(this.config.persistPath);
      
      const data = {
        nodeId: this.config.nodeId,
        timestamp: Date.now(),
        states: Array.from(this.states.entries()),
        pendingOperations: this.pendingOperations,
      };

      const filePath = path.join(this.config.persistPath, 'state.json');
      await this.vfs.writeFile(filePath, JSON.stringify(data, null, 2));
      this.emit('saved');
    } catch (error) {
      this.emit('error', error);
    }
  }

  private async load(): Promise<void> {
    try {
      const filePath = path.join(this.config.persistPath, 'state.json');
      if (await this.vfs.exists(filePath)) {
        const content = await this.vfs.readFile(filePath);
        const data = JSON.parse(content);
        
        if (data.states) {
          this.states = new Map(data.states);
        }
        if (data.pendingOperations) {
          this.pendingOperations = data.pendingOperations;
        }
        
        this.emit('loaded');
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  // State operations
  createState(data: T): SyncState<T> {
    const state = createSyncState(data, this.config.nodeId);
    this.states.set(state.id, state);
    this.addOperation('create', state.id, data);
    this.emit('state-created', state);
    this.save(); // Save on change
    return state;
  }

  getState(stateId: string): SyncState<T> | undefined {
    return this.states.get(stateId);
  }

  getAllStates(): SyncState<T>[] {
    return Array.from(this.states.values());
  }

  updateState(stateId: string, data: T): SyncState<T> | null {
    const existing = this.states.get(stateId);
    if (!existing) return null;

    const updated = updateSyncState(existing, data, this.config.nodeId);
    this.states.set(stateId, updated);
    this.addOperation('update', stateId, data);
    this.emit('state-updated', updated);
    this.save();
    return updated;
  }

  deleteState(stateId: string): boolean {
    const existing = this.states.get(stateId);
    if (!existing) return false;

    this.states.delete(stateId);
    this.addOperation('delete', stateId);
    this.emit('state-deleted', stateId);
    this.save();
    return true;
  }

  private addOperation(
    type: SyncOperation['type'],
    stateId: string,
    data?: T
  ): void {
    const operation: SyncOperation = {
      id: generateId('op'),
      type,
      stateId,
      data,
      timestamp: Date.now(),
      nodeId: this.config.nodeId,
      vectorClock: this.getCurrentVectorClock(),
    };
    this.pendingOperations.push(operation);
  }

  private getCurrentVectorClock(): VectorClock {
    let clock: VectorClock = { [this.config.nodeId]: 0 };
    for (const state of this.states.values()) {
      clock = mergeVectorClocks(clock, state.vectorClock);
    }
    return incrementVectorClock(clock, this.config.nodeId);
  }

  getPendingOperations(): SyncOperation[] {
    return [...this.pendingOperations];
  }

  clearPendingOperations(): void {
    this.pendingOperations = [];
  }

  // Synchronization
  async applyRemoteState(remoteState: SyncState<T>): Promise<{
    applied: boolean;
    conflict?: SyncConflict<T>;
    resolvedState?: SyncState<T>;
  }> {
    const localState = this.states.get(remoteState.id);

    if (!localState) {
      // New state from remote
      this.states.set(remoteState.id, remoteState);
      this.emit('state-synced', remoteState);
      this.save();
      return { applied: true };
    }

    const conflict = detectConflict(localState, remoteState);

    if (!conflict) {
      // No conflict, check which one is newer
      const comparison = compareVectorClocks(
        localState.vectorClock,
        remoteState.vectorClock
      );

      if (comparison === 'before') {
        // Remote is newer
        this.states.set(remoteState.id, remoteState);
        this.emit('state-synced', remoteState);
        this.save();
        return { applied: true };
      }

      // Local is equal or newer
      return { applied: false };
    }

    // Conflict detected
    this.emit('conflict-detected', conflict);

    if (this.conflictStrategy.canResolve(conflict)) {
      const resolvedState = this.conflictStrategy.resolve(conflict);
      this.states.set(resolvedState.id, resolvedState);
      this.emit('conflict-resolved', { conflict, resolvedState });
      this.save();
      return { applied: true, conflict, resolvedState };
    }

    this.setStatus('conflict');
    return { applied: false, conflict };
  }

  async reconcile(remoteStates: SyncState<T>[]): Promise<ReconciliationResult<T>> {
    this.setStatus('syncing');

    const reconciledStates: SyncState<T>[] = [];
    const conflicts: SyncConflict<T>[] = [];

    try {
      for (const remoteState of remoteStates) {
        const result = await this.applyRemoteState(remoteState);

        if (result.applied) {
          reconciledStates.push(
            result.resolvedState || this.states.get(remoteState.id)!
          );
        }

        if (result.conflict && !result.resolvedState) {
          conflicts.push(result.conflict);
        }
      }

      this.setStatus(conflicts.length > 0 ? 'conflict' : 'idle');

      return {
        success: conflicts.length === 0,
        reconciledStates,
        conflicts,
        operations: this.pendingOperations,
      };
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  // Manual conflict resolution
  resolveConflict(
    conflict: SyncConflict<T>,
    resolution: ConflictResolution,
    customData?: T
  ): SyncState<T> {
    let resolvedState: SyncState<T>;

    switch (resolution) {
      case 'local-wins':
        resolvedState = conflict.localState;
        break;
      case 'remote-wins':
        resolvedState = conflict.remoteState;
        break;
      case 'merge':
        if (customData) {
          resolvedState = {
            ...conflict.localState,
            data: customData,
            version: Math.max(
              conflict.localState.version,
              conflict.remoteState.version
            ) + 1,
            timestamp: Date.now(),
            vectorClock: mergeVectorClocks(
              conflict.localState.vectorClock,
              conflict.remoteState.vectorClock
            ),
            hash: computeHash(customData),
            lastModifiedBy: this.config.nodeId,
          };
        } else {
          const strategy = new MergeStrategy<T & object>();
          resolvedState = strategy.resolve(conflict as SyncConflict<T & object>);
        }
        break;
      default:
        resolvedState = conflict.localState;
    }

    this.states.set(resolvedState.id, resolvedState);
    this.emit('conflict-resolved', { conflict, resolvedState });
    this.save();

    if (this.status === 'conflict') {
      this.setStatus('idle');
    }

    return resolvedState;
  }

  // Auto-sync
  startAutoSync(): void {
    if (this.syncTimer) return;

    this.syncTimer = setInterval(() => {
      this.emit('auto-sync-tick');
    }, this.config.syncInterval);
  }

  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // Export/Import
  exportState(): { states: SyncState<T>[]; nodeId: string; timestamp: number } {
    return {
      states: this.getAllStates(),
      nodeId: this.config.nodeId,
      timestamp: Date.now(),
    };
  }

  importState(data: { states: SyncState<T>[]; nodeId: string }): void {
    for (const state of data.states) {
      this.states.set(state.id, state);
    }
    this.emit('state-imported', data);
  }

  // Cleanup
  dispose(): void {
    this.stopAutoSync();
    this.states.clear();
    this.pendingOperations = [];
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton Access
// ============================================================================

let syncManagerInstance: SyncManager | null = null;

export function getSyncManager<T = unknown>(config?: SyncConfig): SyncManager<T> {
  if (!syncManagerInstance) {
    syncManagerInstance = new SyncManager(config);
  }
  return syncManagerInstance as SyncManager<T>;
}

export function resetSyncManager(): void {
  if (syncManagerInstance) {
    syncManagerInstance.dispose();
    syncManagerInstance = null;
  }
}

export default SyncManager;
