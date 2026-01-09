/**
 * Comprehensive Unit Tests for Agent State Module
 *
 * Tests cover:
 * 1. State management (configuration, mode, cost tracking)
 * 2. State persistence (session storage)
 * 3. State mutations (config updates, mode changes, YOLO mode)
 */

import { EventEmitter } from 'events';

// Mock the cost tracker
const mockCalculateCost = jest.fn().mockReturnValue(0.01);
const mockRecordUsage = jest.fn();
const mockCostTracker = {
  calculateCost: mockCalculateCost,
  recordUsage: mockRecordUsage,
};

jest.mock('../../src/utils/cost-tracker.js', () => ({
  getCostTracker: jest.fn().mockReturnValue(mockCostTracker),
  CostTracker: jest.fn(),
}));

// Mock the agent mode manager
const mockGetMode = jest.fn().mockReturnValue('code');
const mockSetMode = jest.fn();
const mockIsToolAllowed = jest.fn().mockReturnValue(true);
const mockFormatModeStatus = jest.fn().mockReturnValue('Mode: code - Code mode');
const mockModeManager = {
  getMode: mockGetMode,
  setMode: mockSetMode,
  isToolAllowed: mockIsToolAllowed,
  formatModeStatus: mockFormatModeStatus,
};

jest.mock('../../src/agent/agent-mode.js', () => ({
  getAgentModeManager: jest.fn().mockReturnValue(mockModeManager),
  AgentModeManager: jest.fn(),
}));

// Mock the sandbox manager
const mockValidateCommand = jest.fn().mockReturnValue({ valid: true });
const mockFormatSandboxStatus = jest.fn().mockReturnValue('Sandbox: native');
const mockSandboxManager = {
  validateCommand: mockValidateCommand,
  formatStatus: mockFormatSandboxStatus,
};

jest.mock('../../src/security/sandbox.js', () => ({
  getSandboxManager: jest.fn().mockReturnValue(mockSandboxManager),
  SandboxManager: jest.fn(),
}));

// Mock the context manager
const mockGetStats = jest.fn().mockReturnValue({
  totalTokens: 1000,
  maxTokens: 4000,
  usagePercent: 25,
  messageCount: 10,
  summarizedSessions: 0,
  isNearLimit: false,
  isCritical: false,
});
const mockUpdateContextConfig = jest.fn();
const mockContextManagerDispose = jest.fn();
const mockContextManager = {
  getStats: mockGetStats,
  updateConfig: mockUpdateContextConfig,
  dispose: mockContextManagerDispose,
};

jest.mock('../../src/context/context-manager-v2.js', () => ({
  createContextManager: jest.fn().mockReturnValue(mockContextManager),
  ContextManagerV2: jest.fn(),
}));

// Mock the session store
const mockUpdateCurrentSession = jest.fn();
const mockFormatSessionList = jest.fn().mockReturnValue('No saved sessions.');
const mockGetCurrentSessionId = jest.fn().mockReturnValue('session_123');
const mockExportSessionToFile = jest.fn().mockReturnValue('/path/to/export.md');
const mockSessionStore = {
  updateCurrentSession: mockUpdateCurrentSession,
  formatSessionList: mockFormatSessionList,
  getCurrentSessionId: mockGetCurrentSessionId,
  exportSessionToFile: mockExportSessionToFile,
};

jest.mock('../../src/persistence/session-store.js', () => ({
  getSessionStore: jest.fn().mockReturnValue(mockSessionStore),
  SessionStore: jest.fn(),
}));

import {
  AgentState,
  DEFAULT_AGENT_CONFIG,
  YOLO_CONFIG,
} from '../../src/agent/agent-state';
import { getCostTracker } from '../../src/utils/cost-tracker.js';
import { getAgentModeManager, AgentMode } from '../../src/agent/agent-mode.js';
import { getSandboxManager } from '../../src/security/sandbox.js';
import { createContextManager } from '../../src/context/context-manager-v2.js';
import { getSessionStore } from '../../src/persistence/session-store.js';

describe('AgentState', () => {
  let state: AgentState;

  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset env
    process.env = { ...originalEnv };
    delete process.env.YOLO_MODE;
    delete process.env.MAX_COST;

    // Reset mock return values
    mockGetMode.mockReturnValue('code');
    mockIsToolAllowed.mockReturnValue(true);
    mockValidateCommand.mockReturnValue({ valid: true });
    mockGetStats.mockReturnValue({
      totalTokens: 1000,
      maxTokens: 4000,
      usagePercent: 25,
      messageCount: 10,
      summarizedSessions: 0,
      isNearLimit: false,
      isCritical: false,
    });
    mockGetCurrentSessionId.mockReturnValue('session_123');
    mockExportSessionToFile.mockReturnValue('/path/to/export.md');

    // Create fresh state for each test
    state = new AgentState();
  });

  afterEach(() => {
    state.dispose();
    process.env = originalEnv;
  });

  describe('Constructor and Initialization', () => {
    it('should create a new instance with default config', () => {
      expect(state).toBeDefined();
      expect(state).toBeInstanceOf(EventEmitter);
    });

    it('should initialize with default agent configuration', () => {
      const config = state.getConfig();

      expect(config.maxToolRounds).toBe(DEFAULT_AGENT_CONFIG.maxToolRounds);
      expect(config.sessionCostLimit).toBe(DEFAULT_AGENT_CONFIG.sessionCostLimit);
      expect(config.yoloMode).toBe(DEFAULT_AGENT_CONFIG.yoloMode);
      expect(config.parallelToolExecution).toBe(DEFAULT_AGENT_CONFIG.parallelToolExecution);
      expect(config.ragToolSelection).toBe(DEFAULT_AGENT_CONFIG.ragToolSelection);
      expect(config.selfHealing).toBe(DEFAULT_AGENT_CONFIG.selfHealing);
    });

    it('should merge custom options with defaults', () => {
      const customState = new AgentState({
        maxToolRounds: 100,
        parallelToolExecution: true,
      });

      const config = customState.getConfig();

      expect(config.maxToolRounds).toBe(100);
      expect(config.parallelToolExecution).toBe(true);
      expect(config.sessionCostLimit).toBe(DEFAULT_AGENT_CONFIG.sessionCostLimit);

      customState.dispose();
    });

    it('should apply YOLO mode when set in options', () => {
      const yoloState = new AgentState({ yoloMode: true });
      const config = yoloState.getConfig();

      expect(config.yoloMode).toBe(true);
      expect(config.maxToolRounds).toBe(YOLO_CONFIG.maxToolRounds);
      expect(config.sessionCostLimit).toBe(Infinity);

      yoloState.dispose();
    });

    it('should apply YOLO mode when set in environment', () => {
      process.env.YOLO_MODE = 'true';

      const envYoloState = new AgentState();
      const config = envYoloState.getConfig();

      expect(config.yoloMode).toBe(true);
      expect(config.maxToolRounds).toBe(400);

      envYoloState.dispose();
    });

    it('should apply MAX_COST from environment', () => {
      process.env.MAX_COST = '50';

      const maxCostState = new AgentState();
      const config = maxCostState.getConfig();

      expect(config.sessionCostLimit).toBe(50);

      maxCostState.dispose();
    });

    it('should ignore invalid MAX_COST values', () => {
      process.env.MAX_COST = 'invalid';

      const invalidCostState = new AgentState();
      const config = invalidCostState.getConfig();

      expect(config.sessionCostLimit).toBe(DEFAULT_AGENT_CONFIG.sessionCostLimit);

      invalidCostState.dispose();
    });

    it('should ignore non-positive MAX_COST values', () => {
      process.env.MAX_COST = '-10';

      const negativeCostState = new AgentState();
      const config = negativeCostState.getConfig();

      expect(config.sessionCostLimit).toBe(DEFAULT_AGENT_CONFIG.sessionCostLimit);

      negativeCostState.dispose();
    });

    it('should initialize all managers', () => {
      // Create a fresh state to trigger initialization
      const freshState = new AgentState();

      expect(getCostTracker).toHaveBeenCalled();
      expect(getAgentModeManager).toHaveBeenCalled();
      expect(getSandboxManager).toHaveBeenCalled();
      expect(createContextManager).toHaveBeenCalled();
      expect(getSessionStore).toHaveBeenCalled();

      freshState.dispose();
    });
  });

  describe('Configuration Methods', () => {
    it('should return a readonly copy of config', () => {
      const config1 = state.getConfig();
      const config2 = state.getConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });

    it('should update configuration', () => {
      state.updateConfig({ maxToolRounds: 200 });

      const config = state.getConfig();
      expect(config.maxToolRounds).toBe(200);
    });

    it('should emit config:updated event on update', () => {
      const handler = jest.fn();
      state.on('config:updated', handler);

      state.updateConfig({ maxToolRounds: 200 });

      expect(handler).toHaveBeenCalledWith({
        old: expect.objectContaining({ maxToolRounds: DEFAULT_AGENT_CONFIG.maxToolRounds }),
        new: expect.objectContaining({ maxToolRounds: 200 }),
      });
    });

    it('should preserve unchanged values on partial update', () => {
      state.updateConfig({ maxToolRounds: 200 });

      const config = state.getConfig();
      expect(config.sessionCostLimit).toBe(DEFAULT_AGENT_CONFIG.sessionCostLimit);
      expect(config.yoloMode).toBe(DEFAULT_AGENT_CONFIG.yoloMode);
    });

    it('should get max tool rounds', () => {
      expect(state.getMaxToolRounds()).toBe(DEFAULT_AGENT_CONFIG.maxToolRounds);
    });

    it('should set max tool rounds', () => {
      state.setMaxToolRounds(100);

      expect(state.getMaxToolRounds()).toBe(100);
    });
  });

  describe('YOLO Mode Methods', () => {
    it('should enable YOLO mode', () => {
      state.setYoloMode(true);

      expect(state.isYoloModeEnabled()).toBe(true);
      expect(state.getMaxToolRounds()).toBe(400);
      expect(state.getSessionCostLimit()).toBe(Infinity);
    });

    it('should disable YOLO mode', () => {
      state.setYoloMode(true);
      state.setYoloMode(false);

      expect(state.isYoloModeEnabled()).toBe(false);
      expect(state.getMaxToolRounds()).toBe(DEFAULT_AGENT_CONFIG.maxToolRounds);
      expect(state.getSessionCostLimit()).toBe(DEFAULT_AGENT_CONFIG.sessionCostLimit);
    });

    it('should emit yolo:changed event when enabled', () => {
      const handler = jest.fn();
      state.on('yolo:changed', handler);

      state.setYoloMode(true);

      expect(handler).toHaveBeenCalledWith(true);
    });

    it('should emit yolo:changed event when disabled', () => {
      state.setYoloMode(true);

      const handler = jest.fn();
      state.on('yolo:changed', handler);

      state.setYoloMode(false);

      expect(handler).toHaveBeenCalledWith(false);
    });

    it('should correctly report YOLO mode status', () => {
      expect(state.isYoloModeEnabled()).toBe(false);

      state.setYoloMode(true);
      expect(state.isYoloModeEnabled()).toBe(true);
    });
  });

  describe('Cost Tracking Methods', () => {
    it('should get initial session cost of zero', () => {
      expect(state.getSessionCost()).toBe(0);
    });

    it('should get session cost limit', () => {
      expect(state.getSessionCostLimit()).toBe(DEFAULT_AGENT_CONFIG.sessionCostLimit);
    });

    it('should set session cost limit', () => {
      state.setSessionCostLimit(50);

      expect(state.getSessionCostLimit()).toBe(50);
    });

    it('should emit costLimit:changed event on limit change', () => {
      const handler = jest.fn();
      state.on('costLimit:changed', handler);

      state.setSessionCostLimit(50);

      expect(handler).toHaveBeenCalledWith(50);
    });

    it('should initially not reach session cost limit', () => {
      expect(state.isSessionCostLimitReached()).toBe(false);
    });

    it('should record session cost', () => {
      state.recordSessionCost(1000, 500, 'grok-3-latest');

      expect(mockCalculateCost).toHaveBeenCalledWith(1000, 500, 'grok-3-latest');
      expect(mockRecordUsage).toHaveBeenCalledWith(1000, 500, 'grok-3-latest');
      expect(state.getSessionCost()).toBeGreaterThan(0);
    });

    it('should accumulate session costs', () => {
      state.recordSessionCost(1000, 500, 'grok-3-latest');
      const firstCost = state.getSessionCost();

      state.recordSessionCost(1000, 500, 'grok-3-latest');
      const secondCost = state.getSessionCost();

      expect(secondCost).toBe(firstCost * 2);
    });

    it('should emit cost:recorded event', () => {
      const handler = jest.fn();
      state.on('cost:recorded', handler);

      state.recordSessionCost(1000, 500, 'grok-3-latest');

      expect(handler).toHaveBeenCalledWith({
        cost: 0.01,
        total: 0.01,
      });
    });

    it('should emit cost:limitReached when limit exceeded', () => {
      const handler = jest.fn();
      state.on('cost:limitReached', handler);

      // Set a very low limit
      state.setSessionCostLimit(0.005);

      // Record cost that exceeds limit
      state.recordSessionCost(1000, 500, 'grok-3-latest');

      expect(handler).toHaveBeenCalledWith(0.01);
    });

    it('should detect when session cost limit is reached', () => {
      state.setSessionCostLimit(0.005);
      state.recordSessionCost(1000, 500, 'grok-3-latest');

      expect(state.isSessionCostLimitReached()).toBe(true);
    });

    it('should format cost status correctly', () => {
      const status = state.formatCostStatus();

      expect(status).toContain('Safe');
      expect(status).toContain('$');
      expect(status).toContain('Rounds:');
    });

    it('should format YOLO mode cost status', () => {
      state.setYoloMode(true);

      const status = state.formatCostStatus();

      expect(status).toContain('YOLO');
      expect(status).toContain('unlimited');
    });

    it('should return the cost tracker instance', () => {
      const tracker = state.getCostTracker();

      expect(tracker).toBe(mockCostTracker);
    });
  });

  describe('Mode Methods', () => {
    it('should get current mode', () => {
      const mode = state.getMode();

      expect(mockGetMode).toHaveBeenCalled();
      expect(mode).toBe('code');
    });

    it('should set mode', () => {
      state.setMode('plan' as AgentMode);

      expect(mockSetMode).toHaveBeenCalledWith('plan');
    });

    it('should emit mode:changed event on mode change', () => {
      const handler = jest.fn();
      state.on('mode:changed', handler);

      state.setMode('plan' as AgentMode);

      expect(handler).toHaveBeenCalledWith('plan');
    });

    it('should get mode status', () => {
      const status = state.getModeStatus();

      expect(mockFormatModeStatus).toHaveBeenCalled();
      expect(status).toBe('Mode: code - Code mode');
    });

    it('should check if tool is allowed in current mode', () => {
      mockIsToolAllowed.mockReturnValue(true);
      expect(state.isToolAllowedInCurrentMode('edit_file')).toBe(true);

      mockIsToolAllowed.mockReturnValue(false);
      expect(state.isToolAllowedInCurrentMode('bash')).toBe(false);
    });

    it('should return the mode manager instance', () => {
      const manager = state.getModeManager();

      expect(manager).toBe(mockModeManager);
    });
  });

  describe('Sandbox Methods', () => {
    it('should get sandbox status', () => {
      const status = state.getSandboxStatus();

      expect(mockFormatSandboxStatus).toHaveBeenCalled();
      expect(status).toBe('Sandbox: native');
    });

    it('should validate commands', () => {
      mockValidateCommand.mockReturnValue({ valid: true });
      const result = state.validateCommand('ls -la');

      expect(mockValidateCommand).toHaveBeenCalledWith('ls -la');
      expect(result.valid).toBe(true);
    });

    it('should return validation failure with reason', () => {
      mockValidateCommand.mockReturnValue({
        valid: false,
        reason: 'Dangerous command detected',
      });

      const result = state.validateCommand('rm -rf /');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Dangerous command detected');
    });

    it('should return the sandbox manager instance', () => {
      const manager = state.getSandboxManager();

      expect(manager).toBe(mockSandboxManager);
    });
  });

  describe('Context Methods', () => {
    it('should get context statistics', () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const stats = state.getContextStats(messages);

      expect(mockGetStats).toHaveBeenCalled();
      expect(stats.totalTokens).toBe(1000);
      expect(stats.maxTokens).toBe(4000);
    });

    it('should format context stats as string', () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const formatted = state.formatContextStats(messages);

      expect(formatted).toContain('Context:');
      expect(formatted).toContain('1000');
      expect(formatted).toContain('4000');
      expect(formatted).toContain('Normal');
    });

    it('should show Warning status when near limit', () => {
      mockGetStats.mockReturnValue({
        totalTokens: 3200,
        maxTokens: 4000,
        usagePercent: 80,
        messageCount: 50,
        summarizedSessions: 2,
        isNearLimit: true,
        isCritical: false,
      });

      const messages = [{ role: 'user', content: 'Hello' }];
      const formatted = state.formatContextStats(messages);

      expect(formatted).toContain('Warning');
    });

    it('should show Critical status when critical', () => {
      mockGetStats.mockReturnValue({
        totalTokens: 3800,
        maxTokens: 4000,
        usagePercent: 95,
        messageCount: 100,
        summarizedSessions: 5,
        isNearLimit: true,
        isCritical: true,
      });

      const messages = [{ role: 'user', content: 'Hello' }];
      const formatted = state.formatContextStats(messages);

      expect(formatted).toContain('Critical');
    });

    it('should update context config', () => {
      state.updateContextConfig({ maxContextTokens: 8000 });

      expect(mockUpdateContextConfig).toHaveBeenCalledWith({
        maxContextTokens: 8000,
      });
    });

    it('should return the context manager instance', () => {
      const manager = state.getContextManager();

      expect(manager).toBe(mockContextManager);
    });
  });

  describe('Session Methods', () => {
    it('should save current session', () => {
      const chatHistory = [
        {
          type: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      state.saveCurrentSession(chatHistory);

      expect(mockUpdateCurrentSession).toHaveBeenCalledWith(chatHistory);
    });

    it('should get session list', () => {
      const list = state.getSessionList();

      expect(mockFormatSessionList).toHaveBeenCalled();
      expect(list).toBe('No saved sessions.');
    });

    it('should export current session', () => {
      const result = state.exportCurrentSession('/export/path');

      expect(mockGetCurrentSessionId).toHaveBeenCalled();
      expect(mockExportSessionToFile).toHaveBeenCalledWith('session_123', '/export/path');
      expect(result).toBe('/path/to/export.md');
    });

    it('should return null when exporting without current session', () => {
      mockGetCurrentSessionId.mockReturnValue(null);

      const result = state.exportCurrentSession();

      expect(result).toBeNull();
    });

    it('should return the session store instance', () => {
      const store = state.getSessionStore();

      expect(store).toBe(mockSessionStore);
    });
  });

  describe('Parallel Execution Methods', () => {
    it('should initially have parallel execution disabled', () => {
      expect(state.isParallelToolExecutionEnabled()).toBe(false);
    });

    it('should enable parallel tool execution', () => {
      state.setParallelToolExecution(true);

      expect(state.isParallelToolExecutionEnabled()).toBe(true);
    });

    it('should disable parallel tool execution', () => {
      state.setParallelToolExecution(true);
      state.setParallelToolExecution(false);

      expect(state.isParallelToolExecutionEnabled()).toBe(false);
    });

    it('should emit parallel:changed event', () => {
      const handler = jest.fn();
      state.on('parallel:changed', handler);

      state.setParallelToolExecution(true);

      expect(handler).toHaveBeenCalledWith(true);
    });
  });

  describe('RAG Tool Selection Methods', () => {
    it('should initially have RAG tool selection disabled', () => {
      expect(state.isRAGToolSelectionEnabled()).toBe(false);
    });

    it('should enable RAG tool selection', () => {
      state.setRAGToolSelection(true);

      expect(state.isRAGToolSelectionEnabled()).toBe(true);
    });

    it('should disable RAG tool selection', () => {
      state.setRAGToolSelection(true);
      state.setRAGToolSelection(false);

      expect(state.isRAGToolSelectionEnabled()).toBe(false);
    });

    it('should emit rag:changed event', () => {
      const handler = jest.fn();
      state.on('rag:changed', handler);

      state.setRAGToolSelection(true);

      expect(handler).toHaveBeenCalledWith(true);
    });

    it('should set last tool selection', () => {
      const selection = { tools: ['edit_file', 'bash'] };

      state.setLastToolSelection(selection);

      expect(state.getLastToolSelection()).toBe(selection);
    });

    it('should get null for initial last tool selection', () => {
      expect(state.getLastToolSelection()).toBeNull();
    });
  });

  describe('Abort Control Methods', () => {
    it('should create abort controller', () => {
      const controller = state.createAbortController();

      expect(controller).toBeInstanceOf(AbortController);
      expect(state.getAbortController()).toBe(controller);
    });

    it('should return null for initial abort controller', () => {
      expect(state.getAbortController()).toBeNull();
    });

    it('should abort current operation', () => {
      const controller = state.createAbortController();

      state.abortCurrentOperation();

      expect(controller.signal.aborted).toBe(true);
    });

    it('should emit operation:aborted event on abort', () => {
      const handler = jest.fn();
      state.on('operation:aborted', handler);

      state.createAbortController();
      state.abortCurrentOperation();

      expect(handler).toHaveBeenCalled();
    });

    it('should not throw when aborting without controller', () => {
      expect(() => state.abortCurrentOperation()).not.toThrow();
    });

    it('should clear abort controller', () => {
      state.createAbortController();
      state.clearAbortController();

      expect(state.getAbortController()).toBeNull();
    });

    it('should detect aborted state', () => {
      expect(state.isAborted()).toBe(false);

      state.createAbortController();
      expect(state.isAborted()).toBe(false);

      state.abortCurrentOperation();
      expect(state.isAborted()).toBe(true);
    });

    it('should return false for isAborted when no controller', () => {
      expect(state.isAborted()).toBe(false);
    });
  });

  describe('Cleanup Methods', () => {
    it('should dispose and abort ongoing operations', () => {
      const controller = state.createAbortController();

      state.dispose();

      expect(controller.signal.aborted).toBe(true);
    });

    it('should dispose context manager', () => {
      state.dispose();

      expect(mockContextManagerDispose).toHaveBeenCalled();
    });

    it('should reset session cost', () => {
      state.recordSessionCost(1000, 500, 'grok-3-latest');
      expect(state.getSessionCost()).toBeGreaterThan(0);

      state.dispose();

      expect(state.getSessionCost()).toBe(0);
    });

    it('should clear last tool selection', () => {
      state.setLastToolSelection({ tools: ['edit_file'] });
      expect(state.getLastToolSelection()).not.toBeNull();

      state.dispose();

      expect(state.getLastToolSelection()).toBeNull();
    });

    it('should clear abort controller', () => {
      state.createAbortController();
      expect(state.getAbortController()).not.toBeNull();

      state.dispose();

      expect(state.getAbortController()).toBeNull();
    });

    it('should emit disposed event', () => {
      const handler = jest.fn();
      state.on('disposed', handler);

      state.dispose();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Default Agent Config', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_AGENT_CONFIG.maxToolRounds).toBe(50);
      expect(DEFAULT_AGENT_CONFIG.sessionCostLimit).toBe(10);
      expect(DEFAULT_AGENT_CONFIG.yoloMode).toBe(false);
      expect(DEFAULT_AGENT_CONFIG.parallelToolExecution).toBe(false);
      expect(DEFAULT_AGENT_CONFIG.ragToolSelection).toBe(false);
      expect(DEFAULT_AGENT_CONFIG.selfHealing).toBe(true);
    });
  });

  describe('YOLO Config', () => {
    it('should have correct YOLO values', () => {
      expect(YOLO_CONFIG.maxToolRounds).toBe(400);
      expect(YOLO_CONFIG.sessionCostLimit).toBe(Infinity);
      expect(YOLO_CONFIG.yoloMode).toBe(true);
    });
  });

  describe('Event Emitter Behavior', () => {
    it('should support multiple event listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      state.on('config:updated', handler1);
      state.on('config:updated', handler2);

      state.updateConfig({ maxToolRounds: 100 });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should support once listeners', () => {
      const handler = jest.fn();

      state.once('config:updated', handler);

      state.updateConfig({ maxToolRounds: 100 });
      state.updateConfig({ maxToolRounds: 200 });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support removing listeners', () => {
      const handler = jest.fn();

      state.on('config:updated', handler);
      state.off('config:updated', handler);

      state.updateConfig({ maxToolRounds: 100 });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('State Mutations Integrity', () => {
    it('should maintain consistent state after multiple mutations', () => {
      // Apply multiple mutations
      state.setYoloMode(true);
      state.setParallelToolExecution(true);
      state.setRAGToolSelection(true);
      state.setSessionCostLimit(100);
      state.setMaxToolRounds(500);

      const config = state.getConfig();

      expect(config.yoloMode).toBe(true);
      expect(config.parallelToolExecution).toBe(true);
      expect(config.ragToolSelection).toBe(true);
      expect(config.sessionCostLimit).toBe(100);
      expect(config.maxToolRounds).toBe(500);
    });

    it('should emit events in correct order', () => {
      const events: string[] = [];

      state.on('config:updated', () => events.push('config:updated'));
      state.on('yolo:changed', () => events.push('yolo:changed'));

      state.setYoloMode(true);

      expect(events).toContain('config:updated');
      expect(events).toContain('yolo:changed');
      expect(events.indexOf('config:updated')).toBeLessThan(events.indexOf('yolo:changed'));
    });

    it('should handle rapid state changes', () => {
      for (let i = 0; i < 100; i++) {
        state.setMaxToolRounds(i);
      }

      expect(state.getMaxToolRounds()).toBe(99);
    });

    it('should handle toggling YOLO mode multiple times', () => {
      for (let i = 0; i < 10; i++) {
        state.setYoloMode(true);
        expect(state.isYoloModeEnabled()).toBe(true);

        state.setYoloMode(false);
        expect(state.isYoloModeEnabled()).toBe(false);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty config update', () => {
      const originalConfig = state.getConfig();

      state.updateConfig({});

      expect(state.getConfig()).toEqual(originalConfig);
    });

    it('should handle very large session cost limit', () => {
      state.setSessionCostLimit(Number.MAX_SAFE_INTEGER);

      expect(state.getSessionCostLimit()).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle zero session cost limit', () => {
      state.setSessionCostLimit(0);

      expect(state.getSessionCostLimit()).toBe(0);
      expect(state.isSessionCostLimitReached()).toBe(true);
    });

    it('should handle empty chat history for session save', () => {
      state.saveCurrentSession([]);

      expect(mockUpdateCurrentSession).toHaveBeenCalledWith([]);
    });

    it('should handle empty messages for context stats', () => {
      const formatted = state.formatContextStats([]);

      expect(formatted).toContain('Context:');
    });

    it('should handle multiple abort controllers', () => {
      const controller1 = state.createAbortController();
      const controller2 = state.createAbortController();

      expect(state.getAbortController()).toBe(controller2);
      expect(state.getAbortController()).not.toBe(controller1);

      state.abortCurrentOperation();

      expect(controller2.signal.aborted).toBe(true);
      // First controller is replaced, its abort state depends on implementation
    });

    it('should handle dispose called multiple times', () => {
      state.dispose();

      // Second dispose should not throw
      expect(() => state.dispose()).not.toThrow();
    });
  });
});
