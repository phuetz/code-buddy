/**
 * Unit Tests for Agent Repair Integration
 *
 * Tests the autonomous repair functionality integrated into CodeBuddyAgent.
 */

import { EventEmitter } from 'events';

// Mock the repair module before importing agent
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

// Mock other dependencies
jest.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    stream: jest.fn(),
    dispose: jest.fn(),
  })),
}));

const mockBashInstance = {
  execute: jest.fn().mockResolvedValue({ success: true, output: '' }),
  getCurrentDirectory: jest.fn().mockReturnValue('/test'),
  setSelfHealing: jest.fn(),
  isSelfHealingEnabled: jest.fn().mockReturnValue(true),
};

jest.mock('../../src/tools/index.js', () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    view: jest.fn().mockResolvedValue({ success: true, output: '' }),
    create: jest.fn().mockResolvedValue({ success: true }),
    strReplace: jest.fn().mockResolvedValue({ success: true }),
  })),
  BashTool: jest.fn().mockImplementation(() => mockBashInstance),
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
  }),
}));

jest.mock('../../src/mcp/config.js', () => ({
  loadMCPConfig: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/utils/custom-instructions.js', () => ({
  loadCustomInstructions: jest.fn().mockResolvedValue(''),
}));

jest.mock('../../src/tools/tool-selector.js', () => ({
  recordToolRequest: jest.fn(),
  formatToolSelectionMetrics: jest.fn().mockReturnValue(''),
}));

describe('Agent Repair Integration', () => {
  let CodeBuddyAgent: any;
  let agent: any;
  let mockRepairEngine: any;

  beforeAll(async () => {
    // Import after mocks are set up
    const module = await import('../../src/agent/codebuddy-agent.js');
    CodeBuddyAgent = module.CodeBuddyAgent;
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Get reference to mock repair engine
    const { getRepairEngine } = require('../../src/agent/repair/index.js');
    mockRepairEngine = {
      repair: jest.fn().mockResolvedValue([]),
      setExecutors: jest.fn(),
      dispose: jest.fn(),
    };
    getRepairEngine.mockReturnValue(mockRepairEngine);

    // Create agent instance
    agent = new CodeBuddyAgent('test-api-key');
  });

  afterEach(() => {
    if (agent?.dispose) {
      agent.dispose();
    }
  });

  describe('Auto-Repair Configuration', () => {
    it('should have auto-repair enabled by default', () => {
      expect(agent.isAutoRepairEnabled()).toBe(true);
    });

    it('should allow disabling auto-repair', () => {
      agent.setAutoRepair(false);
      expect(agent.isAutoRepairEnabled()).toBe(false);
    });

    it('should allow enabling auto-repair', () => {
      agent.setAutoRepair(false);
      agent.setAutoRepair(true);
      expect(agent.isAutoRepairEnabled()).toBe(true);
    });
  });

  describe('Error Pattern Detection', () => {
    it('should detect TypeScript errors as repairable', async () => {
      const errorOutput = 'src/file.ts(10,5): error TS2339: Property does not exist';
      const result = await agent.attemptAutoRepair(errorOutput);
      expect(result.attempted).toBe(true);
    });

    it('should detect ESLint errors as repairable', async () => {
      const errorOutput = 'eslint: 5 errors found';
      const result = await agent.attemptAutoRepair(errorOutput);
      expect(result.attempted).toBe(true);
    });

    it('should detect test failures as repairable', async () => {
      const errorOutput = 'FAIL tests/unit/example.test.ts';
      const result = await agent.attemptAutoRepair(errorOutput);
      expect(result.attempted).toBe(true);
    });

    it('should detect syntax errors as repairable', async () => {
      const errorOutput = 'SyntaxError: Unexpected token';
      const result = await agent.attemptAutoRepair(errorOutput);
      expect(result.attempted).toBe(true);
    });

    it('should not attempt repair for non-matching errors', async () => {
      const errorOutput = 'Some random output without errors';
      const result = await agent.attemptAutoRepair(errorOutput);
      expect(result.attempted).toBe(false);
      expect(result.message).toBe('Error not recognized as repairable');
    });

    it('should not attempt repair when disabled', async () => {
      agent.setAutoRepair(false);
      const errorOutput = 'error TS2339: Property does not exist';
      const result = await agent.attemptAutoRepair(errorOutput);
      expect(result.attempted).toBe(false);
    });
  });

  describe('Repair Execution', () => {
    it('should call repair engine with error output', async () => {
      const errorOutput = 'error TS2339: Property does not exist';
      await agent.attemptAutoRepair(errorOutput, 'npm run build');

      expect(mockRepairEngine.repair).toHaveBeenCalledWith(errorOutput, 'npm run build');
    });

    it('should report success when fixes are applied', async () => {
      mockRepairEngine.repair.mockResolvedValue([
        {
          success: true,
          appliedPatch: { explanation: 'Added missing property' },
          fault: {},
          candidatesGenerated: 1,
          candidatesTested: 1,
          allPatches: [],
          iterations: 1,
          duration: 100,
        },
      ]);

      const result = await agent.attemptAutoRepair('error TS2339: test');

      expect(result.success).toBe(true);
      expect(result.fixes).toHaveLength(1);
      expect(result.fixes[0]).toBe('Added missing property');
    });

    it('should report failure when no fixes succeed', async () => {
      mockRepairEngine.repair.mockResolvedValue([
        {
          success: false,
          fault: {},
          candidatesGenerated: 3,
          candidatesTested: 3,
          allPatches: [],
          iterations: 3,
          duration: 500,
        },
      ]);

      const result = await agent.attemptAutoRepair('error TS2339: test');

      expect(result.attempted).toBe(true);
      expect(result.success).toBe(false);
      expect(result.fixes).toHaveLength(0);
    });

    it('should handle repair engine errors gracefully', async () => {
      mockRepairEngine.repair.mockRejectedValue(new Error('Repair failed'));

      const result = await agent.attemptAutoRepair('error TS2339: test');

      expect(result.attempted).toBe(true);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Auto-repair error');
    });
  });

  describe('Event Emission', () => {
    it('should emit repair:start event', async () => {
      const listener = jest.fn();
      agent.on('repair:start', listener);

      await agent.attemptAutoRepair('error TS2339: test', 'npm run build');

      expect(listener).toHaveBeenCalledWith({
        errorOutput: 'error TS2339: test',
        command: 'npm run build',
      });
    });

    it('should emit repair:success event on successful repair', async () => {
      mockRepairEngine.repair.mockResolvedValue([
        {
          success: true,
          appliedPatch: { explanation: 'Fixed it' },
          fault: {},
          candidatesGenerated: 1,
          candidatesTested: 1,
          allPatches: [],
          iterations: 1,
          duration: 100,
        },
      ]);

      const listener = jest.fn();
      agent.on('repair:success', listener);

      await agent.attemptAutoRepair('error TS2339: test');

      expect(listener).toHaveBeenCalled();
    });

    it('should emit repair:failed event when no fixes succeed', async () => {
      mockRepairEngine.repair.mockResolvedValue([]);

      const listener = jest.fn();
      agent.on('repair:failed', listener);

      await agent.attemptAutoRepair('error TS2339: test');

      expect(listener).toHaveBeenCalledWith({ reason: 'No successful fixes found' });
    });

    it('should emit repair:error event on exception', async () => {
      mockRepairEngine.repair.mockRejectedValue(new Error('Failed'));

      const listener = jest.fn();
      agent.on('repair:error', listener);

      await agent.attemptAutoRepair('error TS2339: test');

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Bash Tool Integration', () => {
    it('should trigger auto-repair when a bash command fails', async () => {
      // Simulate bash failure
      mockBashInstance.execute
        .mockResolvedValueOnce({ success: false, error: 'error TS2339: test failure' }) // First try fails
        .mockResolvedValueOnce({ success: true, output: 'success after fix' }); // Second try (retry) succeeds

      // Mock successful repair
      mockRepairEngine.repair.mockResolvedValue([
        {
          success: true,
          appliedPatch: { explanation: 'Fixed type error' },
          fault: {},
          candidatesGenerated: 1,
          candidatesTested: 1,
          allPatches: [],
          iterations: 1,
          duration: 100,
        },
      ]);

      // Access protected executeTool via any
      const result = await (agent as any).executeTool({
        id: 'call-1',
        type: 'function',
        function: {
          name: 'bash',
          arguments: JSON.stringify({ command: 'npm run build' }),
        },
      });

      expect(mockRepairEngine.repair).toHaveBeenCalled();
      expect(mockBashInstance.execute).toHaveBeenCalledTimes(2); // Initial + Retry
      expect(result.success).toBe(true);
      expect(result.output).toContain('Auto-repaired: Fixed type error');
    });

    it('should return original failure if auto-repair fails', async () => {
      // Simulate bash failure
      mockBashInstance.execute.mockResolvedValue({ 
        success: false, 
        error: 'error TS2339: unfixable',
        output: 'original output'
      });

      // Mock failed repair
      mockRepairEngine.repair.mockResolvedValue([]);

      const result = await (agent as any).executeTool({
        id: 'call-2',
        type: 'function',
        function: {
          name: 'bash',
          arguments: JSON.stringify({ command: 'npm test' }),
        },
      });

      expect(mockRepairEngine.repair).toHaveBeenCalled();
      expect(mockBashInstance.execute).toHaveBeenCalledTimes(1); // No retry if repair failed
      expect(result.success).toBe(false);
    });
  });
});
