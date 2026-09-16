
import { handleMemory, handleRemember } from '../../src/commands/handlers/memory-handlers.js';
import { getEnhancedMemory, getMemoryManager } from '../../src/memory/index.js';

const { mockCandidateQueue } = vi.hoisted(() => ({
  mockCandidateQueue: {
    list: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
  },
}));

// Mock getEnhancedMemory and getMemoryManager
vi.mock('../../src/memory/index.js', () => {
  const mockEnhancedMemory = {
    store: vi.fn().mockResolvedValue({ id: '1' }),
    recall: vi.fn().mockResolvedValue([]),
    forget: vi.fn().mockResolvedValue(true),
    formatStatus: vi.fn().mockReturnValue('Memory Status OK'),
    buildContext: vi.fn().mockResolvedValue('Memory Context'),
    isEnabled: vi.fn().mockReturnValue(true),
  };
  const mockPersistentMemory = {
    initialize: vi.fn().mockResolvedValue(undefined),
    remember: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue({
      status: 'replaced',
      key: 'key',
      scope: 'project',
      usage: { used: 12, limit: 2200, percent: 1 },
      message: 'Replaced "key" in project memory.',
    }),
    recall: vi.fn().mockReturnValue(null),
    forget: vi.fn().mockResolvedValue(false),
    formatMemories: vi.fn().mockReturnValue('Persistent Memory Status OK'),
    getContextForPrompt: vi.fn().mockReturnValue('Persistent Context'),
    getRecentMemories: vi.fn().mockReturnValue([]),
  };
  return {
    getEnhancedMemory: vi.fn().mockReturnValue(mockEnhancedMemory),
    getMemoryManager: vi.fn().mockReturnValue(mockPersistentMemory),
    EnhancedMemory: vi.fn(),
  };
});

vi.mock('../../src/memory/memory-candidate-queue.js', () => ({
  getMemoryCandidateQueue: vi.fn(() => mockCandidateQueue),
}));

vi.mock('../../src/tools/comment-watcher.js', () => ({
  getCommentWatcher: vi.fn(),
}));

vi.mock('../../src/errors/index.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => e instanceof Error ? e.message : String(e)),
}));

describe('Memory Commands', () => {
  type MockEnhancedMemory = {
    store: ReturnType<typeof vi.fn>;
    recall: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
    buildContext: ReturnType<typeof vi.fn>;
  };
  type MockPersistentMemory = {
    remember: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
    recall: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
    formatMemories: ReturnType<typeof vi.fn>;
    getContextForPrompt: ReturnType<typeof vi.fn>;
    getRecentMemories: ReturnType<typeof vi.fn>;
  };

  let mockEnhancedMem: MockEnhancedMemory;
  let mockPersistentMem: MockPersistentMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnhancedMem = getEnhancedMemory() as unknown as MockEnhancedMemory;
    mockPersistentMem = getMemoryManager() as unknown as MockPersistentMemory;
    mockCandidateQueue.list.mockReturnValue([]);
    mockCandidateQueue.accept.mockResolvedValue({
      candidate: {
        id: 'mc-1',
        key: 'runtime',
        value: 'Node 22',
        scope: 'project',
        category: 'project',
        status: 'accepted',
        createdAt: Date.now(),
        source: 'manual',
      },
      write: {
        status: 'stored',
        usage: { used: 20, limit: 2200, percent: 1 },
      },
    });
    mockCandidateQueue.reject.mockReturnValue({
      id: 'mc-1',
      key: 'runtime',
      value: 'Node 22',
      scope: 'project',
      category: 'project',
      status: 'rejected',
      createdAt: Date.now(),
      source: 'manual',
    });
  });

  describe('handleMemory', () => {
    it('should show list/status by default', async () => {
      const result = await handleMemory([]);
      expect(result.handled).toBe(true);
      // The handler now uses persistentMemory.formatMemories() for list/status
      expect(result.entry?.content).toContain('Persistent Memory Status OK');
      expect(mockPersistentMem.formatMemories).toHaveBeenCalled();
    });

    it('should handle store/remember command', async () => {
      const result = await handleMemory(['store', 'key', 'value']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Remembered');
      // Both persistent and enhanced memory are called
      expect(mockPersistentMem.remember).toHaveBeenCalled();
      expect(mockEnhancedMem.store).toHaveBeenCalled();
    });

    it('should handle replace command', async () => {
      const result = await handleMemory(['replace', 'key', 'new', 'value']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Replaced "key"');
      expect(mockPersistentMem.replace).toHaveBeenCalledWith('key', 'new value', { scope: 'project' });
    });

    it('should handle recall command with results', async () => {
      mockEnhancedMem.recall.mockResolvedValueOnce([
        { type: 'fact', content: 'test content', importance: 0.8, createdAt: new Date() }
      ]);
      const result = await handleMemory(['recall', 'query']);
      expect(result.handled).toBe(true);
      // The handler shows results from enhanced memory as "Enhanced Memory (Semantic)"
      expect(result.entry?.content).toContain('Enhanced Memory');
      expect(mockEnhancedMem.recall).toHaveBeenCalledWith(expect.objectContaining({
        query: 'query'
      }));
    });

    it('should handle recall command with no results', async () => {
        mockEnhancedMem.recall.mockResolvedValueOnce([]);
        mockPersistentMem.recall.mockReturnValue(null);
        const result = await handleMemory(['recall', 'query']);
        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('No matching memories found');
    });

    it('should handle context command', async () => {
      const result = await handleMemory(['context']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Current Context Injection');
      expect(mockEnhancedMem.buildContext).toHaveBeenCalled();
      expect(mockPersistentMem.getContextForPrompt).toHaveBeenCalled();
    });

    it('should handle forget command', async () => {
      // The new implementation uses persistentMemory.forget first, then falls back to enhanced
      mockPersistentMem.forget.mockResolvedValue(true);
      const result = await handleMemory(['forget', 'tag']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Forgot');
      expect(mockPersistentMem.forget).toHaveBeenCalledWith('tag', 'project');
    });

    it('should handle forget via enhanced memory fallback', async () => {
      mockPersistentMem.forget.mockResolvedValue(false);
      mockEnhancedMem.recall.mockResolvedValueOnce([
        { id: '2', content: 'api key for service', tags: [] },
      ]);
      mockEnhancedMem.forget.mockResolvedValue(true);

      const result = await handleMemory(['forget', 'api']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Forgot');
      expect(mockEnhancedMem.forget).toHaveBeenCalledWith('2');
    });

    describe('recent', () => {
      it('shows the empty-state hint when no memories exist', async () => {
        mockPersistentMem.getRecentMemories.mockReturnValueOnce([]);
        const result = await handleMemory(['recent']);
        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('No memories yet');
        // Empty-state mentions BOTH paths users can populate it through.
        expect(result.entry?.content).toContain('/memory remember');
        expect(result.entry?.content).toContain('`remember` tool');
      });

      it('formats recent memories with scope, key, category, and relative time', async () => {
        const oneMinAgo = new Date(Date.now() - 60_000);
        mockPersistentMem.getRecentMemories.mockReturnValueOnce([
          {
            key: 'indent-style',
            value: 'The codebase uses 2-space indent, no tabs.',
            category: 'patterns',
            scope: 'project',
            createdAt: oneMinAgo,
            updatedAt: oneMinAgo,
            accessCount: 0,
          },
        ]);
        const result = await handleMemory(['recent']);
        expect(result.handled).toBe(true);
        const c = result.entry?.content as string;
        expect(c).toContain('Recent memories (showing 1)');
        expect(c).toContain('[project] indent-style (patterns)');
        expect(c).toContain('1 minute ago');
        expect(c).toContain('The codebase uses 2-space indent, no tabs.');
      });

      it('parses the limit arg and clamps to [1, 50]', async () => {
        mockPersistentMem.getRecentMemories.mockReturnValue([]);
        await handleMemory(['recent', '5']);
        expect(mockPersistentMem.getRecentMemories).toHaveBeenLastCalledWith(5, undefined);

        await handleMemory(['recent', '999']);
        expect(mockPersistentMem.getRecentMemories).toHaveBeenLastCalledWith(50, undefined);

        await handleMemory(['recent', '-1']);
        expect(mockPersistentMem.getRecentMemories).toHaveBeenLastCalledWith(1, undefined);

        await handleMemory(['recent', 'not-a-number']);
        expect(mockPersistentMem.getRecentMemories).toHaveBeenLastCalledWith(10, undefined);
      });

      it('forwards the scope filter when given', async () => {
        mockPersistentMem.getRecentMemories.mockReturnValue([]);
        await handleMemory(['recent', '10', 'project']);
        expect(mockPersistentMem.getRecentMemories).toHaveBeenLastCalledWith(10, 'project');

        await handleMemory(['recent', '10', 'user']);
        expect(mockPersistentMem.getRecentMemories).toHaveBeenLastCalledWith(10, 'user');

        // Garbage scope arg → undefined (no filter)
        await handleMemory(['recent', '10', 'whatever']);
        expect(mockPersistentMem.getRecentMemories).toHaveBeenLastCalledWith(10, undefined);
      });
    });

    describe('memory candidates', () => {
      it('lists pending memory candidates with citations', async () => {
        mockCandidateQueue.list.mockReturnValueOnce([
          {
            id: 'mc-1',
            key: 'runtime',
            value: 'The project targets Node 22.',
            scope: 'project',
            category: 'project',
            status: 'pending',
            createdAt: Date.now(),
            source: 'session_end',
            confidence: 0.8,
            citations: [{ sessionId: 'sess-1', messageIndex: 2, role: 'user', snippet: 'Project targets Node 22.' }],
          },
        ]);

        const result = await handleMemory(['candidates']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('Memory candidates');
        expect(result.entry?.content).toContain('mc-1');
        expect(result.entry?.content).toContain('runtime');
        expect(result.entry?.content).toContain('sess-1#2');
      });

      it('accepts a memory candidate using the slash command as reviewer when omitted', async () => {
        const result = await handleMemory(['accept', 'mc-1']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('Accepted mc-1');
        expect(mockCandidateQueue.accept).toHaveBeenCalledWith('mc-1', { reviewedBy: 'user' });
      });

      it('rejects a memory candidate with a reason', async () => {
        const result = await handleMemory(['reject', 'mc-1', 'too', 'transient']);

        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('Rejected memory candidate mc-1');
        expect(mockCandidateQueue.reject).toHaveBeenCalledWith('mc-1', {
          reviewedBy: 'user',
          reason: 'too transient',
        });
      });
    });

    it('should show usage for forget without args', async () => {
      const result = await handleMemory(['forget']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('forget');
    });
  });

  describe('handleRemember', () => {
     it('should handle shortcut', async () => {
       const result = await handleRemember(['key', 'value']);
       expect(result.handled).toBe(true);
       // handleRemember calls both persistentMemory.remember and enhancedMemory.store
       expect(mockPersistentMem.remember).toHaveBeenCalled();
       expect(mockEnhancedMem.store).toHaveBeenCalled();
     });

     it('should show usage if args missing', async () => {
       const result = await handleRemember(['key']);
       expect(result.handled).toBe(true);
       expect(result.entry?.content).toContain('Usage:');
     });
  });
});
