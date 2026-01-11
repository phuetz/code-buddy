
import { handleMemory, handleRemember } from '../../src/commands/handlers/memory-handlers.js';
import { getEnhancedMemory } from '../../src/memory/index.js';

// Mock getEnhancedMemory
jest.mock('../../src/memory/index.js', () => {
  const mockMemory = {
    store: jest.fn().mockResolvedValue({ id: '1' }),
    recall: jest.fn().mockResolvedValue([]),
    forget: jest.fn().mockResolvedValue(true),
    formatStatus: jest.fn().mockReturnValue('Memory Status OK'),
    buildContext: jest.fn().mockResolvedValue('Memory Context'),
    isEnabled: jest.fn().mockReturnValue(true),
  };
  return {
    getEnhancedMemory: jest.fn().mockReturnValue(mockMemory),
    EnhancedMemory: jest.fn(),
  };
});

jest.mock('../../src/tools/comment-watcher.js', () => ({
  getCommentWatcher: jest.fn(),
}));

describe('Memory Commands', () => {
  let mockMemory: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMemory = getEnhancedMemory();
  });

  describe('handleMemory', () => {
    it('should show list/status by default', async () => {
      const result = await handleMemory([]);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Memory Status OK');
      expect(mockMemory.formatStatus).toHaveBeenCalled();
    });

    it('should handle store/remember command', async () => {
      const result = await handleMemory(['store', 'key', 'value']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('✅ Remembered');
      expect(mockMemory.store).toHaveBeenCalledWith(expect.objectContaining({
        content: 'value',
        tags: ['key']
      }));
    });

    it('should handle recall command with results', async () => {
      mockMemory.recall.mockResolvedValueOnce([
        { type: 'fact', content: 'test content', importance: 0.8, createdAt: new Date() }
      ]);
      const result = await handleMemory(['recall', 'query']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Recall Results');
      expect(mockMemory.recall).toHaveBeenCalledWith(expect.objectContaining({
        query: 'query'
      }));
    });

    it('should handle recall command with no results', async () => {
        mockMemory.recall.mockResolvedValueOnce([]);
        const result = await handleMemory(['recall', 'query']);
        expect(result.handled).toBe(true);
        expect(result.entry?.content).toContain('No matching memories found');
    });

    it('should handle context command', async () => {
      const result = await handleMemory(['context']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Current Context Injection');
      expect(mockMemory.buildContext).toHaveBeenCalled();
    });
    
    it('should handle forget command', async () => {
      mockMemory.recall.mockResolvedValueOnce([{ id: '1', content: 'test' }]);
      const result = await handleMemory(['forget', 'tag']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Forgot 1 memories');
      expect(mockMemory.forget).toHaveBeenCalledWith('1');
    });
  });

  describe('handleRemember', () => {
     it('should handle shortcut', async () => {
       const result = await handleRemember(['key', 'value']);
       expect(result.handled).toBe(true);
       expect(mockMemory.store).toHaveBeenCalled();
     });
     
     it('should show usage if args missing', async () => {
       const result = await handleRemember(['key']);
       expect(result.handled).toBe(true);
       expect(result.entry?.content).toContain('Usage:');
     });
  });
});
