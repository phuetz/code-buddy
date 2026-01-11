
import { SyncManager } from '../../src/sync/index.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';

// Mock UnifiedVfsRouter
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockExists = jest.fn();
const mockEnsureDir = jest.fn();

jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
    },
  },
}));

describe('Sync Persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should save state to disk on creation', async () => {
    const manager = new SyncManager();
    // Wait for initial load attempt
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const savePromise = new Promise(resolve => manager.once('saved', resolve));
    manager.createState({ foo: 'bar' });
    await savePromise;
    
    // Check if save was called
    // save() calls ensureDir and writeFile
    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
    
    // Check content of writeFile
    const content = mockWriteFile.mock.calls[0][1];
    expect(content).toContain('foo');
    expect(content).toContain('bar');
  });

  it('should load state from disk on init', async () => {
    // Setup mock data for load
    mockExists.mockResolvedValue(true);
    const savedState = {
      nodeId: 'test-node',
      states: [['state1', { id: 'state1', data: { restored: true }, version: 1 }]],
      pendingOperations: []
    };
    mockReadFile.mockResolvedValue(JSON.stringify(savedState));
    
    const manager = new SyncManager();
    
    // Wait for load to complete (it's called in constructor but async)
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const state = manager.getState('state1');
    expect(state).toBeDefined();
    expect((state?.data as any).restored).toBe(true);
  });
});
