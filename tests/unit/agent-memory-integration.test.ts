/**
 * Unit Tests for Agent Memory Integration
 *
 * Tests the memory system methods integrated into CodeBuddyAgent.
 */

import { EventEmitter } from 'events';

// Mock the memory module before importing agent
jest.mock('../../src/memory/index.js', () => {
  const mockMemory = {
    store: jest.fn().mockResolvedValue({
      id: 'test-memory-id',
      type: 'fact',
      content: 'Test content',
      importance: 0.8,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 0,
      tags: [],
      metadata: {},
    }),
    recall: jest.fn().mockResolvedValue([
      {
        id: 'recalled-1',
        type: 'fact',
        content: 'Recalled content',
        importance: 0.9,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
        accessCount: 1,
        tags: ['test'],
        metadata: {},
      },
    ]),
    buildContext: jest.fn().mockResolvedValue('Mock memory context'),
    storeSummary: jest.fn().mockResolvedValue({
      id: 'summary-1',
      sessionId: 'test-session',
      summary: 'Test summary',
      topics: ['test'],
      createdAt: new Date(),
    }),
    setProjectContext: jest.fn().mockResolvedValue({
      projectId: 'proj-1',
      projectPath: '/test/project',
      name: 'project',
    }),
    getStats: jest.fn().mockReturnValue({
      totalMemories: 10,
      byType: { fact: 5, decision: 3, preference: 2 },
      projects: 1,
      summaries: 2,
    }),
    formatStatus: jest.fn().mockReturnValue('Memory Status: 10 memories'),
    dispose: jest.fn(),
  };

  return {
    EnhancedMemory: jest.fn().mockImplementation(() => mockMemory),
    getEnhancedMemory: jest.fn().mockReturnValue(mockMemory),
    resetEnhancedMemory: jest.fn(),
  };
});

// Mock other dependencies
jest.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    stream: jest.fn(),
    getCurrentModel: jest.fn().mockReturnValue('test-model'),
    dispose: jest.fn(),
  })),
}));

jest.mock('../../src/tools/index.js', () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    view: jest.fn().mockResolvedValue({ success: true, output: '' }),
    create: jest.fn().mockResolvedValue({ success: true }),
    strReplace: jest.fn().mockResolvedValue({ success: true }),
  })),
  BashTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: '' }),
    getCurrentDirectory: jest.fn().mockReturnValue('/test'),
  })),
  TodoTool: jest.fn().mockImplementation(() => ({})),
  SearchTool: jest.fn().mockImplementation(() => ({})),
  WebSearchTool: jest.fn().mockImplementation(() => ({})),
  ImageTool: jest.fn().mockImplementation(() => ({})),
  MorphEditorTool: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../src/codebuddy/tools.js', () => ({
  getAllCodeBuddyTools: jest.fn().mockReturnValue([]),
  getRelevantTools: jest.fn().mockResolvedValue({ tools: [], reasoning: '' }),
  getMCPManager: jest.fn().mockReturnValue({ callTool: jest.fn() }),
  initializeMCPServers: jest.fn().mockResolvedValue(undefined),
  classifyQuery: jest.fn().mockReturnValue({ category: 'general', confidence: 1 }),
  getToolSelector: jest.fn().mockReturnValue({ selectTools: jest.fn() }),
}));

jest.mock('../../src/utils/token-counter.js', () => ({
  createTokenCounter: jest.fn().mockReturnValue({
    countTokens: jest.fn().mockReturnValue(100),
    dispose: jest.fn(),
  }),
}));

jest.mock('../../src/checkpoints/checkpoint-manager.js', () => ({
  getCheckpointManager: jest.fn().mockReturnValue({
    createCheckpoint: jest.fn(),
    restore: jest.fn(),
  }),
}));

jest.mock('../../src/persistence/session-store.js', () => ({
  getSessionStore: jest.fn().mockReturnValue({
    save: jest.fn(),
    load: jest.fn(),
    getCurrentSessionId: jest.fn().mockReturnValue('test-session-123'),
  }),
}));

jest.mock('../../src/agent/agent-mode.js', () => ({
  getAgentModeManager: jest.fn().mockReturnValue({
    getCurrentMode: jest.fn().mockReturnValue('code'),
    setMode: jest.fn(),
  }),
}));

jest.mock('../../src/security/sandbox.js', () => ({
  getSandboxManager: jest.fn().mockReturnValue({
    isEnabled: jest.fn().mockReturnValue(false),
  }),
}));

jest.mock('../../src/mcp/mcp-client.js', () => ({
  getMCPClient: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: jest.fn().mockReturnValue({
    get: jest.fn(),
    set: jest.fn(),
    getCurrentModel: jest.fn().mockReturnValue(null),
    setCurrentModel: jest.fn(),
  }),
}));

jest.mock('../../src/prompts/index.js', () => ({
  getSystemPromptForMode: jest.fn().mockReturnValue('test prompt'),
  getChatOnlySystemPrompt: jest.fn().mockReturnValue('test prompt'),
  getPromptManager: jest.fn().mockReturnValue({ loadPrompt: jest.fn() }),
  autoSelectPromptId: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/utils/cost-tracker.js', () => ({
  getCostTracker: jest.fn().mockReturnValue({
    trackUsage: jest.fn(),
    getTotalCost: jest.fn().mockReturnValue(0),
  }),
}));

jest.mock('../../src/utils/autonomy-manager.js', () => ({
  getAutonomyManager: jest.fn().mockReturnValue({
    isAutonomous: jest.fn().mockReturnValue(false),
    isYOLOEnabled: jest.fn().mockReturnValue(false),
    enableYOLO: jest.fn(),
    disableYOLO: jest.fn(),
  }),
}));

jest.mock('../../src/context/context-manager-v2.js', () => ({
  createContextManager: jest.fn().mockReturnValue({
    prepare: jest.fn().mockReturnValue([]),
    getStats: jest.fn().mockReturnValue({ tokenCount: 0 }),
    dispose: jest.fn(),
  }),
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/optimization/prompt-cache.js', () => ({
  getPromptCacheManager: jest.fn().mockReturnValue({
    get: jest.fn(),
    set: jest.fn(),
    cacheSystemPrompt: jest.fn(),
  }),
}));

jest.mock('../../src/hooks/lifecycle-hooks.js', () => ({
  getHooksManager: jest.fn().mockReturnValue({
    executeHooks: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../../src/optimization/model-routing.js', () => ({
  getModelRouter: jest.fn().mockReturnValue({
    route: jest.fn().mockReturnValue({ model: 'test-model' }),
    getTotalCost: jest.fn().mockReturnValue(0),
    getEstimatedSavings: jest.fn().mockReturnValue({ saved: 0, percentage: 0 }),
    getUsageStats: jest.fn().mockReturnValue(new Map()),
  }),
}));

jest.mock('../../src/mcp/config.js', () => ({
  loadMCPConfig: jest.fn().mockReturnValue({ servers: [] }),
}));

jest.mock('../../src/utils/custom-instructions.js', () => ({
  loadCustomInstructions: jest.fn().mockReturnValue(''),
}));

jest.mock('../../src/tools/tool-selector.js', () => ({
  recordToolRequest: jest.fn(),
  formatToolSelectionMetrics: jest.fn().mockReturnValue(''),
}));

jest.mock('../../src/agent/repair/index.js', () => ({
  RepairEngine: jest.fn().mockImplementation(() => ({
    repair: jest.fn().mockResolvedValue([]),
    setExecutors: jest.fn(),
    dispose: jest.fn(),
  })),
  getRepairEngine: jest.fn().mockImplementation(() => ({
    repair: jest.fn().mockResolvedValue([]),
    setExecutors: jest.fn(),
    dispose: jest.fn(),
  })),
}));

describe('Agent Memory Integration', () => {
  let CodeBuddyAgent: any;
  let agent: any;
  let mockMemory: any;

  beforeAll(async () => {
    // Import after mocks are set up
    const module = await import('../../src/agent/codebuddy-agent.js');
    CodeBuddyAgent = module.CodeBuddyAgent;
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Get reference to mock memory
    const { getEnhancedMemory } = require('../../src/memory/index.js');
    mockMemory = getEnhancedMemory();

    // Create agent instance
    agent = new CodeBuddyAgent('test-api-key');
  });

  afterEach(() => {
    if (agent?.dispose) {
      agent.dispose();
    }
  });

  describe('Memory Enable/Disable', () => {
    it('should have memory enabled by default', () => {
      expect(agent.isMemoryEnabled()).toBe(true);
    });

    it('should allow disabling memory', () => {
      agent.setMemoryEnabled(false);
      expect(agent.isMemoryEnabled()).toBe(false);
    });

    it('should allow re-enabling memory', () => {
      agent.setMemoryEnabled(false);
      agent.setMemoryEnabled(true);
      expect(agent.isMemoryEnabled()).toBe(true);
    });

    it('should dispose memory when disabled', async () => {
      // Trigger memory initialization by accessing it
      await agent.recall();

      agent.setMemoryEnabled(false);

      expect(mockMemory.dispose).toHaveBeenCalled();
    });
  });

  describe('Remember Operation', () => {
    it('should store a memory with type and content', async () => {
      const entry = await agent.remember('fact', 'The project uses TypeScript');

      expect(mockMemory.store).toHaveBeenCalledWith({
        type: 'fact',
        content: 'The project uses TypeScript',
      });
      expect(entry.id).toBe('test-memory-id');
    });

    it('should store memory with all options', async () => {
      await agent.remember('decision', 'Use React', {
        summary: 'Frontend choice',
        importance: 0.95,
        tags: ['architecture'],
        metadata: { reason: 'team familiarity' },
      });

      expect(mockMemory.store).toHaveBeenCalledWith({
        type: 'decision',
        content: 'Use React',
        summary: 'Frontend choice',
        importance: 0.95,
        tags: ['architecture'],
        metadata: { reason: 'team familiarity' },
      });
    });

    it('should throw when memory is disabled', async () => {
      agent.setMemoryEnabled(false);

      await expect(agent.remember('fact', 'Test'))
        .rejects.toThrow('Memory system is disabled');
    });
  });

  describe('Recall Operation', () => {
    it('should recall memories without query', async () => {
      const memories = await agent.recall();

      expect(mockMemory.recall).toHaveBeenCalledWith({
        query: undefined,
      });
      expect(memories).toHaveLength(1);
    });

    it('should recall memories with query', async () => {
      await agent.recall('TypeScript');

      expect(mockMemory.recall).toHaveBeenCalledWith({
        query: 'TypeScript',
      });
    });

    it('should recall memories with filters', async () => {
      await agent.recall('architecture', {
        types: ['decision', 'fact'],
        tags: ['important'],
        limit: 10,
        minImportance: 0.7,
      });

      expect(mockMemory.recall).toHaveBeenCalledWith({
        query: 'architecture',
        types: ['decision', 'fact'],
        tags: ['important'],
        limit: 10,
        minImportance: 0.7,
      });
    });

    it('should return empty array when memory is disabled', async () => {
      agent.setMemoryEnabled(false);

      const memories = await agent.recall('test');

      expect(memories).toEqual([]);
    });
  });

  describe('Memory Context', () => {
    it('should build memory context without query', async () => {
      const context = await agent.getMemoryContext();

      expect(mockMemory.buildContext).toHaveBeenCalledWith({
        query: undefined,
        includePreferences: true,
        includeProject: true,
        includeRecentSummaries: true,
      });
      expect(context).toBe('Mock memory context');
    });

    it('should build memory context with query', async () => {
      await agent.getMemoryContext('React patterns');

      expect(mockMemory.buildContext).toHaveBeenCalledWith({
        query: 'React patterns',
        includePreferences: true,
        includeProject: true,
        includeRecentSummaries: true,
      });
    });

    it('should return empty string when memory is disabled', async () => {
      agent.setMemoryEnabled(false);

      const context = await agent.getMemoryContext();

      expect(context).toBe('');
    });
  });

  describe('Conversation Summary', () => {
    it('should store conversation summary', async () => {
      await agent.storeConversationSummary(
        'Discussed project architecture',
        ['architecture', 'design']
      );

      expect(mockMemory.storeSummary).toHaveBeenCalledWith({
        sessionId: 'test-session-123',
        summary: 'Discussed project architecture',
        topics: ['architecture', 'design'],
        decisions: undefined,
        messageCount: expect.any(Number),
      });
    });

    it('should store summary with decisions', async () => {
      await agent.storeConversationSummary(
        'Planning session',
        ['planning'],
        ['Use React', 'Use TypeScript']
      );

      expect(mockMemory.storeSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          decisions: ['Use React', 'Use TypeScript'],
        })
      );
    });

    it('should skip when memory is disabled', async () => {
      agent.setMemoryEnabled(false);

      await agent.storeConversationSummary('Test', ['test']);

      expect(mockMemory.storeSummary).not.toHaveBeenCalled();
    });
  });

  describe('Memory Stats', () => {
    it('should return memory stats after initialization', async () => {
      // Trigger memory initialization by calling a method that accesses it
      await agent.recall();

      const stats = agent.getMemoryStats();

      expect(stats).toEqual({
        totalMemories: 10,
        byType: { fact: 5, decision: 3, preference: 2 },
        projects: 1,
        summaries: 2,
      });
    });

    it('should return memory stats (initialized on startup)', async () => {
      // Memory is now initialized on startup for system prompt injection
      const stats = agent.getMemoryStats();

      expect(stats).toEqual({
        totalMemories: 10,
        byType: { fact: 5, decision: 3, preference: 2 },
        projects: 1,
        summaries: 2,
      });
    });

    it('should return null when memory is disabled', () => {
      agent.setMemoryEnabled(false);

      const stats = agent.getMemoryStats();

      expect(stats).toBeNull();
    });
  });

  describe('Memory Status Formatting', () => {
    it('should format memory status after initialization', async () => {
      // Trigger memory initialization
      await agent.recall();

      const status = agent.formatMemoryStatus();

      expect(mockMemory.formatStatus).toHaveBeenCalled();
      expect(status).toBe('Memory Status: 10 memories');
    });

    it('should show initialized status by default', () => {
      // Memory is initialized on startup
      const status = agent.formatMemoryStatus();

      expect(mockMemory.formatStatus).toHaveBeenCalled();
      expect(status).toBe('Memory Status: 10 memories');
    });

    it('should show disabled status', () => {
      agent.setMemoryEnabled(false);

      const status = agent.formatMemoryStatus();

      expect(status).toContain('Disabled');
    });
  });

  describe('Dispose', () => {
    it('should dispose memory on agent dispose', async () => {
      // Trigger memory initialization
      await agent.recall();

      agent.dispose();

      expect(mockMemory.dispose).toHaveBeenCalled();
    });

    it('should handle dispose when memory not initialized', () => {
      // Don't trigger initialization
      expect(() => agent.dispose()).not.toThrow();
    });
  });
});
