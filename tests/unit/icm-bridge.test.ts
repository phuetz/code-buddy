/**
 * ICM Bridge Tests
 */

import { ICMBridge, type MCPToolCaller } from '../../src/memory/icm-bridge.js';

function createMockCaller(options?: {
  servers?: string[];
  toolResults?: Record<string, unknown>;
}): MCPToolCaller {
  const servers = options?.servers ?? ['icm'];
  const toolResults = options?.toolResults ?? {};

  return {
    getConnectedServers: jest.fn(() => servers),
    callTool: jest.fn(async (_server: string, toolName: string, _args: Record<string, unknown>) => {
      if (toolResults[toolName] !== undefined) return toolResults[toolName];
      return [];
    }),
  };
}

describe('ICMBridge', () => {
  describe('initialize', () => {
    it('should mark as available when ICM server is connected', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller({ servers: ['icm', 'brave-search'] });

      await bridge.initialize(caller);

      expect(bridge.isAvailable()).toBe(true);
    });

    it('should mark as unavailable when ICM server is not connected', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller({ servers: ['brave-search'] });

      await bridge.initialize(caller);

      expect(bridge.isAvailable()).toBe(false);
    });

    it('should handle initialization errors gracefully', async () => {
      const bridge = new ICMBridge();
      const caller: MCPToolCaller = {
        getConnectedServers: jest.fn(() => { throw new Error('connection error'); }),
        callTool: jest.fn(),
      };

      await bridge.initialize(caller);

      expect(bridge.isAvailable()).toBe(false);
    });
  });

  describe('storeEpisode', () => {
    it('should call create_memory tool via MCP', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller();
      await bridge.initialize(caller);

      await bridge.storeEpisode('User asked about TypeScript generics', {
        source: 'conversation',
        sessionId: 'session-123',
      });

      expect(caller.callTool).toHaveBeenCalledWith('icm', 'create_memory', {
        content: 'User asked about TypeScript generics',
        metadata: { source: 'conversation', sessionId: 'session-123' },
      });
    });

    it('should silently skip when unavailable', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller({ servers: [] });
      await bridge.initialize(caller);

      await bridge.storeEpisode('test content');

      expect(caller.callTool).not.toHaveBeenCalled();
    });

    it('should handle store errors gracefully', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller();
      (caller.callTool as jest.Mock).mockRejectedValueOnce(new Error('store failed'));
      await bridge.initialize(caller);

      // Should not throw
      await bridge.storeEpisode('test content');
    });
  });

  describe('searchMemory', () => {
    it('should return results from search_memory tool', async () => {
      const mockResults = [
        { id: '1', content: 'TypeScript generics', score: 0.95 },
        { id: '2', content: 'Generic constraints', score: 0.82 },
      ];

      const bridge = new ICMBridge();
      const caller = createMockCaller({ toolResults: { search_memory: mockResults } });
      await bridge.initialize(caller);

      const results = await bridge.searchMemory('TypeScript generics');

      expect(results).toEqual(mockResults);
      expect(caller.callTool).toHaveBeenCalledWith('icm', 'search_memory', {
        query: 'TypeScript generics',
        limit: 10,
        threshold: undefined,
        tags: undefined,
      });
    });

    it('should handle wrapped response format', async () => {
      const mockResults = [{ id: '1', content: 'test' }];

      const bridge = new ICMBridge();
      const caller = createMockCaller({ toolResults: { search_memory: { memories: mockResults } } });
      await bridge.initialize(caller);

      const results = await bridge.searchMemory('test');

      expect(results).toEqual(mockResults);
    });

    it('should pass search options', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller();
      await bridge.initialize(caller);

      await bridge.searchMemory('query', { limit: 5, threshold: 0.8, tags: ['code'] });

      expect(caller.callTool).toHaveBeenCalledWith('icm', 'search_memory', {
        query: 'query',
        limit: 5,
        threshold: 0.8,
        tags: ['code'],
      });
    });

    it('should return empty array when unavailable', async () => {
      const bridge = new ICMBridge();

      const results = await bridge.searchMemory('test');

      expect(results).toEqual([]);
    });

    it('should return empty array on error', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller();
      (caller.callTool as jest.Mock).mockRejectedValueOnce(new Error('search failed'));
      await bridge.initialize(caller);

      const results = await bridge.searchMemory('test');

      expect(results).toEqual([]);
    });
  });

  describe('getRecentContext', () => {
    it('should return recent memories', async () => {
      const mockResults = [{ id: '1', content: 'recent memory' }];

      const bridge = new ICMBridge();
      const caller = createMockCaller({ toolResults: { get_recent_memories: mockResults } });
      await bridge.initialize(caller);

      const results = await bridge.getRecentContext(5);

      expect(results).toEqual(mockResults);
      expect(caller.callTool).toHaveBeenCalledWith('icm', 'get_recent_memories', { limit: 5 });
    });

    it('should use default limit of 10', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller();
      await bridge.initialize(caller);

      await bridge.getRecentContext();

      expect(caller.callTool).toHaveBeenCalledWith('icm', 'get_recent_memories', { limit: 10 });
    });

    it('should return empty array when unavailable', async () => {
      const bridge = new ICMBridge();

      const results = await bridge.getRecentContext();

      expect(results).toEqual([]);
    });

    it('should return empty array on error', async () => {
      const bridge = new ICMBridge();
      const caller = createMockCaller();
      (caller.callTool as jest.Mock).mockRejectedValueOnce(new Error('fetch failed'));
      await bridge.initialize(caller);

      const results = await bridge.getRecentContext();

      expect(results).toEqual([]);
    });
  });
});
