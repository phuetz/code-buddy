/**
 * Agent Infrastructure Tests
 *
 * Tests for the AgentInfrastructure class that encapsulates
 * all agent dependencies.
 */

import { EventEmitter } from 'events';
import {
  AgentInfrastructure,
  createTestInfrastructure,
  type AgentInfrastructureDeps,
  type AgentInfrastructureConfig,
} from '../../src/agent/infrastructure/index.js';
import type { IServiceContainer } from '../../src/infrastructure/types.js';

describe('AgentInfrastructure', () => {
  // Mock implementations - use 'as unknown as' to bypass strict type checking
  const createMockContainer = (): IServiceContainer => ({
    settings: {
      loadUserSettings: jest.fn().mockReturnValue({}),
      saveUserSettings: jest.fn(),
      getCurrentModel: jest.fn().mockReturnValue('grok-code-fast-1'),
      setCurrentModel: jest.fn(),
      getApiKey: jest.fn().mockReturnValue('test-key'),
      getBaseURL: jest.fn().mockReturnValue('https://api.x.ai/v1'),
      getSecurityMode: jest.fn().mockReturnValue('suggest'),
      setSecurityMode: jest.fn(),
      getSessionCostLimit: jest.fn().mockReturnValue(10),
      setSessionCostLimit: jest.fn(),
      isAutoApproveEnabled: jest.fn().mockReturnValue(false),
      setAutoApprove: jest.fn(),
      resetToDefaults: jest.fn(),
    } as unknown as IServiceContainer['settings'],
    checkpoints: {
      createCheckpoint: jest.fn(),
      getCheckpoints: jest.fn().mockReturnValue([]),
      rewindToLast: jest.fn().mockReturnValue({ success: true }),
      restoreCheckpoint: jest.fn().mockReturnValue({ success: true }),
      clearOldCheckpoints: jest.fn(),
      formatCheckpointList: jest.fn().mockReturnValue('No checkpoints'),
    } as unknown as IServiceContainer['checkpoints'],
    sessions: {
      createSession: jest.fn().mockReturnValue('session-1'),
      getSession: jest.fn(),
      updateCurrentSession: jest.fn(),
      getCurrentSessionId: jest.fn().mockReturnValue('session-1'),
      deleteSession: jest.fn(),
      listSessions: jest.fn().mockReturnValue([]),
      formatSessionList: jest.fn().mockReturnValue('No sessions'),
      exportSessionToFile: jest.fn(),
    } as unknown as IServiceContainer['sessions'],
    costs: {
      recordUsage: jest.fn().mockReturnValue({ inputTokens: 0, outputTokens: 0 }),
      calculateCost: jest.fn().mockReturnValue(0),
      getReport: jest.fn().mockReturnValue({ totalCost: 0 }),
      getSessionCost: jest.fn().mockReturnValue(0),
      resetSession: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    } as unknown as IServiceContainer['costs'],
  });

  const createMockDeps = (
    containerOverrides: Partial<IServiceContainer> = {}
  ): AgentInfrastructureDeps => {
    const container = {
      ...createMockContainer(),
      ...containerOverrides,
    };

    return {
      container,
      tokenCounter: {
        dispose: jest.fn(),
        countTokens: jest.fn().mockReturnValue(100),
      } as unknown as AgentInfrastructureDeps['tokenCounter'],
      contextManager: {
        dispose: jest.fn(),
        getStats: jest.fn().mockReturnValue({
          totalTokens: 1000,
          maxTokens: 8000,
          usagePercent: 12.5,
        }),
      } as unknown as AgentInfrastructureDeps['contextManager'],
      modeManager: {
        getMode: jest.fn().mockReturnValue('code'),
        setMode: jest.fn(),
        formatModeStatus: jest.fn().mockReturnValue('Mode: code'),
        isToolAllowed: jest.fn().mockReturnValue(true),
      } as unknown as AgentInfrastructureDeps['modeManager'],
      sandboxManager: {
        formatStatus: jest.fn().mockReturnValue('Sandbox: enabled'),
        validateCommand: jest.fn().mockReturnValue({ valid: true }),
      } as unknown as AgentInfrastructureDeps['sandboxManager'],
      mcpClient: {
        connectAll: jest.fn().mockResolvedValue(undefined),
        formatStatus: jest.fn().mockReturnValue('MCP: connected'),
        getAllTools: jest.fn().mockResolvedValue(new Map()),
      } as unknown as AgentInfrastructureDeps['mcpClient'],
      promptCacheManager: {
        getStats: jest.fn().mockReturnValue({ hits: 0, misses: 0 }),
        formatStats: jest.fn().mockReturnValue('Cache: 0 hits'),
      } as unknown as AgentInfrastructureDeps['promptCacheManager'],
      hooksManager: {
        formatStatus: jest.fn().mockReturnValue('Hooks: 0 registered'),
      } as unknown as AgentInfrastructureDeps['hooksManager'],
      modelRouter: {
        getTotalCost: jest.fn().mockReturnValue(0.05),
        getEstimatedSavings: jest.fn().mockReturnValue({ saved: 0.01, percentage: 20 }),
        getUsageStats: jest.fn().mockReturnValue(new Map([['grok-code-fast-1', 10]])),
      } as unknown as AgentInfrastructureDeps['modelRouter'],
      marketplace: {
        listPlugins: jest.fn().mockReturnValue([]),
      } as unknown as AgentInfrastructureDeps['marketplace'],
      repairCoordinator: {
        dispose: jest.fn(),
        on: jest.fn(),
      } as unknown as AgentInfrastructureDeps['repairCoordinator'],
    };
  };

  describe('constructor', () => {
    it('should create instance with dependencies', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra).toBeInstanceOf(AgentInfrastructure);
      expect(infra).toBeInstanceOf(EventEmitter);
    });

    it('should use default config values', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.memoryEnabled).toBe(true);
      expect(infra.useModelRouting).toBe(false);
    });

    it('should accept custom config', () => {
      const deps = createMockDeps();
      const config: AgentInfrastructureConfig = {
        memoryEnabled: false,
        useModelRouting: true,
      };
      const infra = new AgentInfrastructure(deps, config);

      expect(infra.memoryEnabled).toBe(false);
      expect(infra.useModelRouting).toBe(true);
    });
  });

  describe('service accessors', () => {
    it('should provide access to settings', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.settings).toBe(deps.container.settings);
    });

    it('should provide access to checkpoints', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.checkpoints).toBe(deps.container.checkpoints);
    });

    it('should provide access to sessions', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.sessions).toBe(deps.container.sessions);
    });

    it('should provide access to costs', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.costs).toBe(deps.container.costs);
    });
  });

  describe('infrastructure accessors', () => {
    it('should provide access to tokenCounter', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.tokenCounter).toBe(deps.tokenCounter);
    });

    it('should provide access to contextManager', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.contextManager).toBe(deps.contextManager);
    });

    it('should provide access to modeManager', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.modeManager).toBe(deps.modeManager);
    });

    it('should provide access to sandboxManager', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.sandboxManager).toBe(deps.sandboxManager);
    });

    it('should provide access to mcpClient', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.mcpClient).toBe(deps.mcpClient);
    });

    it('should provide access to promptCacheManager', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.promptCacheManager).toBe(deps.promptCacheManager);
    });

    it('should provide access to hooksManager', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.hooksManager).toBe(deps.hooksManager);
    });

    it('should provide access to modelRouter', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.modelRouter).toBe(deps.modelRouter);
    });

    it('should provide access to marketplace', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.marketplace).toBe(deps.marketplace);
    });

    it('should provide access to repairCoordinator', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.repairCoordinator).toBe(deps.repairCoordinator);
    });
  });

  describe('memory system', () => {
    it('should report memory enabled status', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { memoryEnabled: true });

      expect(infra.memoryEnabled).toBe(true);
    });

    it('should allow toggling memory', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { memoryEnabled: true });

      infra.setMemoryEnabled(false);
      expect(infra.memoryEnabled).toBe(false);
    });

    it('should return null stats when memory disabled', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { memoryEnabled: false });

      expect(infra.getMemoryStats()).toBeNull();
    });

    it('should format memory status when disabled', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { memoryEnabled: false });

      expect(infra.formatMemoryStatus()).toBe('🧠 Memory: Disabled');
    });

    it('should return empty array for recall when disabled', async () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { memoryEnabled: false });

      const result = await infra.recall('test');
      expect(result).toEqual([]);
    });

    it('should return empty string for memory context when disabled', async () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { memoryEnabled: false });

      const result = await infra.getMemoryContext();
      expect(result).toBe('');
    });

    it('should throw when remembering with memory disabled', async () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { memoryEnabled: false });

      await expect(infra.remember('fact', 'test content')).rejects.toThrow(
        'Memory system is disabled'
      );
    });
  });

  describe('model routing', () => {
    it('should report model routing status', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { useModelRouting: true });

      expect(infra.useModelRouting).toBe(true);
    });

    it('should allow toggling model routing', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { useModelRouting: false });

      infra.setModelRouting(true);
      expect(infra.useModelRouting).toBe(true);
    });

    it('should track last routing decision', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps);

      expect(infra.lastRoutingDecision).toBeNull();

      const decision = {
        recommendedModel: 'grok-code-fast-1',
        reason: 'Simple task',
        confidence: 0.9,
        estimatedCost: 0.001,
        tier: 'mini' as const,
      };
      infra.setLastRoutingDecision(decision as unknown as Parameters<typeof infra.setLastRoutingDecision>[0]);

      expect(infra.lastRoutingDecision).toEqual(decision);
    });

    it('should provide model routing stats', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { useModelRouting: true });

      const stats = infra.getModelRoutingStats();

      expect(stats.enabled).toBe(true);
      expect(stats.totalCost).toBe(0.05);
      expect(stats.savings).toEqual({ saved: 0.01, percentage: 20 });
      expect(stats.usageByModel).toEqual({ 'grok-code-fast-1': 10 });
    });

    it('should format model routing stats', () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { useModelRouting: true });

      const formatted = infra.formatModelRoutingStats();

      expect(formatted).toContain('🧭 Model Routing Statistics');
      expect(formatted).toContain('Enabled: ✅');
      expect(formatted).toContain('Total Cost: $0.0500');
    });
  });

  describe('dispose', () => {
    it('should dispose all resources', async () => {
      const deps = createMockDeps();
      const infra = new AgentInfrastructure(deps, { memoryEnabled: false });

      const disposeHandler = jest.fn();
      infra.on('disposed', disposeHandler);

      await infra.dispose();

      expect(deps.tokenCounter.dispose).toHaveBeenCalled();
      expect(deps.contextManager.dispose).toHaveBeenCalled();
      expect(deps.repairCoordinator.dispose).toHaveBeenCalled();
      expect(disposeHandler).toHaveBeenCalled();
    });
  });

  describe('createTestInfrastructure', () => {
    it('should create infrastructure with mock dependencies', () => {
      const infra = createTestInfrastructure();

      expect(infra).toBeInstanceOf(AgentInfrastructure);
      expect(infra.memoryEnabled).toBe(false);
    });

    it('should allow partial overrides', () => {
      const customModeManager = {
        getMode: jest.fn().mockReturnValue('architect'),
      } as unknown as AgentInfrastructureDeps['modeManager'];

      const infra = createTestInfrastructure({
        modeManager: customModeManager,
      });

      expect(infra.modeManager.getMode()).toBe('architect');
    });

    it('should allow custom config', () => {
      const infra = createTestInfrastructure({}, { useModelRouting: true });

      expect(infra.useModelRouting).toBe(true);
    });
  });
});
