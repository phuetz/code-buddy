/**
 * Service Container - Dependency Injection
 *
 * Replaces the Service Locator pattern with a centralized container
 * that manages all core service instances.
 *
 * Benefits:
 * - Explicit dependencies (no hidden singletons)
 * - Easier testing (inject mocks)
 * - Single point of initialization
 * - Type-safe service access
 */

import type {
  IServiceContainer,
  IServiceContainerConfig,
  ISettingsManager,
  ICheckpointManager,
  ISessionStore,
  ICostTracker,
} from './types.js';

// ============================================================================
// Service Container Implementation
// ============================================================================

/**
 * ServiceContainer - Central registry for all application services
 *
 * Usage:
 * ```typescript
 * // Get the container
 * const container = ServiceContainer.create();
 *
 * // Access services
 * const settings = container.settings;
 * const checkpoints = container.checkpoints;
 *
 * // For testing, inject mocks
 * const testContainer = ServiceContainer.createWithConfig({
 *   settings: mockSettingsManager,
 *   checkpoints: mockCheckpointManager,
 * });
 * ```
 */
export class ServiceContainer implements IServiceContainer {
  private static instance: ServiceContainer | null = null;

  /**
   * Private constructor - use static factory methods
   */
  private constructor(
    public readonly settings: ISettingsManager,
    public readonly checkpoints: ICheckpointManager,
    public readonly sessions: ISessionStore,
    public readonly costs: ICostTracker,
  ) {}

  /**
   * Create or get the singleton ServiceContainer instance
   * Uses lazy initialization to load services on demand
   */
  static create(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = ServiceContainer.createDefault();
    }
    return ServiceContainer.instance;
  }

  /**
   * Create a ServiceContainer with custom configuration
   * Useful for testing or custom service implementations
   */
  static createWithConfig(config: IServiceContainerConfig): ServiceContainer {
    return new ServiceContainer(
      config.settings ?? ServiceContainer.createSettingsManager(),
      config.checkpoints ?? ServiceContainer.createCheckpointManager(),
      config.sessions ?? ServiceContainer.createSessionStore(),
      config.costs ?? ServiceContainer.createCostTracker(),
    );
  }

  /**
   * Create a fresh ServiceContainer with default services
   * Does not affect the singleton instance
   */
  static createDefault(): ServiceContainer {
    return new ServiceContainer(
      ServiceContainer.createSettingsManager(),
      ServiceContainer.createCheckpointManager(),
      ServiceContainer.createSessionStore(),
      ServiceContainer.createCostTracker(),
    );
  }

  /**
   * Reset the singleton instance
   * Useful for testing or reinitializing services
   */
  static reset(): void {
    ServiceContainer.instance = null;
  }

  /**
   * Check if singleton instance exists
   */
  static hasInstance(): boolean {
    return ServiceContainer.instance !== null;
  }

  /**
   * Set a custom container as the singleton
   * Useful for testing
   */
  static setInstance(container: ServiceContainer): void {
    ServiceContainer.instance = container;
  }

  // ============================================================================
  // Factory Methods for Individual Services
  // ============================================================================

  /**
   * Create SettingsManager instance
   * Uses the existing singleton implementation for compatibility
   */
  private static createSettingsManager(): ISettingsManager {
    // Lazy import to avoid circular dependencies
     
    const { getSettingsManager } = require('../utils/settings-manager.js');
    return getSettingsManager();
  }

  /**
   * Create CheckpointManager instance
   */
  private static createCheckpointManager(): ICheckpointManager {
     
    const { getCheckpointManager } = require('../checkpoints/checkpoint-manager.js');
    return getCheckpointManager();
  }

  /**
   * Create SessionStore instance
   */
  private static createSessionStore(): ISessionStore {
     
    const { getSessionStore } = require('../persistence/session-store.js');
    return getSessionStore();
  }

  /**
   * Create CostTracker instance
   */
  private static createCostTracker(): ICostTracker {
     
    const { getCostTracker } = require('../utils/cost-tracker.js');
    return getCostTracker();
  }
}

// ============================================================================
// Compatibility Functions
// ============================================================================

/**
 * Get the ServiceContainer singleton
 * Convenience function for easier access
 */
export function getServiceContainer(): IServiceContainer {
  return ServiceContainer.create();
}

/**
 * Create a test container with mock services
 * @param mocks - Partial mock implementations
 */
export function createTestContainer(mocks: Partial<IServiceContainerConfig> = {}): ServiceContainer {
  // Create minimal mock implementations for missing services
  const defaultMocks: IServiceContainerConfig = {
    settings: mocks.settings ?? createMockSettingsManager(),
    checkpoints: mocks.checkpoints ?? createMockCheckpointManager(),
    sessions: mocks.sessions ?? createMockSessionStore(),
    costs: mocks.costs ?? createMockCostTracker(),
  };

  return ServiceContainer.createWithConfig(defaultMocks);
}

// ============================================================================
// Mock Factory Functions (for testing)
// ============================================================================

function createMockSettingsManager(): ISettingsManager {
  return {
    // User settings
    loadUserSettings: () => ({ model: 'grok-test' }),
    saveUserSettings: () => {},
    updateUserSetting: () => {},
    getUserSetting: () => undefined as never,
    // Project settings
    loadProjectSettings: () => ({ model: 'grok-test' }),
    saveProjectSettings: () => {},
    updateProjectSetting: () => {},
    getProjectSetting: () => undefined as never,
    // Convenience methods
    getCurrentModel: () => 'grok-test',
    setCurrentModel: () => {},
    getAvailableModels: () => ['grok-test'],
    getApiKey: () => 'test-api-key',
    getBaseURL: () => 'https://test.api.com',
  };
}

function createMockCheckpointManager(): ICheckpointManager {
  const { EventEmitter } = require('events');
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    createCheckpoint: () => ({ id: 'test', timestamp: new Date(), description: '', files: [], workingDirectory: '' }),
    checkpointBeforeEdit: () => ({ id: 'test', timestamp: new Date(), description: '', files: [], workingDirectory: '' }),
    restoreCheckpoint: () => true,
    getCheckpoints: () => [],
    getCheckpoint: () => undefined,
    clearCheckpoints: () => {},
    clearOldCheckpoints: () => {},
    rewindToLast: () => ({ success: true, restored: [], errors: [] }),
    formatCheckpointList: () => 'No checkpoints',
  });
}

function createMockSessionStore(): ISessionStore {
  return {
    createSession: (name: string, model: string) => ({
      id: 'test',
      name,
      workingDirectory: process.cwd(),
      model,
      messages: [],
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }),
    getCurrentSession: () => null,
    getCurrentSessionId: () => null,
    setCurrentSession: () => true,
    listSessions: () => [],
    getSession: () => null,
    deleteSession: () => true,
    addMessage: () => {},
    updateCurrentSession: () => {},
    formatSessionList: () => 'No sessions',
    exportSessionToFile: () => null,
  };
}

function createMockCostTracker(): ICostTracker {
  const { EventEmitter } = require('events');
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    recordUsage: () => ({ inputTokens: 0, outputTokens: 0, model: 'test', timestamp: new Date(), cost: 0 }),
    calculateCost: () => 0,
    getReport: () => ({
      sessionCost: 0,
      dailyCost: 0,
      weeklyCost: 0,
      monthlyCost: 0,
      totalCost: 0,
      sessionTokens: { input: 0, output: 0 },
      modelBreakdown: {},
      recentUsage: [],
    }),
    resetSession: () => {},
    clearHistory: () => {},
    setBudgetLimit: () => {},
    setDailyLimit: () => {},
    exportToCsv: () => '',
    formatDashboard: () => '',
    dispose: () => {},
  });
}
