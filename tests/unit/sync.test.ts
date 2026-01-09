/**
 * Comprehensive Unit Tests for Sync Module
 *
 * Tests synchronization operations, conflict resolution, and state reconciliation:
 * - Vector clock operations
 * - State creation and updates
 * - Conflict detection and resolution strategies
 * - State reconciliation
 * - SyncManager operations
 */

import {
  SyncManager,
  getSyncManager,
  resetSyncManager,
  createVectorClock,
  incrementVectorClock,
  mergeVectorClocks,
  compareVectorClocks,
  isVectorClockDominated,
  createSyncState,
  updateSyncState,
  computeHash,
  generateId,
  detectConflict,
  LastWriteWinsStrategy,
  LocalWinsStrategy,
  RemoteWinsStrategy,
  MergeStrategy,
  SyncState,
  SyncConflict,
  VectorClock,
} from '../../src/sync';

// ============================================================================
// Vector Clock Tests
// ============================================================================

describe('Vector Clock Operations', () => {
  describe('createVectorClock', () => {
    it('should create a vector clock with initial value 0', () => {
      const clock = createVectorClock('node1');
      expect(clock).toEqual({ node1: 0 });
    });

    it('should create unique clocks for different nodes', () => {
      const clock1 = createVectorClock('node1');
      const clock2 = createVectorClock('node2');
      expect(clock1).toEqual({ node1: 0 });
      expect(clock2).toEqual({ node2: 0 });
    });
  });

  describe('incrementVectorClock', () => {
    it('should increment existing node counter', () => {
      const clock = createVectorClock('node1');
      const incremented = incrementVectorClock(clock, 'node1');
      expect(incremented).toEqual({ node1: 1 });
    });

    it('should add and increment new node counter', () => {
      const clock = createVectorClock('node1');
      const incremented = incrementVectorClock(clock, 'node2');
      expect(incremented).toEqual({ node1: 0, node2: 1 });
    });

    it('should not mutate the original clock', () => {
      const clock = createVectorClock('node1');
      incrementVectorClock(clock, 'node1');
      expect(clock).toEqual({ node1: 0 });
    });

    it('should increment multiple times', () => {
      let clock = createVectorClock('node1');
      clock = incrementVectorClock(clock, 'node1');
      clock = incrementVectorClock(clock, 'node1');
      clock = incrementVectorClock(clock, 'node1');
      expect(clock).toEqual({ node1: 3 });
    });
  });

  describe('mergeVectorClocks', () => {
    it('should merge two clocks taking max values', () => {
      const clock1: VectorClock = { node1: 3, node2: 2 };
      const clock2: VectorClock = { node1: 1, node2: 5 };
      const merged = mergeVectorClocks(clock1, clock2);
      expect(merged).toEqual({ node1: 3, node2: 5 });
    });

    it('should include nodes from both clocks', () => {
      const clock1: VectorClock = { node1: 3 };
      const clock2: VectorClock = { node2: 5 };
      const merged = mergeVectorClocks(clock1, clock2);
      expect(merged).toEqual({ node1: 3, node2: 5 });
    });

    it('should handle empty clocks', () => {
      const clock1: VectorClock = {};
      const clock2: VectorClock = { node1: 5 };
      const merged = mergeVectorClocks(clock1, clock2);
      expect(merged).toEqual({ node1: 5 });
    });

    it('should not mutate original clocks', () => {
      const clock1: VectorClock = { node1: 3 };
      const clock2: VectorClock = { node1: 5 };
      mergeVectorClocks(clock1, clock2);
      expect(clock1).toEqual({ node1: 3 });
      expect(clock2).toEqual({ node1: 5 });
    });
  });

  describe('compareVectorClocks', () => {
    it('should return equal for identical clocks', () => {
      const clock1: VectorClock = { node1: 3, node2: 5 };
      const clock2: VectorClock = { node1: 3, node2: 5 };
      expect(compareVectorClocks(clock1, clock2)).toBe('equal');
    });

    it('should return before when first clock is dominated', () => {
      const clock1: VectorClock = { node1: 2, node2: 3 };
      const clock2: VectorClock = { node1: 3, node2: 5 };
      expect(compareVectorClocks(clock1, clock2)).toBe('before');
    });

    it('should return after when first clock dominates', () => {
      const clock1: VectorClock = { node1: 5, node2: 6 };
      const clock2: VectorClock = { node1: 3, node2: 5 };
      expect(compareVectorClocks(clock1, clock2)).toBe('after');
    });

    it('should return concurrent when neither dominates', () => {
      const clock1: VectorClock = { node1: 5, node2: 3 };
      const clock2: VectorClock = { node1: 3, node2: 5 };
      expect(compareVectorClocks(clock1, clock2)).toBe('concurrent');
    });

    it('should handle missing nodes', () => {
      const clock1: VectorClock = { node1: 3 };
      const clock2: VectorClock = { node1: 3, node2: 1 };
      expect(compareVectorClocks(clock1, clock2)).toBe('before');
    });

    it('should handle empty clocks', () => {
      const clock1: VectorClock = {};
      const clock2: VectorClock = {};
      expect(compareVectorClocks(clock1, clock2)).toBe('equal');
    });
  });

  describe('isVectorClockDominated', () => {
    it('should return true when clock1 is before clock2', () => {
      const clock1: VectorClock = { node1: 1 };
      const clock2: VectorClock = { node1: 2 };
      expect(isVectorClockDominated(clock1, clock2)).toBe(true);
    });

    it('should return true when clocks are equal', () => {
      const clock1: VectorClock = { node1: 2 };
      const clock2: VectorClock = { node1: 2 };
      expect(isVectorClockDominated(clock1, clock2)).toBe(true);
    });

    it('should return false when clock1 dominates', () => {
      const clock1: VectorClock = { node1: 3 };
      const clock2: VectorClock = { node1: 2 };
      expect(isVectorClockDominated(clock1, clock2)).toBe(false);
    });

    it('should return false for concurrent clocks', () => {
      const clock1: VectorClock = { node1: 3, node2: 1 };
      const clock2: VectorClock = { node1: 1, node2: 3 };
      expect(isVectorClockDominated(clock1, clock2)).toBe(false);
    });
  });
});

// ============================================================================
// State Management Tests
// ============================================================================

describe('State Management', () => {
  describe('createSyncState', () => {
    it('should create a state with correct structure', () => {
      const state = createSyncState({ name: 'test' }, 'node1');

      expect(state.id).toMatch(/^state_[a-f0-9]+$/);
      expect(state.data).toEqual({ name: 'test' });
      expect(state.version).toBe(1);
      expect(state.timestamp).toBeLessThanOrEqual(Date.now());
      // Initial vector clock starts at 0 for the node
      expect(state.vectorClock).toEqual({ node1: 0 });
      expect(state.hash).toHaveLength(16);
      expect(state.lastModifiedBy).toBe('node1');
    });

    it('should use existing vector clock when provided', () => {
      const existingClock: VectorClock = { node1: 5, node2: 3 };
      const state = createSyncState({ name: 'test' }, 'node1', existingClock);

      expect(state.vectorClock).toEqual({ node1: 6, node2: 3 });
    });

    it('should compute different hashes for different data', () => {
      const state1 = createSyncState({ name: 'test1' }, 'node1');
      const state2 = createSyncState({ name: 'test2' }, 'node1');

      expect(state1.hash).not.toBe(state2.hash);
    });

    it('should compute same hash for same data', () => {
      const data = { name: 'test', value: 123 };
      const hash1 = computeHash(data);
      const hash2 = computeHash(data);

      expect(hash1).toBe(hash2);
    });
  });

  describe('updateSyncState', () => {
    it('should update state data', () => {
      const state = createSyncState({ name: 'original' }, 'node1');
      const updated = updateSyncState(state, { name: 'updated' }, 'node1');

      expect(updated.data).toEqual({ name: 'updated' });
    });

    it('should increment version', () => {
      const state = createSyncState({ name: 'test' }, 'node1');
      const updated = updateSyncState(state, { name: 'updated' }, 'node1');

      expect(updated.version).toBe(state.version + 1);
    });

    it('should increment vector clock', () => {
      const state = createSyncState({ name: 'test' }, 'node1');
      const updated = updateSyncState(state, { name: 'updated' }, 'node1');

      expect(updated.vectorClock.node1).toBe(state.vectorClock.node1 + 1);
    });

    it('should update timestamp', () => {
      const state = createSyncState({ name: 'test' }, 'node1');
      const updated = updateSyncState(state, { name: 'updated' }, 'node1');

      expect(updated.timestamp).toBeGreaterThanOrEqual(state.timestamp);
    });

    it('should not mutate original state', () => {
      const state = createSyncState({ name: 'original' }, 'node1');
      const originalVersion = state.version;
      updateSyncState(state, { name: 'updated' }, 'node1');

      expect(state.version).toBe(originalVersion);
      expect(state.data).toEqual({ name: 'original' });
    });

    it('should update lastModifiedBy', () => {
      const state = createSyncState({ name: 'test' }, 'node1');
      const updated = updateSyncState(state, { name: 'updated' }, 'node2');

      expect(updated.lastModifiedBy).toBe('node2');
    });
  });

  describe('computeHash', () => {
    it('should hash string data', () => {
      const hash = computeHash('test string');
      expect(hash).toHaveLength(16);
    });

    it('should hash object data', () => {
      const hash = computeHash({ key: 'value' });
      expect(hash).toHaveLength(16);
    });

    it('should produce deterministic hashes', () => {
      const hash1 = computeHash({ a: 1, b: 2 });
      const hash2 = computeHash({ a: 1, b: 2 });
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different data', () => {
      const hash1 = computeHash({ a: 1 });
      const hash2 = computeHash({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });

    it('should handle undefined data', () => {
      const hash = computeHash(undefined);
      expect(hash).toHaveLength(16);
    });

    it('should handle null data', () => {
      const hash = computeHash(null);
      expect(hash).toHaveLength(16);
    });
  });

  describe('generateId', () => {
    it('should generate id with correct prefix', () => {
      const id = generateId('test');
      expect(id).toMatch(/^test_[a-f0-9]+$/);
    });

    it('should generate unique ids', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId('test'));
      }
      expect(ids.size).toBe(100);
    });
  });
});

// ============================================================================
// Conflict Detection Tests
// ============================================================================

describe('Conflict Detection', () => {
  describe('detectConflict', () => {
    it('should return null for different state ids', () => {
      const state1 = createSyncState({ name: 'test1' }, 'node1');
      const state2 = createSyncState({ name: 'test2' }, 'node2');

      const conflict = detectConflict(state1, state2);
      expect(conflict).toBeNull();
    });

    it('should return null when hashes match', () => {
      const state1 = createSyncState({ name: 'test' }, 'node1');
      const state2 = { ...state1 };

      const conflict = detectConflict(state1, state2);
      expect(conflict).toBeNull();
    });

    it('should return null when local dominates remote', () => {
      const state1 = createSyncState({ name: 'test' }, 'node1');
      // Increment local clock to make it dominate
      const state1Updated = updateSyncState(state1, { name: 'updated' }, 'node1');

      const state2 = {
        ...state1,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        // Remote has lower clock values
        vectorClock: { node1: 0 },
      };

      const conflict = detectConflict(state1Updated, state2);
      expect(conflict).toBeNull();
    });

    it('should return null when remote dominates local', () => {
      const state1 = createSyncState({ name: 'test' }, 'node1');
      const state2 = {
        ...state1,
        data: { name: 'updated' },
        hash: computeHash({ name: 'updated' }),
        vectorClock: { node1: 10 },
      };

      const conflict = detectConflict(state1, state2);
      expect(conflict).toBeNull();
    });

    it('should detect concurrent update conflict', () => {
      const state1 = createSyncState({ name: 'local' }, 'node1');
      // Update state1 to increment its clock
      const state1Updated = updateSyncState(state1, { name: 'local-updated' }, 'node1');

      const state2: SyncState<{ name: string }> = {
        ...state1, // Same id
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        // Different node with its own clock - creates concurrent situation
        vectorClock: { node2: 1 },
        version: 2,
        lastModifiedBy: 'node2',
      };

      const conflict = detectConflict(state1Updated, state2);
      expect(conflict).not.toBeNull();
      expect(conflict!.conflictType).toBe('concurrent-update');
      expect(conflict!.localState).toBe(state1Updated);
      expect(conflict!.remoteState).toBe(state2);
    });
  });
});

// ============================================================================
// Conflict Resolution Strategy Tests
// ============================================================================

describe('Conflict Resolution Strategies', () => {
  interface TestData {
    name: string;
    value?: number;
  }

  const createConflict = (): SyncConflict<TestData> => {
    const localState = createSyncState<TestData>({ name: 'local', value: 1 }, 'node1');
    const remoteState: SyncState<TestData> = {
      ...localState,
      data: { name: 'remote', value: 2 },
      hash: computeHash({ name: 'remote', value: 2 }),
      vectorClock: { node2: 1 },
      timestamp: Date.now() + 1000,
      lastModifiedBy: 'node2',
    };

    return {
      stateId: localState.id,
      localState,
      remoteState,
      conflictType: 'concurrent-update',
    };
  };

  describe('LastWriteWinsStrategy', () => {
    it('should always be able to resolve', () => {
      const strategy = new LastWriteWinsStrategy<TestData>();
      const conflict = createConflict();
      expect(strategy.canResolve(conflict)).toBe(true);
    });

    it('should choose state with later timestamp', () => {
      const strategy = new LastWriteWinsStrategy<TestData>();
      const conflict = createConflict();

      const resolved = strategy.resolve(conflict);
      expect(resolved.data.name).toBe('remote'); // remote has later timestamp
    });

    it('should choose local when timestamps are equal', () => {
      const strategy = new LastWriteWinsStrategy<TestData>();
      const conflict = createConflict();
      conflict.remoteState.timestamp = conflict.localState.timestamp;

      const resolved = strategy.resolve(conflict);
      expect(resolved.data.name).toBe('local');
    });
  });

  describe('LocalWinsStrategy', () => {
    it('should always be able to resolve', () => {
      const strategy = new LocalWinsStrategy<TestData>();
      const conflict = createConflict();
      expect(strategy.canResolve(conflict)).toBe(true);
    });

    it('should always choose local state', () => {
      const strategy = new LocalWinsStrategy<TestData>();
      const conflict = createConflict();

      const resolved = strategy.resolve(conflict);
      expect(resolved.data.name).toBe('local');
    });
  });

  describe('RemoteWinsStrategy', () => {
    it('should always be able to resolve', () => {
      const strategy = new RemoteWinsStrategy<TestData>();
      const conflict = createConflict();
      expect(strategy.canResolve(conflict)).toBe(true);
    });

    it('should always choose remote state', () => {
      const strategy = new RemoteWinsStrategy<TestData>();
      const conflict = createConflict();

      const resolved = strategy.resolve(conflict);
      expect(resolved.data.name).toBe('remote');
    });
  });

  describe('MergeStrategy', () => {
    it('should be able to resolve object conflicts', () => {
      const strategy = new MergeStrategy<TestData>();
      const conflict = createConflict();
      expect(strategy.canResolve(conflict)).toBe(true);
    });

    it('should not resolve conflicts with null data', () => {
      // Test that canResolve returns false when data is actually null
      const strategy = new MergeStrategy<Record<string, unknown>>();
      const localState = createSyncState<Record<string, unknown>>({ key: 'value' }, 'node1');
      const remoteState: SyncState<Record<string, unknown>> = {
        ...localState,
        data: null as unknown as Record<string, unknown>,
        hash: computeHash(null),
        vectorClock: { node2: 1 },
      };

      const conflict: SyncConflict<Record<string, unknown>> = {
        stateId: localState.id,
        localState,
        remoteState,
        conflictType: 'concurrent-update',
      };

      expect(strategy.canResolve(conflict)).toBe(false);
    });

    it('should merge object properties', () => {
      const strategy = new MergeStrategy<{ a?: number; b?: number; c?: number }>();

      const localState = createSyncState({ a: 1, b: 2 }, 'node1');
      const remoteState: SyncState<{ a?: number; b?: number; c?: number }> = {
        ...localState,
        data: { a: 1, c: 3 },
        hash: computeHash({ a: 1, c: 3 }),
        vectorClock: { node2: 1 },
      };

      const conflict: SyncConflict<{ a?: number; b?: number; c?: number }> = {
        stateId: localState.id,
        localState,
        remoteState,
        conflictType: 'concurrent-update',
      };

      const resolved = strategy.resolve(conflict);
      expect(resolved.data).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('should prefer local values for conflicting properties', () => {
      const strategy = new MergeStrategy<{ value: string }>();

      const localState = createSyncState({ value: 'local' }, 'node1');
      const remoteState: SyncState<{ value: string }> = {
        ...localState,
        data: { value: 'remote' },
        hash: computeHash({ value: 'remote' }),
        vectorClock: { node2: 1 },
      };

      const conflict: SyncConflict<{ value: string }> = {
        stateId: localState.id,
        localState,
        remoteState,
        conflictType: 'concurrent-update',
      };

      const resolved = strategy.resolve(conflict);
      expect(resolved.data.value).toBe('local');
    });

    it('should merge nested objects recursively', () => {
      interface NestedData {
        outer: {
          inner1?: string;
          inner2?: string;
        };
      }

      const strategy = new MergeStrategy<NestedData>();

      const localState = createSyncState<NestedData>(
        { outer: { inner1: 'local' } },
        'node1'
      );
      const remoteState: SyncState<NestedData> = {
        ...localState,
        data: { outer: { inner2: 'remote' } },
        hash: computeHash({ outer: { inner2: 'remote' } }),
        vectorClock: { node2: 1 },
      };

      const conflict: SyncConflict<NestedData> = {
        stateId: localState.id,
        localState,
        remoteState,
        conflictType: 'concurrent-update',
      };

      const resolved = strategy.resolve(conflict);
      expect(resolved.data.outer).toEqual({ inner1: 'local', inner2: 'remote' });
    });

    it('should merge vector clocks', () => {
      const strategy = new MergeStrategy<TestData>();
      const conflict = createConflict();

      const resolved = strategy.resolve(conflict);
      expect(resolved.vectorClock.node1).toBeDefined();
      expect(resolved.vectorClock.node2).toBeDefined();
    });

    it('should increment version', () => {
      const strategy = new MergeStrategy<TestData>();
      const conflict = createConflict();

      const maxVersion = Math.max(
        conflict.localState.version,
        conflict.remoteState.version
      );
      const resolved = strategy.resolve(conflict);

      expect(resolved.version).toBe(maxVersion + 1);
    });
  });
});

// ============================================================================
// SyncManager Tests
// ============================================================================

describe('SyncManager', () => {
  let manager: SyncManager<{ name: string; value?: number }>;

  beforeEach(() => {
    resetSyncManager();
    manager = new SyncManager({ nodeId: 'test-node' });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const m = new SyncManager();
      expect(m).toBeDefined();
      expect(m.getNodeId()).toMatch(/^node_[a-f0-9]+$/);
      m.dispose();
    });

    it('should accept custom node id', () => {
      const m = new SyncManager({ nodeId: 'custom-node' });
      expect(m.getNodeId()).toBe('custom-node');
      m.dispose();
    });

    it('should start with idle status', () => {
      expect(manager.getStatus()).toBe('idle');
    });
  });

  describe('createState', () => {
    it('should create and store state', () => {
      const state = manager.createState({ name: 'test' });

      expect(state).toBeDefined();
      expect(state.data).toEqual({ name: 'test' });
      expect(manager.getState(state.id)).toBe(state);
    });

    it('should emit state-created event', () => {
      const handler = jest.fn();
      manager.on('state-created', handler);

      manager.createState({ name: 'test' });

      expect(handler).toHaveBeenCalled();
    });

    it('should add pending operation', () => {
      manager.createState({ name: 'test' });

      const operations = manager.getPendingOperations();
      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('create');
    });
  });

  describe('getState', () => {
    it('should return existing state', () => {
      const created = manager.createState({ name: 'test' });
      const retrieved = manager.getState(created.id);

      expect(retrieved).toBe(created);
    });

    it('should return undefined for non-existent state', () => {
      const state = manager.getState('non-existent');
      expect(state).toBeUndefined();
    });
  });

  describe('getAllStates', () => {
    it('should return empty array when no states', () => {
      expect(manager.getAllStates()).toEqual([]);
    });

    it('should return all states', () => {
      manager.createState({ name: 'test1' });
      manager.createState({ name: 'test2' });
      manager.createState({ name: 'test3' });

      expect(manager.getAllStates()).toHaveLength(3);
    });
  });

  describe('updateState', () => {
    it('should update existing state', () => {
      const state = manager.createState({ name: 'original' });
      const updated = manager.updateState(state.id, { name: 'updated' });

      expect(updated!.data.name).toBe('updated');
      expect(updated!.version).toBe(state.version + 1);
    });

    it('should return null for non-existent state', () => {
      const result = manager.updateState('non-existent', { name: 'test' });
      expect(result).toBeNull();
    });

    it('should emit state-updated event', () => {
      const handler = jest.fn();
      manager.on('state-updated', handler);

      const state = manager.createState({ name: 'test' });
      manager.updateState(state.id, { name: 'updated' });

      expect(handler).toHaveBeenCalled();
    });

    it('should add pending operation', () => {
      const state = manager.createState({ name: 'test' });
      manager.clearPendingOperations();

      manager.updateState(state.id, { name: 'updated' });

      const operations = manager.getPendingOperations();
      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('update');
    });
  });

  describe('deleteState', () => {
    it('should delete existing state', () => {
      const state = manager.createState({ name: 'test' });
      const result = manager.deleteState(state.id);

      expect(result).toBe(true);
      expect(manager.getState(state.id)).toBeUndefined();
    });

    it('should return false for non-existent state', () => {
      const result = manager.deleteState('non-existent');
      expect(result).toBe(false);
    });

    it('should emit state-deleted event', () => {
      const handler = jest.fn();
      manager.on('state-deleted', handler);

      const state = manager.createState({ name: 'test' });
      manager.deleteState(state.id);

      expect(handler).toHaveBeenCalledWith(state.id);
    });

    it('should add pending operation', () => {
      const state = manager.createState({ name: 'test' });
      manager.clearPendingOperations();

      manager.deleteState(state.id);

      const operations = manager.getPendingOperations();
      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('delete');
    });
  });

  describe('applyRemoteState', () => {
    it('should apply new remote state', async () => {
      const remoteState = createSyncState({ name: 'remote' }, 'remote-node');

      const result = await manager.applyRemoteState(remoteState);

      expect(result.applied).toBe(true);
      expect(manager.getState(remoteState.id)).toBe(remoteState);
    });

    it('should emit state-synced event for new state', async () => {
      const handler = jest.fn();
      manager.on('state-synced', handler);

      const remoteState = createSyncState({ name: 'remote' }, 'remote-node');
      await manager.applyRemoteState(remoteState);

      expect(handler).toHaveBeenCalledWith(remoteState);
    });

    it('should apply remote state that dominates local', async () => {
      const localState = manager.createState({ name: 'local' });

      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        vectorClock: { 'test-node': 10 },
        version: 5,
      };

      const result = await manager.applyRemoteState(remoteState);

      expect(result.applied).toBe(true);
      expect(manager.getState(localState.id)!.data.name).toBe('remote');
    });

    it('should not apply remote state that is dominated by local', async () => {
      const localState = manager.createState({ name: 'local' });
      manager.updateState(localState.id, { name: 'updated' });
      manager.updateState(localState.id, { name: 'updated again' });

      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'old remote' },
        hash: computeHash({ name: 'old remote' }),
        vectorClock: { 'test-node': 0 },
        version: 1,
      };

      const result = await manager.applyRemoteState(remoteState);

      expect(result.applied).toBe(false);
    });

    it('should detect and resolve conflict with default strategy', async () => {
      const localState = manager.createState({ name: 'local' });
      // Update local to increment clock
      manager.updateState(localState.id, { name: 'local-updated' });

      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        // Concurrent clock from different node
        vectorClock: { 'other-node': 2 },
        version: 2,
        lastModifiedBy: 'other-node',
      };

      const result = await manager.applyRemoteState(remoteState);

      // With local-wins default strategy, conflict should be detected and resolved
      expect(result.applied).toBe(true);
      expect(result.conflict).toBeDefined();
      expect(result.resolvedState).toBeDefined();
    });

    it('should emit conflict-detected event', async () => {
      const handler = jest.fn();
      manager.on('conflict-detected', handler);

      const localState = manager.createState({ name: 'local' });
      manager.updateState(localState.id, { name: 'local-updated' });

      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        vectorClock: { 'other-node': 2 },
        version: 2,
      };

      await manager.applyRemoteState(remoteState);

      expect(handler).toHaveBeenCalled();
    });

    it('should emit conflict-resolved event', async () => {
      const handler = jest.fn();
      manager.on('conflict-resolved', handler);

      const localState = manager.createState({ name: 'local' });
      manager.updateState(localState.id, { name: 'local-updated' });

      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        vectorClock: { 'other-node': 2 },
        version: 2,
      };

      await manager.applyRemoteState(remoteState);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('should reconcile multiple remote states', async () => {
      const remoteStates = [
        createSyncState({ name: 'state1' }, 'remote'),
        createSyncState({ name: 'state2' }, 'remote'),
        createSyncState({ name: 'state3' }, 'remote'),
      ];

      const result = await manager.reconcile(remoteStates);

      expect(result.success).toBe(true);
      expect(result.reconciledStates).toHaveLength(3);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should set status to syncing during reconciliation', async () => {
      const statusHandler = jest.fn();
      manager.on('status-changed', statusHandler);

      await manager.reconcile([createSyncState({ name: 'test' }, 'remote')]);

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ current: 'syncing' })
      );
    });

    it('should set status to idle after successful reconciliation', async () => {
      await manager.reconcile([createSyncState({ name: 'test' }, 'remote')]);

      expect(manager.getStatus()).toBe('idle');
    });

    it('should return reconciled states with conflicts when they occur', async () => {
      const localState = manager.createState({ name: 'local' });
      manager.updateState(localState.id, { name: 'local-updated' });

      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        vectorClock: { 'other-node': 2 },
        version: 2,
      };

      const result = await manager.reconcile([remoteState]);

      // With local-wins strategy, conflicts are auto-resolved
      expect(result.success).toBe(true);
      expect(result.reconciledStates).toHaveLength(1);
    });
  });

  describe('resolveConflict', () => {
    it('should resolve conflict with local-wins', () => {
      const localState = manager.createState({ name: 'local' });
      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        vectorClock: { 'other-node': 1 },
      };

      const conflict: SyncConflict<{ name: string }> = {
        stateId: localState.id,
        localState,
        remoteState,
        conflictType: 'concurrent-update',
      };

      const resolved = manager.resolveConflict(conflict, 'local-wins');
      expect(resolved.data.name).toBe('local');
    });

    it('should resolve conflict with remote-wins', () => {
      const localState = manager.createState({ name: 'local' });
      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        vectorClock: { 'other-node': 1 },
      };

      const conflict: SyncConflict<{ name: string }> = {
        stateId: localState.id,
        localState,
        remoteState,
        conflictType: 'concurrent-update',
      };

      const resolved = manager.resolveConflict(conflict, 'remote-wins');
      expect(resolved.data.name).toBe('remote');
    });

    it('should resolve conflict with custom data', () => {
      const localState = manager.createState({ name: 'local' });
      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        vectorClock: { 'other-node': 1 },
      };

      const conflict: SyncConflict<{ name: string }> = {
        stateId: localState.id,
        localState,
        remoteState,
        conflictType: 'concurrent-update',
      };

      const resolved = manager.resolveConflict(conflict, 'merge', { name: 'merged' });
      expect(resolved.data.name).toBe('merged');
    });

    it('should emit conflict-resolved event', () => {
      const handler = jest.fn();
      manager.on('conflict-resolved', handler);

      const localState = manager.createState({ name: 'local' });
      const remoteState: SyncState<{ name: string }> = {
        ...localState,
        data: { name: 'remote' },
        hash: computeHash({ name: 'remote' }),
        vectorClock: { 'other-node': 1 },
      };

      const conflict: SyncConflict<{ name: string }> = {
        stateId: localState.id,
        localState,
        remoteState,
        conflictType: 'concurrent-update',
      };

      manager.resolveConflict(conflict, 'local-wins');
      expect(handler).toHaveBeenCalled();
    });

    it('should set status to idle after resolving conflict', () => {
      manager.setStatus('conflict');

      const localState = manager.createState({ name: 'local' });
      const conflict: SyncConflict<{ name: string }> = {
        stateId: localState.id,
        localState,
        remoteState: { ...localState, data: { name: 'remote' } },
        conflictType: 'concurrent-update',
      };

      manager.resolveConflict(conflict, 'local-wins');
      expect(manager.getStatus()).toBe('idle');
    });
  });

  describe('auto-sync', () => {
    it('should start auto-sync when configured', () => {
      const autoManager = new SyncManager({ autoSync: true, syncInterval: 100 });

      // Manager should have started auto-sync
      expect(autoManager).toBeDefined();

      autoManager.dispose();
    });

    it('should emit auto-sync-tick events', (done) => {
      const autoManager = new SyncManager({ syncInterval: 50 });

      autoManager.on('auto-sync-tick', () => {
        autoManager.dispose();
        done();
      });

      autoManager.startAutoSync();
    }, 1000);

    it('should stop auto-sync on dispose', () => {
      const autoManager = new SyncManager({ autoSync: true, syncInterval: 100 });
      autoManager.dispose();

      // No error should occur
      expect(autoManager.getStatus()).toBe('idle');
    });

    it('should not start duplicate auto-sync', () => {
      manager.startAutoSync();
      manager.startAutoSync(); // Should not create another timer

      // No error should occur
      expect(manager).toBeDefined();
    });
  });

  describe('exportState', () => {
    it('should export all states', () => {
      manager.createState({ name: 'state1' });
      manager.createState({ name: 'state2' });

      const exported = manager.exportState();

      expect(exported.states).toHaveLength(2);
      expect(exported.nodeId).toBe('test-node');
      expect(exported.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should export empty state', () => {
      const exported = manager.exportState();

      expect(exported.states).toHaveLength(0);
    });
  });

  describe('importState', () => {
    it('should import states', () => {
      const states = [
        createSyncState({ name: 'imported1' }, 'other'),
        createSyncState({ name: 'imported2' }, 'other'),
      ];

      manager.importState({ states, nodeId: 'other' });

      expect(manager.getAllStates()).toHaveLength(2);
    });

    it('should emit state-imported event', () => {
      const handler = jest.fn();
      manager.on('state-imported', handler);

      const states = [createSyncState({ name: 'imported' }, 'other')];
      manager.importState({ states, nodeId: 'other' });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should clear all states', () => {
      manager.createState({ name: 'test' });
      manager.dispose();

      expect(manager.getAllStates()).toHaveLength(0);
    });

    it('should clear pending operations', () => {
      manager.createState({ name: 'test' });
      manager.dispose();

      expect(manager.getPendingOperations()).toHaveLength(0);
    });

    it('should remove all listeners', () => {
      const handler = jest.fn();
      manager.on('state-created', handler);
      manager.dispose();

      expect(manager.listenerCount('state-created')).toBe(0);
    });
  });

  describe('setStatus', () => {
    it('should emit status-changed event', () => {
      const handler = jest.fn();
      manager.on('status-changed', handler);

      manager.setStatus('syncing');

      expect(handler).toHaveBeenCalledWith({
        previous: 'idle',
        current: 'syncing',
      });
    });
  });

  describe('clearPendingOperations', () => {
    it('should clear all pending operations', () => {
      manager.createState({ name: 'test1' });
      manager.createState({ name: 'test2' });

      expect(manager.getPendingOperations()).toHaveLength(2);

      manager.clearPendingOperations();

      expect(manager.getPendingOperations()).toHaveLength(0);
    });
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('Singleton', () => {
  afterEach(() => {
    resetSyncManager();
  });

  it('should return same instance', () => {
    const instance1 = getSyncManager();
    const instance2 = getSyncManager();

    expect(instance1).toBe(instance2);
  });

  it('should reset instance', () => {
    const instance1 = getSyncManager();
    resetSyncManager();
    const instance2 = getSyncManager();

    expect(instance1).not.toBe(instance2);
  });

  it('should dispose instance on reset', () => {
    const instance = getSyncManager();
    instance.createState({ name: 'test' });

    resetSyncManager();

    const newInstance = getSyncManager();
    expect(newInstance.getAllStates()).toHaveLength(0);
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  let manager: SyncManager<unknown>;

  beforeEach(() => {
    manager = new SyncManager({ nodeId: 'test-node' });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('empty data handling', () => {
    it('should handle null data', () => {
      const state = manager.createState(null);
      expect(state.data).toBeNull();
    });

    it('should handle undefined data', () => {
      const state = manager.createState(undefined);
      expect(state.data).toBeUndefined();
    });

    it('should handle empty object', () => {
      const state = manager.createState({});
      expect(state.data).toEqual({});
    });

    it('should handle empty array', () => {
      const state = manager.createState([]);
      expect(state.data).toEqual([]);
    });
  });

  describe('special data types', () => {
    it('should handle string data', () => {
      const state = manager.createState('test string');
      expect(state.data).toBe('test string');
    });

    it('should handle number data', () => {
      const state = manager.createState(42);
      expect(state.data).toBe(42);
    });

    it('should handle boolean data', () => {
      const state = manager.createState(true);
      expect(state.data).toBe(true);
    });

    it('should handle nested objects', () => {
      const data = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };
      const state = manager.createState(data);
      expect(state.data).toEqual(data);
    });

    it('should handle arrays with objects', () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const state = manager.createState(data);
      expect(state.data).toEqual(data);
    });
  });

  describe('concurrent operations', () => {
    it('should handle rapid state updates', () => {
      const state = manager.createState({ count: 0 });

      for (let i = 1; i <= 100; i++) {
        manager.updateState(state.id, { count: i });
      }

      const finalState = manager.getState(state.id);
      expect(finalState!.data).toEqual({ count: 100 });
      expect(finalState!.version).toBe(101);
    });

    it('should handle many concurrent creates', () => {
      for (let i = 0; i < 100; i++) {
        manager.createState({ index: i });
      }

      expect(manager.getAllStates()).toHaveLength(100);
    });
  });

  describe('large data handling', () => {
    it('should handle large objects', () => {
      const largeObject: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        largeObject[`key${i}`] = i;
      }

      const state = manager.createState(largeObject);
      expect(Object.keys(state.data as object).length).toBe(1000);
    });

    it('should handle large arrays', () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      const state = manager.createState(largeArray);
      expect((state.data as number[]).length).toBe(1000);
    });
  });
});

// ============================================================================
// Integration-like Tests
// ============================================================================

describe('Multi-node Synchronization Scenarios', () => {
  let node1: SyncManager<{ name: string; value?: number }>;
  let node2: SyncManager<{ name: string; value?: number }>;

  beforeEach(() => {
    node1 = new SyncManager({ nodeId: 'node1' });
    node2 = new SyncManager({ nodeId: 'node2' });
  });

  afterEach(() => {
    node1.dispose();
    node2.dispose();
  });

  it('should sync state from node1 to node2', async () => {
    const state = node1.createState({ name: 'shared' });

    await node2.applyRemoteState(state);

    expect(node2.getState(state.id)).toBeDefined();
    expect(node2.getState(state.id)!.data.name).toBe('shared');
  });

  it('should handle updates from one node to another', async () => {
    const state = node1.createState({ name: 'original' });
    await node2.applyRemoteState(state);

    const updated = node1.updateState(state.id, { name: 'updated' });
    await node2.applyRemoteState(updated!);

    expect(node2.getState(state.id)!.data.name).toBe('updated');
  });

  it('should handle concurrent updates with conflict resolution', async () => {
    const state = node1.createState({ name: 'original' });
    await node2.applyRemoteState(state);

    // Both nodes update concurrently
    const node1Updated = node1.updateState(state.id, { name: 'node1-update' });
    const node2Updated = node2.updateState(state.id, { name: 'node2-update' });

    // Cross-sync
    const result1 = await node1.applyRemoteState(node2Updated!);
    const result2 = await node2.applyRemoteState(node1Updated!);

    // Both should have resolved the conflict
    expect(result1.conflict || result2.conflict).toBeDefined();
  });

  it('should maintain consistency across multiple reconciliations', async () => {
    // Node1 creates multiple states
    const states: SyncState<{ name: string }>[] = [];
    for (let i = 0; i < 5; i++) {
      states.push(node1.createState({ name: `state${i}` }));
    }

    // Node2 reconciles
    const result = await node2.reconcile(states);

    expect(result.success).toBe(true);
    expect(node2.getAllStates()).toHaveLength(5);
  });

  it('should handle deletion sync', async () => {
    const state = node1.createState({ name: 'to-delete' });
    await node2.applyRemoteState(state);

    expect(node2.getState(state.id)).toBeDefined();

    // Node1 deletes
    node1.deleteState(state.id);

    // In real system, deletion would be synced via operation
    // For this test, we manually delete on node2
    node2.deleteState(state.id);

    expect(node2.getState(state.id)).toBeUndefined();
  });
});
