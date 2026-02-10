/**
 * Comprehensive Unit Tests for Command Handlers
 *
 * Tests cover:
 * - Memory Handlers (handleMemory, handleRemember, handleScanTodos, handleAddressTodo)
 * - Stats Handlers (handleCost, handleStats, handleCache, handleSelfHealing)
 * - Context Handlers (handleAddContext, handleContext, handleWorkspace)
 * - Session Handlers (handleSessions)
 * - Security Handlers (handleSecurity, handleDryRun, handleGuardian)
 * - Export Handlers (handleExport, handleExportList, handleExportFormats)
 * - Test Handlers (handleGenerateTests, handleAITest)
 * - Vibe Handlers (handleReload, handleLog, handleCompact, handleTools, handleVimMode)
 */

// Type imports for documentation - used in handler return types
import type { ChatEntry as _ChatEntry } from '../../src/agent/codebuddy-agent';
import type { CommandHandlerResult as _CommandHandlerResult } from '../../src/commands/handlers/branch-handlers';

// ============================================================================
// MOCKS
// ============================================================================

// Mock memory manager (legacy - may be used by old tests)
const mockMemoryManager = {
  initialize: jest.fn(),
  recall: jest.fn(),
  forget: jest.fn(),
  remember: jest.fn(),
  formatMemories: jest.fn(),
};

jest.mock('../../src/memory/persistent-memory', () => ({
  getMemoryManager: jest.fn(() => mockMemoryManager),
}));

// Mock EnhancedMemory (new memory system used by handlers)
const mockEnhancedMemory = {
  store: jest.fn().mockResolvedValue({ id: 'test-id' }),
  recall: jest.fn().mockResolvedValue([]),
  forget: jest.fn().mockResolvedValue(undefined),
  buildContext: jest.fn().mockResolvedValue('Mock context'),
  formatStatus: jest.fn().mockReturnValue('Memory Status: OK'),
  dispose: jest.fn(),
};

jest.mock('../../src/memory/index.js', () => ({
  getEnhancedMemory: jest.fn(() => mockEnhancedMemory),
}));

// Mock comment watcher
const mockCommentWatcher = {
  scanProject: jest.fn(),
  formatComments: jest.fn(),
  getDetectedComments: jest.fn(),
  generatePromptForComment: jest.fn(),
};

jest.mock('../../src/tools/comment-watcher', () => ({
  getCommentWatcher: jest.fn(() => mockCommentWatcher),
}));

// Mock cost tracker
const mockCostTracker = {
  setBudgetLimit: jest.fn(),
  setDailyLimit: jest.fn(),
  getReport: jest.fn(),
  resetSession: jest.fn(),
  formatDashboard: jest.fn(),
};

jest.mock('../../src/utils/cost-tracker', () => ({
  getCostTracker: jest.fn(() => mockCostTracker),
}));

// Mock performance manager
const mockToolCache = {
  getStats: jest.fn(),
};

const mockRequestOptimizer = {
  getStats: jest.fn(),
};

const mockPerformanceManager = {
  getToolCache: jest.fn(() => mockToolCache),
  getRequestOptimizer: jest.fn(() => mockRequestOptimizer),
  resetStats: jest.fn(),
  getSummary: jest.fn(),
};

jest.mock('../../src/performance/index', () => ({
  getPerformanceManager: jest.fn(() => mockPerformanceManager),
}));

// Mock response cache
const mockResponseCache = {
  clear: jest.fn(),
  getStats: jest.fn(),
  formatStatus: jest.fn(),
};

jest.mock('../../src/utils/response-cache', () => ({
  getResponseCache: jest.fn(() => mockResponseCache),
}));

// Mock self-healing engine
const mockSelfHealingEngine = {
  updateOptions: jest.fn(),
  getOptions: jest.fn(),
  getStats: jest.fn(),
};

jest.mock('../../src/utils/self-healing', () => ({
  getSelfHealingEngine: jest.fn(() => mockSelfHealingEngine),
}));

// Mock context loader
const mockContextLoader = {
  loadFiles: jest.fn(),
  getSummary: jest.fn(),
};

jest.mock('../../src/context/context-loader', () => ({
  getContextLoader: jest.fn(() => mockContextLoader),
  ContextLoader: {
    parsePatternString: jest.fn((pattern: string) => ({
      include: [pattern],
      exclude: [],
    })),
  },
}));

// Mock workspace detector
const mockWorkspaceDetector = {
  detect: jest.fn(),
  formatDetectionResults: jest.fn(),
};

jest.mock('../../src/utils/workspace-detector', () => ({
  getWorkspaceDetector: jest.fn(() => mockWorkspaceDetector),
}));

// Mock interaction logger
const mockInteractionLogger = {
  listSessions: jest.fn(),
  loadSession: jest.fn(),
  deleteSession: jest.fn(),
  getLatestSession: jest.fn(),
  searchSessions: jest.fn(),
  formatSession: jest.fn(),
};

jest.mock('../../src/logging/interaction-logger', () => ({
  InteractionLogger: mockInteractionLogger,
}));

// Mock security manager
const mockSecurityManager = {
  updateConfig: jest.fn(),
  resetStats: jest.fn(),
  getEvents: jest.fn(),
  formatDashboard: jest.fn(),
};

jest.mock('../../src/security/index', () => ({
  getSecurityManager: jest.fn(() => mockSecurityManager),
  ApprovalMode: {
    READ_ONLY: 'read-only',
    AUTO: 'auto',
    FULL_ACCESS: 'full-access',
  },
}));

// Mock confirmation service
const mockConfirmationService = {
  setDryRunMode: jest.fn(),
  getDryRunLog: jest.fn(),
  isDryRunMode: jest.fn(),
  formatDryRunLog: jest.fn(),
};

jest.mock('../../src/utils/confirmation-service', () => ({
  ConfirmationService: {
    getInstance: jest.fn(() => mockConfirmationService),
  },
}));

// Mock code guardian agent
const mockCodeGuardianAgent = {
  isReady: jest.fn(),
  initialize: jest.fn(),
  setMode: jest.fn(),
  getMode: jest.fn(),
  execute: jest.fn(),
};

jest.mock('../../src/agent/specialized/code-guardian-agent', () => ({
  getCodeGuardianAgent: jest.fn(() => mockCodeGuardianAgent),
  CodeGuardianMode: {
    ANALYZE_ONLY: 'ANALYZE_ONLY',
    SUGGEST_REFACTOR: 'SUGGEST_REFACTOR',
    PATCH_PLAN: 'PATCH_PLAN',
    PATCH_DIFF: 'PATCH_DIFF',
  },
}));

// Mock export manager
const mockExportManager = {
  exportSession: jest.fn(),
  listExports: jest.fn(),
};

jest.mock('../../src/utils/export-manager', () => ({
  getExportManager: jest.fn(() => mockExportManager),
}));

// Mock session repository
const mockSessionRepository = {
  findSessions: jest.fn(),
};

jest.mock('../../src/database/repositories/session-repository', () => ({
  getSessionRepository: jest.fn(() => mockSessionRepository),
}));

// Mock settings manager
const mockSettingsManager = {
  loadUserSettings: jest.fn(),
};

jest.mock('../../src/utils/settings-manager', () => ({
  getSettingsManager: jest.fn(() => mockSettingsManager),
}));

// Mock slash command manager
const mockSlashCommandManager = {
  reload: jest.fn(),
};

jest.mock('../../src/commands/slash-commands', () => ({
  getSlashCommandManager: jest.fn(() => mockSlashCommandManager),
}));

// Mock tool filter
const mockToolFilter = {
  enabledPatterns: [],
  disabledPatterns: [],
};

jest.mock('../../src/utils/tool-filter', () => ({
  getToolFilter: jest.fn(() => mockToolFilter),
  setToolFilter: jest.fn(),
  resetToolFilter: jest.fn(),
  filterTools: jest.fn((tools: unknown[]) => ({
    tools,
    originalCount: tools.length,
    filteredCount: tools.length,
    filtered: [],
  })),
  parsePatterns: jest.fn((pattern: string) => [pattern]),
}));

// Mock tools
jest.mock('../../src/codebuddy/tools', () => ({
  CODEBUDDY_TOOLS: [
    { function: { name: 'read_file' } },
    { function: { name: 'write_file' } },
    { function: { name: 'bash' } },
    { function: { name: 'search_files' } },
  ],
  getAllCodeBuddyTools: jest.fn().mockResolvedValue([
    { function: { name: 'read_file' } },
    { function: { name: 'write_file' } },
    { function: { name: 'bash' } },
    { function: { name: 'search_files' } },
  ]),
}));

// Mock interactive-setup
jest.mock('../../src/utils/interactive-setup', () => ({
  formatLogInfo: jest.fn(() => 'Log file: ~/.codebuddy/logs/session.log'),
}));

// Mock custom agent loader
jest.mock('../../src/agent/custom/custom-agent-loader', () => ({
  resetCustomAgentLoader: jest.fn(),
}));

// ============================================================================
// IMPORTS (after mocks)
// ============================================================================

import {
  handleMemory,
  handleRemember,
  handleScanTodos,
  handleAddressTodo,
} from '../../src/commands/handlers/memory-handlers';

import {
  handleCost,
  handleStats,
  handleCache,
  handleSelfHealing,
} from '../../src/commands/handlers/stats-handlers';

import {
  handleAddContext,
  handleContext,
  handleWorkspace,
} from '../../src/commands/handlers/context-handlers';

import { handleSessions } from '../../src/commands/handlers/session-handlers';

import {
  handleSecurity,
  handleDryRun,
  handleGuardian,
} from '../../src/commands/handlers/security-handlers';

import {
  handleExport,
  handleExportList,
  handleExportFormats,
} from '../../src/commands/handlers/export-handlers';

import { handleGenerateTests } from '../../src/commands/handlers/test-handlers';

import {
  handleReload,
  handleLog,
  handleCompact,
  handleTools,
  handleVimMode,
} from '../../src/commands/handlers/vibe-handlers';

// ============================================================================
// MEMORY HANDLERS TESTS
// ============================================================================

describe('Memory Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMemoryManager.formatMemories.mockReturnValue('No memories stored');
    mockMemoryManager.recall.mockReturnValue(null);
    mockMemoryManager.initialize.mockResolvedValue(undefined);
    mockMemoryManager.remember.mockResolvedValue(undefined);
    mockMemoryManager.forget.mockResolvedValue(undefined);
  });

  describe('handleMemory', () => {
    test('should list memories by default', async () => {
      mockEnhancedMemory.formatStatus.mockReturnValue('Memory Status: 5 memories');

      const result = await handleMemory([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.type).toBe('assistant');
      expect(result.entry?.content).toBe('Memory Status: 5 memories');
      expect(mockEnhancedMemory.formatStatus).toHaveBeenCalled();
    });

    test('should list memories with "list" action', async () => {
      const result = await handleMemory(['list']);

      expect(result.handled).toBe(true);
      expect(mockEnhancedMemory.formatStatus).toHaveBeenCalled();
    });

    test('should recall memories matching query', async () => {
      mockEnhancedMemory.recall.mockResolvedValueOnce([
        { id: '1', type: 'fact', content: 'stored-value', importance: 0.8, createdAt: new Date() },
      ]);

      const result = await handleMemory(['recall', 'mykey']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Recall Results');
      expect(result.entry?.content).toContain('stored-value');
    });

    test('should show message when no memories found', async () => {
      mockEnhancedMemory.recall.mockResolvedValueOnce([]);

      const result = await handleMemory(['recall', 'nonexistent']);

      expect(result.entry?.content).toContain('No matching memories found');
    });

    test('should show usage when recall has no key', async () => {
      const result = await handleMemory(['recall']);

      expect(result.entry?.content).toBe('Usage: /memory recall <query>');
    });

    test('should forget a memory', async () => {
      // Mock finding memories with the tag
      mockEnhancedMemory.recall.mockResolvedValueOnce([{ id: 'mem-1', type: 'fact', content: 'test', importance: 0.8, createdAt: new Date() }]);

      const result = await handleMemory(['forget', 'mykey']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Forgot');
      expect(result.entry?.content).toContain('mykey');
      expect(mockEnhancedMemory.recall).toHaveBeenCalledWith({ tags: ['mykey'] });
    });

    test('should show usage when forget has no key', async () => {
      const result = await handleMemory(['forget']);

      expect(result.entry?.content).toContain('Usage: /memory forget');
      expect(result.entry?.content).toContain('forget last');
    });

    test('should have timestamp in entry', async () => {
      const result = await handleMemory([]);

      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('handleRemember', () => {
    test('should store a memory', async () => {
      const result = await handleRemember(['apiKey', 'secret123']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Remembered:');
      expect(result.entry?.content).toContain('secret123');
      expect(result.entry?.content).toContain('apiKey');
      expect(mockEnhancedMemory.store).toHaveBeenCalledWith({
        type: 'fact',
        content: 'secret123',
        tags: ['apiKey'],
        importance: 0.8,
      });
    });

    test('should join multiple value words', async () => {
      const result = await handleRemember(['note', 'this', 'is', 'a', 'note']);

      expect(mockEnhancedMemory.store).toHaveBeenCalledWith({
        type: 'fact',
        content: 'this is a note',
        tags: ['note'],
        importance: 0.8,
      });
      expect(result.entry?.content).toContain('this is a note');
    });

    test('should show usage when no key provided', async () => {
      const result = await handleRemember([]);

      expect(result.entry?.content).toBe('Usage: /remember <key> <value>');
    });

    test('should show usage when no value provided', async () => {
      const result = await handleRemember(['key']);

      expect(result.entry?.content).toBe('Usage: /remember <key> <value>');
    });

    test('should store via EnhancedMemory', async () => {
      await handleRemember(['key', 'value']);

      expect(mockEnhancedMemory.store).toHaveBeenCalled();
    });
  });

  describe('handleScanTodos', () => {
    test('should scan and format todos', async () => {
      mockCommentWatcher.scanProject.mockResolvedValue(undefined);
      mockCommentWatcher.formatComments.mockReturnValue('Found 3 TODO comments');

      const result = await handleScanTodos();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBe('Found 3 TODO comments');
      expect(mockCommentWatcher.scanProject).toHaveBeenCalled();
    });

    test('should return proper entry structure', async () => {
      mockCommentWatcher.formatComments.mockReturnValue('No TODOs');

      const result = await handleScanTodos();

      expect(result.entry?.type).toBe('assistant');
      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('handleAddressTodo', () => {
    const sampleComments = [
      { file: 'src/test.ts', line: 10, text: 'Fix this bug' },
      { file: 'src/utils.ts', line: 20, text: 'Refactor this function' },
    ];

    beforeEach(() => {
      mockCommentWatcher.getDetectedComments.mockReturnValue(sampleComments);
      mockCommentWatcher.generatePromptForComment.mockReturnValue('Generated prompt');
    });

    test('should show usage when no index provided', async () => {
      const result = await handleAddressTodo([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Usage: /address-todo <index>');
      expect(result.entry?.content).toContain('/scan-todos');
    });

    test('should show error for invalid index', async () => {
      const result = await handleAddressTodo(['invalid']);

      expect(result.entry?.content).toContain('Usage: /address-todo <index>');
    });

    test('should show error for out-of-range index', async () => {
      const result = await handleAddressTodo(['0']);

      expect(result.entry?.content).toContain('Invalid index');
    });

    test('should show error for index too high', async () => {
      const result = await handleAddressTodo(['5']);

      expect(result.entry?.content).toContain('Invalid index');
      expect(result.entry?.content).toContain('1-2');
    });

    test('should generate prompt for valid todo', async () => {
      mockCommentWatcher.generatePromptForComment.mockReturnValue('Fix the bug in test.ts');

      const result = await handleAddressTodo(['1']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toBe('Fix the bug in test.ts');
      expect(mockCommentWatcher.generatePromptForComment).toHaveBeenCalledWith(sampleComments[0]);
    });

    test('should use 1-based indexing', async () => {
      await handleAddressTodo(['2']);

      expect(mockCommentWatcher.generatePromptForComment).toHaveBeenCalledWith(sampleComments[1]);
    });
  });
});

// ============================================================================
// STATS HANDLERS TESTS
// ============================================================================

describe('Stats Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCostTracker.formatDashboard.mockReturnValue('Cost Dashboard');
    mockCostTracker.getReport.mockReturnValue({ total: 0.50 });
    mockToolCache.getStats.mockReturnValue({
      hits: 100,
      misses: 20,
      hitRate: 0.83,
      savedCalls: 50,
      savedTime: 5000,
    });
    mockRequestOptimizer.getStats.mockReturnValue({
      totalRequests: 100,
      successfulRequests: 95,
      failedRequests: 5,
      retriedRequests: 3,
      deduplicatedRequests: 10,
      averageLatency: 250,
      currentConcurrency: 2,
    });
    mockPerformanceManager.getSummary.mockReturnValue({
      lazyLoader: { loadedModules: 5, totalModules: 10, averageLoadTime: 50 },
      toolCache: { hitRate: 0.8, savedCalls: 100 },
      requestOptimizer: { totalRequests: 200, deduplicatedRequests: 20 },
      apiCache: { entries: 50, hitRate: 0.7 },
      overall: { totalOperations: 500, cacheHitRate: 0.75, estimatedTimeSaved: 10000 },
    });
  });

  describe('handleCost', () => {
    test('should show cost dashboard by default', () => {
      const result = handleCost([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBe('Cost Dashboard');
      expect(mockCostTracker.formatDashboard).toHaveBeenCalled();
    });

    test('should show cost dashboard with "status" action', () => {
      handleCost(['status']);

      expect(mockCostTracker.formatDashboard).toHaveBeenCalled();
    });

    test('should set budget limit', () => {
      const result = handleCost(['budget', '25.50']);

      expect(result.entry?.content).toContain('budget set to $25.50');
      expect(mockCostTracker.setBudgetLimit).toHaveBeenCalledWith(25.50);
    });

    test('should show usage when budget has no amount', () => {
      const result = handleCost(['budget']);

      expect(result.entry?.content).toBe('Usage: /cost budget <amount>');
    });

    test('should set daily limit', () => {
      const result = handleCost(['daily', '10']);

      expect(result.entry?.content).toContain('Daily limit set to $10.00');
      expect(mockCostTracker.setDailyLimit).toHaveBeenCalledWith(10);
    });

    test('should show usage when daily has no amount', () => {
      const result = handleCost(['daily']);

      expect(result.entry?.content).toBe('Usage: /cost daily <amount>');
    });

    test('should export cost report', () => {
      mockCostTracker.getReport.mockReturnValue({ total: 1.23, sessions: 5 });

      const result = handleCost(['export']);

      expect(result.entry?.content).toContain('Cost Report');
      expect(result.entry?.content).toContain('1.23');
    });

    test('should reset cost tracking', () => {
      const result = handleCost(['reset']);

      expect(result.entry?.content).toContain('Cost tracking reset');
      expect(mockCostTracker.resetSession).toHaveBeenCalled();
    });
  });

  describe('handleStats', () => {
    test('should show summary by default', () => {
      const result = handleStats([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Performance Summary');
      expect(mockPerformanceManager.getSummary).toHaveBeenCalled();
    });

    test('should show summary with "summary" action', () => {
      const result = handleStats(['summary']);

      expect(result.entry?.content).toContain('Performance Summary');
      expect(result.entry?.content).toContain('Lazy Loader');
      expect(result.entry?.content).toContain('Tool Cache');
      expect(result.entry?.content).toContain('Requests');
    });

    test('should show cache statistics', () => {
      const result = handleStats(['cache']);

      expect(result.entry?.content).toContain('Tool Cache Statistics');
      expect(result.entry?.content).toContain('Hits: 100');
      expect(result.entry?.content).toContain('Misses: 20');
      expect(result.entry?.content).toContain('Hit Rate: 83.0%');
    });

    test('should handle missing tool cache', () => {
      mockPerformanceManager.getToolCache.mockReturnValue(null as unknown as typeof mockToolCache);

      const result = handleStats(['cache']);

      expect(result.entry?.content).toContain('Tool cache not initialized');
    });

    test('should show request statistics', () => {
      const result = handleStats(['requests']);

      expect(result.entry?.content).toContain('Request Optimizer Statistics');
      expect(result.entry?.content).toContain('Total Requests: 100');
      expect(result.entry?.content).toContain('Successful: 95');
      expect(result.entry?.content).toContain('Average Latency: 250ms');
    });

    test('should handle missing request optimizer', () => {
      mockPerformanceManager.getRequestOptimizer.mockReturnValue(null as unknown as typeof mockRequestOptimizer);

      const result = handleStats(['requests']);

      expect(result.entry?.content).toContain('Request optimizer not initialized');
    });

    test('should reset statistics', () => {
      const result = handleStats(['reset']);

      expect(result.entry?.content).toContain('Performance statistics reset');
      expect(mockPerformanceManager.resetStats).toHaveBeenCalled();
    });
  });

  describe('handleCache', () => {
    beforeEach(() => {
      mockResponseCache.formatStatus.mockReturnValue('Cache is enabled');
      mockResponseCache.getStats.mockReturnValue({
        totalEntries: 100,
        cacheSize: '2.5 MB',
        totalHits: 500,
        totalMisses: 50,
        oldestEntry: new Date('2025-01-01'),
        newestEntry: new Date('2025-01-15'),
      });
    });

    test('should show cache status by default', () => {
      const result = handleCache([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBe('Cache is enabled');
      expect(mockResponseCache.formatStatus).toHaveBeenCalled();
    });

    test('should show cache status with "status" action', () => {
      handleCache(['status']);

      expect(mockResponseCache.formatStatus).toHaveBeenCalled();
    });

    test('should clear cache', () => {
      const result = handleCache(['clear']);

      expect(result.entry?.content).toContain('Cache cleared');
      expect(mockResponseCache.clear).toHaveBeenCalled();
    });

    test('should show cache stats', () => {
      const result = handleCache(['stats']);

      expect(result.entry?.content).toContain('Cache Statistics');
      expect(result.entry?.content).toContain('Entries: 100');
      expect(result.entry?.content).toContain('Size: 2.5 MB');
      expect(result.entry?.content).toContain('Hits: 500');
      expect(result.entry?.content).toContain('Misses: 50');
    });

    test('should calculate hit rate correctly', () => {
      const result = handleCache(['stats']);

      // 500 hits / (500 + 50) = 90.9%
      expect(result.entry?.content).toContain('Hit Rate: 90.9%');
    });
  });

  describe('handleSelfHealing', () => {
    beforeEach(() => {
      mockSelfHealingEngine.getOptions.mockReturnValue({
        enabled: true,
        maxRetries: 3,
        autoFix: true,
        verbose: false,
      });
      mockSelfHealingEngine.getStats.mockReturnValue({
        totalAttempts: 10,
        successfulHeals: 8,
        failedHeals: 2,
        successRate: '80%',
      });
    });

    test('should show status by default', () => {
      const result = handleSelfHealing([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Self-Healing Status');
      expect(result.entry?.content).toMatch(/Enabled:.*Yes/);
      expect(result.entry?.content).toContain('Max Retries: 3');
    });

    test('should enable self-healing', () => {
      const result = handleSelfHealing(['on']);

      expect(result.entry?.content).toContain('Self-Healing: ENABLED');
      expect(mockSelfHealingEngine.updateOptions).toHaveBeenCalledWith({ enabled: true });
    });

    test('should disable self-healing', () => {
      const result = handleSelfHealing(['off']);

      expect(result.entry?.content).toContain('Self-Healing: DISABLED');
      expect(mockSelfHealingEngine.updateOptions).toHaveBeenCalledWith({ enabled: false });
    });

    test('should show stats', () => {
      const result = handleSelfHealing(['stats']);

      expect(result.entry?.content).toContain('Self-Healing Statistics');
      expect(result.entry?.content).toContain('Total Attempts: 10');
      expect(result.entry?.content).toContain('Successful: 8');
      expect(result.entry?.content).toContain('Success Rate: 80%');
    });
  });
});

// ============================================================================
// CONTEXT HANDLERS TESTS
// ============================================================================

describe('Context Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContextLoader.loadFiles.mockResolvedValue([]);
    mockContextLoader.getSummary.mockReturnValue('Context summary');
    mockWorkspaceDetector.formatDetectionResults.mockReturnValue('Workspace detected');
  });

  describe('handleAddContext', () => {
    test('should show usage when no pattern provided', async () => {
      const result = await handleAddContext([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Add Files to Context');
      expect(result.entry?.content).toContain('Usage: /add <pattern>');
    });

    test('should load files matching pattern', async () => {
      mockContextLoader.loadFiles.mockResolvedValue([
        { relativePath: 'src/index.ts', language: 'typescript' },
        { relativePath: 'src/utils.ts', language: 'typescript' },
      ]);
      mockContextLoader.getSummary.mockReturnValue('2 TypeScript files loaded');

      const result = await handleAddContext(['src/**/*.ts']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Added 2 file(s) to context');
      expect(result.entry?.content).toContain('src/index.ts');
    });

    test('should show error when no files match', async () => {
      mockContextLoader.loadFiles.mockResolvedValue([]);

      const result = await handleAddContext(['nonexistent/*.xyz']);

      expect(result.entry?.content).toContain('No files matched pattern');
    });

    test('should handle loading errors', async () => {
      mockContextLoader.loadFiles.mockRejectedValue(new Error('Permission denied'));

      const result = await handleAddContext(['protected/*']);

      expect(result.entry?.content).toContain('Error loading files');
      expect(result.entry?.content).toContain('Permission denied');
    });

    test('should truncate long file lists', async () => {
      const manyFiles = Array.from({ length: 15 }, (_, i) => ({
        relativePath: `src/file${i}.ts`,
        language: 'typescript',
      }));
      mockContextLoader.loadFiles.mockResolvedValue(manyFiles);

      const result = await handleAddContext(['src/*.ts']);

      expect(result.entry?.content).toContain('Added 15 file(s)');
      expect(result.entry?.content).toContain('... and 5 more');
    });
  });

  describe('handleContext', () => {
    test('should show summary by default', async () => {
      mockContextLoader.loadFiles.mockResolvedValue([{ relativePath: 'file.ts' }]);
      mockContextLoader.getSummary.mockReturnValue('1 file in context');

      const result = await handleContext([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBe('1 file in context');
    });

    test('should show summary with "summary" action', async () => {
      mockContextLoader.loadFiles.mockResolvedValue([{ relativePath: 'file.ts' }]);
      mockContextLoader.getSummary.mockReturnValue('1 file in context');

      const result = await handleContext(['summary']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBe('1 file in context');
    });

    test('should clear context', async () => {
      const result = await handleContext(['clear']);

      expect(result.entry?.content).toContain('Context cleared');
    });

    test('should list files in context', async () => {
      mockContextLoader.loadFiles.mockResolvedValue([
        { relativePath: 'src/index.ts', language: 'typescript' },
        { relativePath: 'src/utils.ts', language: 'typescript' },
      ]);

      const result = await handleContext(['list']);

      expect(result.entry?.content).toContain('Context Files (2)');
      expect(result.entry?.content).toContain('src/index.ts (typescript)');
    });

    test('should show message when no files in context', async () => {
      mockContextLoader.loadFiles.mockResolvedValue([]);

      const result = await handleContext(['list']);

      expect(result.entry?.content).toContain('No files currently in context');
      expect(result.entry?.content).toContain('/add <pattern>');
    });
  });

  describe('handleWorkspace', () => {
    test('should detect and format workspace', async () => {
      mockWorkspaceDetector.formatDetectionResults.mockReturnValue('Node.js project detected');

      const result = await handleWorkspace();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBe('Node.js project detected');
      expect(mockWorkspaceDetector.detect).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// SESSION HANDLERS TESTS
// ============================================================================

describe('Session Handlers', () => {
  const sampleSession = {
    metadata: {
      short_id: 'abc123',
      started_at: '2025-01-15T10:00:00Z',
      model: 'grok-4-latest',
      turns: 10,
      tool_calls: 5,
      estimated_cost: 0.25,
      duration_ms: 60000,
      cwd: '/home/user/project',
    },
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockInteractionLogger.listSessions.mockReturnValue({ sessions: [], total: 0 });
    mockInteractionLogger.loadSession.mockReturnValue(null);
    mockInteractionLogger.deleteSession.mockReturnValue(false);
    mockInteractionLogger.getLatestSession.mockReturnValue(null);
    mockInteractionLogger.searchSessions.mockReturnValue([]);
    mockInteractionLogger.formatSession.mockReturnValue('Session details');
  });

  describe('handleSessions', () => {
    test('should list sessions by default', () => {
      mockInteractionLogger.listSessions.mockReturnValue({
        sessions: [sampleSession.metadata],
        total: 1,
      });

      const result = handleSessions([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Recent Sessions');
    });

    test('should list sessions with "list" action', () => {
      handleSessions(['list']);

      expect(mockInteractionLogger.listSessions).toHaveBeenCalledWith({ limit: 10 });
    });

    test('should accept custom limit for list', () => {
      handleSessions(['list', '25']);

      expect(mockInteractionLogger.listSessions).toHaveBeenCalledWith({ limit: 25 });
    });

    test('should show empty message when no sessions', () => {
      mockInteractionLogger.listSessions.mockReturnValue({ sessions: [], total: 0 });

      const result = handleSessions(['list']);

      expect(result.entry?.content).toContain('No sessions found');
    });

    test('should show session details with "show" action', () => {
      mockInteractionLogger.loadSession.mockReturnValue(sampleSession);

      const result = handleSessions(['show', 'abc123']);

      expect(result.entry?.content).toBe('Session details');
      expect(mockInteractionLogger.loadSession).toHaveBeenCalledWith('abc123');
    });

    test('should show usage when "show" has no id', () => {
      const result = handleSessions(['show']);

      expect(result.entry?.content).toBe('Usage: /sessions show <session-id>');
    });

    test('should show error for non-existent session', () => {
      mockInteractionLogger.loadSession.mockReturnValue(null);

      const result = handleSessions(['show', 'nonexistent']);

      expect(result.entry?.content).toContain('Session not found: nonexistent');
    });

    test('should replay session with "replay" action', () => {
      mockInteractionLogger.loadSession.mockReturnValue(sampleSession);

      const result = handleSessions(['replay', 'abc123']);

      expect(result.entry?.content).toContain('Session Replay');
      expect(result.entry?.content).toContain('abc123');
    });

    test('should show usage when "replay" has no id', () => {
      const result = handleSessions(['replay']);

      expect(result.entry?.content).toBe('Usage: /sessions replay <session-id>');
    });

    test('should delete session with "delete" action', () => {
      mockInteractionLogger.deleteSession.mockReturnValue(true);

      const result = handleSessions(['delete', 'abc123']);

      expect(result.entry?.content).toContain('deleted');
      expect(mockInteractionLogger.deleteSession).toHaveBeenCalledWith('abc123');
    });

    test('should show error when delete fails', () => {
      mockInteractionLogger.deleteSession.mockReturnValue(false);

      const result = handleSessions(['delete', 'nonexistent']);

      expect(result.entry?.content).toContain('Session not found');
    });

    test('should show latest session', () => {
      mockInteractionLogger.getLatestSession.mockReturnValue(sampleSession);

      const result = handleSessions(['latest']);

      expect(result.entry?.content).toBe('Session details');
    });

    test('should show empty message when no latest session', () => {
      mockInteractionLogger.getLatestSession.mockReturnValue(null);

      const result = handleSessions(['latest']);

      expect(result.entry?.content).toBe('No sessions found.');
    });

    test('should search sessions', () => {
      mockInteractionLogger.searchSessions.mockReturnValue([sampleSession]);

      handleSessions(['search', 'abc']);

      expect(mockInteractionLogger.searchSessions).toHaveBeenCalledWith('abc');
    });

    test('should show usage when "search" has no query', () => {
      const result = handleSessions(['search']);

      expect(result.entry?.content).toBe('Usage: /sessions search <partial-id>');
    });

    test('should handle unknown action', () => {
      const result = handleSessions(['unknown']);

      expect(result.entry?.content).toContain('Unknown action: unknown');
      expect(result.entry?.content).toContain('Available actions');
    });
  });
});

// ============================================================================
// SECURITY HANDLERS TESTS
// ============================================================================

describe('Security Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSecurityManager.formatDashboard.mockReturnValue('Security Dashboard');
    mockSecurityManager.getEvents.mockReturnValue([]);
    mockConfirmationService.isDryRunMode.mockReturnValue(false);
    mockConfirmationService.getDryRunLog.mockReturnValue([]);
    mockConfirmationService.formatDryRunLog.mockReturnValue('No operations logged');
    mockCodeGuardianAgent.isReady.mockReturnValue(true);
    mockCodeGuardianAgent.getMode.mockReturnValue('ANALYZE_ONLY');
  });

  describe('handleSecurity', () => {
    test('should show dashboard by default', () => {
      const result = handleSecurity([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBe('Security Dashboard');
    });

    test('should show dashboard with "status" action', () => {
      handleSecurity(['status']);

      expect(mockSecurityManager.formatDashboard).toHaveBeenCalled();
    });

    test('should set security mode', () => {
      const result = handleSecurity(['mode', 'read-only']);

      expect(result.entry?.content).toContain('mode set to: READ-ONLY');
      expect(mockSecurityManager.updateConfig).toHaveBeenCalledWith({ approvalMode: 'read-only' });
    });

    test('should show usage for invalid mode', () => {
      const result = handleSecurity(['mode', 'invalid']);

      expect(result.entry?.content).toContain('Usage: /security mode');
    });

    test('should reset stats', () => {
      const result = handleSecurity(['reset']);

      expect(result.entry?.content).toContain('statistics reset');
      expect(mockSecurityManager.resetStats).toHaveBeenCalled();
    });

    test('should show events', () => {
      mockSecurityManager.getEvents.mockReturnValue([
        { timestamp: Date.now(), type: 'approval', action: 'bash', result: 'approved' },
      ]);

      const result = handleSecurity(['events']);

      expect(result.entry?.content).toContain('Recent Security Events');
      expect(result.entry?.content).toContain('approval');
    });

    test('should show empty events message', () => {
      mockSecurityManager.getEvents.mockReturnValue([]);

      const result = handleSecurity(['events']);

      expect(result.entry?.content).toContain('No security events recorded');
    });
  });

  describe('handleDryRun', () => {
    test('should show status by default', () => {
      const result = handleDryRun([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Dry-Run Status');
    });

    test('should enable dry-run mode', () => {
      const result = handleDryRun(['on']);

      expect(result.entry?.content).toContain('Dry-Run Mode: ENABLED');
      expect(mockConfirmationService.setDryRunMode).toHaveBeenCalledWith(true);
    });

    test('should disable dry-run mode', () => {
      mockConfirmationService.getDryRunLog.mockReturnValue([1, 2, 3]);

      const result = handleDryRun(['off']);

      expect(result.entry?.content).toContain('Dry-Run Mode: DISABLED');
      expect(result.entry?.content).toContain('3 operation(s) were logged');
      expect(mockConfirmationService.setDryRunMode).toHaveBeenCalledWith(false);
    });

    test('should show log', () => {
      mockConfirmationService.formatDryRunLog.mockReturnValue('1. bash ls\n2. write file');

      const result = handleDryRun(['log']);

      expect(result.entry?.content).toContain('bash ls');
    });
  });

  describe('handleGuardian', () => {
    test('should show help by default', async () => {
      const result = await handleGuardian([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Code Guardian');
      expect(result.entry?.content).toContain('Actions disponibles');
    });

    test('should show help with "help" action', async () => {
      const result = await handleGuardian(['help']);

      expect(result.entry?.content).toContain('/guardian analyze');
      expect(result.entry?.content).toContain('/guardian security');
    });

    test('should set mode', async () => {
      const result = await handleGuardian(['mode', 'suggest']);

      expect(mockCodeGuardianAgent.setMode).toHaveBeenCalledWith('SUGGEST_REFACTOR');
      expect(result.entry?.content).toContain('Mode: SUGGEST_REFACTOR');
    });

    test('should execute analyze action', async () => {
      mockCodeGuardianAgent.execute.mockResolvedValue({
        success: true,
        output: 'Analysis complete',
      });

      const result = await handleGuardian(['analyze', 'src/']);

      expect(result.entry?.content).toBe('Analysis complete');
      expect(mockCodeGuardianAgent.execute).toHaveBeenCalledWith({
        action: 'analyze-directory',
        inputFiles: ['src/'],
      });
    });

    test('should handle execution error', async () => {
      mockCodeGuardianAgent.execute.mockResolvedValue({
        success: false,
        error: 'Analysis failed',
      });

      const result = await handleGuardian(['analyze']);

      expect(result.entry?.content).toContain('Erreur');
      expect(result.entry?.content).toContain('Analysis failed');
    });

    test('should handle thrown errors', async () => {
      mockCodeGuardianAgent.execute.mockRejectedValue(new Error('Network error'));

      const result = await handleGuardian(['security']);

      expect(result.entry?.content).toContain('Erreur');
      expect(result.entry?.content).toContain('Network error');
    });

    test('should initialize if not ready', async () => {
      mockCodeGuardianAgent.isReady.mockReturnValue(false);

      await handleGuardian(['help']);

      expect(mockCodeGuardianAgent.initialize).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// EXPORT HANDLERS TESTS
// ============================================================================

describe('Export Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExportManager.exportSession.mockResolvedValue({
      success: true,
      filePath: '/home/user/.codebuddy/exports/session-2025-01-15.md',
    });
    mockExportManager.listExports.mockResolvedValue([]);
    mockSessionRepository.findSessions.mockReturnValue([{ id: 'session-123' }]);
  });

  describe('handleExport', () => {
    test('should export most recent session by default', async () => {
      const result = await handleExport([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('exported successfully');
      expect(mockExportManager.exportSession).toHaveBeenCalledWith(
        'session-123',
        'markdown',
        expect.any(Object)
      );
    });

    test('should export with specified format', async () => {
      await handleExport(['json']);

      expect(mockExportManager.exportSession).toHaveBeenCalledWith(
        expect.any(String),
        'json',
        expect.any(Object)
      );
    });

    test('should export specific session', async () => {
      await handleExport(['session:abc123']);

      expect(mockExportManager.exportSession).toHaveBeenCalledWith(
        'abc123',
        'markdown',
        expect.any(Object)
      );
    });

    test('should respect --include-secrets flag', async () => {
      await handleExport(['--include-secrets']);

      expect(mockExportManager.exportSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ redactSecrets: false })
      );
    });

    test('should respect --no-tools flag', async () => {
      await handleExport(['--no-tools']);

      expect(mockExportManager.exportSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ includeToolCalls: false })
      );
    });

    test('should handle no sessions found', async () => {
      mockSessionRepository.findSessions.mockReturnValue([]);

      const result = await handleExport([]);

      expect(result.entry?.content).toContain('No sessions found');
    });

    test('should handle export failure', async () => {
      mockExportManager.exportSession.mockResolvedValue({
        success: false,
        error: 'Disk full',
      });

      const result = await handleExport([]);

      expect(result.entry?.content).toContain('Failed to export');
      expect(result.entry?.content).toContain('Disk full');
    });
  });

  describe('handleExportList', () => {
    test('should list exports', async () => {
      mockExportManager.listExports.mockResolvedValue([
        {
          filename: 'session-2025-01-15.md',
          path: '/home/user/.codebuddy/exports/session-2025-01-15.md',
          size: 1024,
          created: new Date('2025-01-15'),
        },
      ]);

      const result = await handleExportList();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Exported Files');
      expect(result.entry?.content).toContain('session-2025-01-15.md');
    });

    test('should show message when no exports found', async () => {
      mockExportManager.listExports.mockResolvedValue([]);

      const result = await handleExportList();

      expect(result.entry?.content).toContain('No exported files found');
    });

    test('should format file sizes correctly', async () => {
      mockExportManager.listExports.mockResolvedValue([
        { filename: 'small.md', size: 500, created: new Date(), path: '/path' },
        { filename: 'medium.md', size: 50000, created: new Date(), path: '/path' },
        { filename: 'large.md', size: 5000000, created: new Date(), path: '/path' },
      ]);

      const result = await handleExportList();

      expect(result.entry?.content).toContain('500 B');
      expect(result.entry?.content).toContain('KB');
      expect(result.entry?.content).toContain('MB');
    });
  });

  describe('handleExportFormats', () => {
    test('should show available formats', () => {
      const result = handleExportFormats();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Export Formats & Options');
      expect(result.entry?.content).toContain('json');
      expect(result.entry?.content).toContain('markdown');
      expect(result.entry?.content).toContain('html');
      expect(result.entry?.content).toContain('text');
    });

    test('should show examples', () => {
      const result = handleExportFormats();

      expect(result.entry?.content).toContain('Examples');
      expect(result.entry?.content).toContain('/export markdown');
    });
  });
});

// ============================================================================
// TEST HANDLERS TESTS
// ============================================================================

describe('Test Handlers', () => {
  describe('handleGenerateTests', () => {
    test('should show usage when no file provided', () => {
      const result = handleGenerateTests([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Test Generator');
      expect(result.entry?.content).toContain('Usage: /generate-tests <file>');
    });

    test('should pass target file to AI', () => {
      const result = handleGenerateTests(['src/utils/helpers.ts']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toContain('src/utils/helpers.ts');
    });

    test('should include test generation instructions', () => {
      const result = handleGenerateTests(['src/api.ts']);

      expect(result.prompt).toContain('Generate comprehensive tests');
      expect(result.prompt).toContain('Happy paths');
      expect(result.prompt).toContain('Edge cases');
      expect(result.prompt).toContain('Error conditions');
    });
  });
});

// ============================================================================
// VIBE HANDLERS TESTS
// ============================================================================

describe('Vibe Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsManager.loadUserSettings.mockReturnValue(undefined);
    mockSlashCommandManager.reload.mockReturnValue(undefined);
  });

  describe('handleReload', () => {
    test('should reload configuration', async () => {
      const result = await handleReload();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Reloading Configuration');
      expect(result.entry?.content).toContain('User settings reloaded');
      expect(result.entry?.content).toContain('Slash commands reloaded');
    });

    test('should indicate success', async () => {
      const result = await handleReload();

      expect(result.entry?.content).toContain('[OK]');
      expect(result.entry?.content).toContain('Configuration reloaded successfully');
    });
  });

  describe('handleLog', () => {
    test('should show log info', async () => {
      const result = await handleLog();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Log file:');
    });
  });

  describe('handleCompact', () => {
    test('should show compaction info with history', async () => {
      const history = [
        { type: 'user', content: 'Hello' },
        { type: 'assistant', content: 'Hi there!' },
      ];

      const result = await handleCompact([], history);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Compacting Conversation');
      expect(result.entry?.content).toContain('Current messages: 2');
    });

    test('should show empty message when no history', async () => {
      const result = await handleCompact([]);

      expect(result.entry?.content).toContain('No conversation history to compact');
    });
  });

  describe('handleTools', () => {
    test('should list tools by default', async () => {
      const result = await handleTools([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Available Tools');
    });

    test('should list tools with "list" action', async () => {
      const result = await handleTools(['list']);

      expect(result.entry?.content).toContain('Total:');
    });

    test('should filter tools', async () => {
      const { setToolFilter } = await import('../../src/utils/tool-filter');

      const result = await handleTools(['filter', 'bash,search']);

      expect(setToolFilter).toHaveBeenCalled();
      expect(result.entry?.content).toContain('Tool filter applied');
    });

    test('should show usage when filter has no pattern', async () => {
      const result = await handleTools(['filter']);

      expect(result.entry?.content).toContain('Usage: /tools filter <pattern>');
    });

    test('should reset tool filter', async () => {
      const { resetToolFilter } = await import('../../src/utils/tool-filter');

      const result = await handleTools(['reset']);

      expect(resetToolFilter).toHaveBeenCalled();
      expect(result.entry?.content).toContain('Tool filter reset');
    });

    test('should show usage for unknown action', async () => {
      const result = await handleTools(['unknown']);

      expect(result.entry?.content).toContain('Usage: /tools [list|filter <pattern>|reset]');
    });
  });

  describe('handleVimMode', () => {
    const originalEnv = process.env.GROK_VIM_MODE;

    afterEach(() => {
      process.env.GROK_VIM_MODE = originalEnv;
    });

    test('should show status by default', async () => {
      process.env.GROK_VIM_MODE = 'false';

      const result = await handleVimMode([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Vim Mode Status');
      expect(result.entry?.content).toContain('DISABLED');
    });

    test('should enable vim mode', async () => {
      const result = await handleVimMode(['on']);

      expect(process.env.GROK_VIM_MODE).toBe('true');
      expect(result.entry?.content).toContain('Vim mode: ENABLED');
      expect(result.entry?.content).toContain('Keybindings');
    });

    test('should disable vim mode', async () => {
      process.env.GROK_VIM_MODE = 'true';

      const result = await handleVimMode(['off']);

      expect(process.env.GROK_VIM_MODE).toBe('false');
      expect(result.entry?.content).toContain('Vim mode: DISABLED');
    });

    test('should toggle vim mode', async () => {
      process.env.GROK_VIM_MODE = 'false';

      const result = await handleVimMode(['toggle']);

      expect(process.env.GROK_VIM_MODE).toBe('true');
      expect(result.entry?.content).toContain('ENABLED');
    });

    test('should toggle off when enabled', async () => {
      process.env.GROK_VIM_MODE = 'true';

      const result = await handleVimMode(['toggle']);

      expect(process.env.GROK_VIM_MODE).toBe('false');
      expect(result.entry?.content).toContain('DISABLED');
    });
  });
});

// ============================================================================
// COMMON HANDLER PATTERNS TESTS
// ============================================================================

describe('Common Handler Patterns', () => {
  test('all handlers should return handled: true', async () => {
    const results = await Promise.all([
      handleMemory([]),
      handleRemember(['key', 'value']),
      handleCost([]),
      handleStats([]),
      handleCache([]),
      handleSelfHealing([]),
      handleContext([]),
      handleWorkspace(),
      handleSessions([]),
      handleSecurity([]),
      handleDryRun([]),
      handleExportFormats(),
      handleGenerateTests([]),
      handleReload(),
      handleLog(),
      handleCompact([]),
      handleTools([]),
      handleVimMode([]),
    ]);

    results.forEach((result) => {
      expect(result.handled).toBe(true);
    });
  });

  test('all handlers should return proper entry type', async () => {
    const results = await Promise.all([
      handleMemory([]),
      handleCost([]),
      handleStats([]),
      handleCache([]),
      handleContext([]),
      handleSessions([]),
      handleSecurity([]),
      handleDryRun([]),
      handleExportFormats(),
      handleReload(),
      handleVimMode([]),
    ]);

    results.forEach((result) => {
      if (result.entry) {
        expect(result.entry.type).toBe('assistant');
        expect(result.entry.timestamp).toBeInstanceOf(Date);
        expect(typeof result.entry.content).toBe('string');
      }
    });
  });

  test('handlers with passToAI should have prompt', () => {
    const generateTestResult = handleGenerateTests(['src/file.ts']);

    expect(generateTestResult.passToAI).toBe(true);
    expect(generateTestResult.prompt).toBeDefined();
    expect(typeof generateTestResult.prompt).toBe('string');
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  test('handleAddContext should catch and format errors', async () => {
    const { getContextLoader } = await import('../../src/context/context-loader');
    (getContextLoader as jest.Mock).mockImplementation(() => ({
      loadFiles: jest.fn().mockRejectedValue(new Error('File system error')),
    }));

    const result = await handleAddContext(['**/*.ts']);

    expect(result.entry?.content).toContain('Error loading files');
    expect(result.entry?.content).toContain('File system error');
  });

  test('handleGuardian should handle execution errors gracefully', async () => {
    mockCodeGuardianAgent.isReady.mockReturnValue(true);
    mockCodeGuardianAgent.execute.mockRejectedValue(new Error('Execution failed'));

    const result = await handleGuardian(['analyze']);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Erreur');
    expect(result.entry?.content).toContain('Execution failed');
  });

  test('handleExport should handle missing sessions gracefully', async () => {
    mockSessionRepository.findSessions.mockReturnValue([]);

    const result = await handleExport([]);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('No sessions found');
  });
});
