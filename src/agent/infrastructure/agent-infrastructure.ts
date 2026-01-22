/**
 * Agent Infrastructure
 *
 * Encapsulates all infrastructure dependencies for agents.
 * Extracts the 15+ managers from BaseAgent to reduce the God Object anti-pattern.
 *
 * Benefits:
 * - Single Responsibility: Infrastructure concerns separated from agent logic
 * - Testability: Easy to mock infrastructure for unit tests
 * - Dependency Injection: Clear dependencies via constructor
 * - Lazy Loading: Heavy resources loaded on-demand
 */

import { EventEmitter } from 'events';
import type { IServiceContainer } from '../../infrastructure/types.js';
import type { TokenCounter } from '../../utils/token-counter.js';
import type { ContextManagerV2 } from '../../context/context-manager-v2.js';
import type { AgentModeManager } from '../agent-mode.js';
import type { SandboxManager } from '../../security/sandbox.js';
import type { MCPClient } from '../../mcp/mcp-client.js';
import type { PromptCacheManager } from '../../optimization/prompt-cache.js';
import type { HooksManager } from '../../hooks/lifecycle-hooks.js';
import type { ModelRouter, RoutingDecision } from '../../optimization/model-routing.js';
import type { PluginMarketplace } from '../../plugins/marketplace.js';
import type { RepairCoordinator } from '../execution/repair-coordinator.js';
import type { EnhancedMemory, MemoryEntry, MemoryType } from '../../memory/index.js';
import { getEnhancedMemory } from '../../memory/index.js';
import { logger } from '../../utils/logger.js';
import { getErrorMessage } from '../../types/errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Required dependencies for AgentInfrastructure
 */
export interface AgentInfrastructureDeps {
  /** Service container with core services */
  container: IServiceContainer;
  /** Token counter for the model */
  tokenCounter: TokenCounter;
  /** Context manager for message history */
  contextManager: ContextManagerV2;
  /** Agent mode manager */
  modeManager: AgentModeManager;
  /** Sandbox manager for security */
  sandboxManager: SandboxManager;
  /** MCP client for tool servers */
  mcpClient: MCPClient;
  /** Prompt cache manager */
  promptCacheManager: PromptCacheManager;
  /** Lifecycle hooks manager */
  hooksManager: HooksManager;
  /** Model router for optimization */
  modelRouter: ModelRouter;
  /** Plugin marketplace */
  marketplace: PluginMarketplace;
  /** Repair coordinator for auto-fix */
  repairCoordinator: RepairCoordinator;
}

/**
 * Optional configuration for AgentInfrastructure
 */
export interface AgentInfrastructureConfig {
  /** Enable memory system (default: true) */
  memoryEnabled?: boolean;
  /** Enable model routing (default: false) */
  useModelRouting?: boolean;
}

/**
 * Memory context options
 */
export interface MemoryContextOptions {
  query?: string;
  includePreferences?: boolean;
  includeProject?: boolean;
  includeRecentSummaries?: boolean;
}

// ============================================================================
// AgentInfrastructure Class
// ============================================================================

/**
 * Encapsulates all infrastructure dependencies for agents.
 *
 * This class manages:
 * - Core services via IServiceContainer (settings, checkpoints, sessions, costs)
 * - Token counting and context management
 * - Agent modes and sandbox security
 * - MCP servers and plugins
 * - Memory system
 * - Model routing optimization
 */
export class AgentInfrastructure extends EventEmitter {
  private readonly deps: AgentInfrastructureDeps;
  private readonly config: Required<AgentInfrastructureConfig>;

  // Memory system (lazy-loaded)
  private _memory: EnhancedMemory | null = null;

  // Model routing state
  private _lastRoutingDecision: RoutingDecision | null = null;

  constructor(
    deps: AgentInfrastructureDeps,
    config: AgentInfrastructureConfig = {}
  ) {
    super();
    this.deps = deps;
    this.config = {
      memoryEnabled: config.memoryEnabled ?? true,
      useModelRouting: config.useModelRouting ?? false,
    };
  }

  // ============================================================================
  // Core Service Accessors (from IServiceContainer)
  // ============================================================================

  /** Settings manager */
  get settings() {
    return this.deps.container.settings;
  }

  /** Checkpoint manager */
  get checkpoints() {
    return this.deps.container.checkpoints;
  }

  /** Session store */
  get sessions() {
    return this.deps.container.sessions;
  }

  /** Cost tracker */
  get costs() {
    return this.deps.container.costs;
  }

  // ============================================================================
  // Infrastructure Accessors
  // ============================================================================

  /** Token counter */
  get tokenCounter() {
    return this.deps.tokenCounter;
  }

  /** Context manager */
  get contextManager() {
    return this.deps.contextManager;
  }

  /** Mode manager */
  get modeManager() {
    return this.deps.modeManager;
  }

  /** Sandbox manager */
  get sandboxManager() {
    return this.deps.sandboxManager;
  }

  /** MCP client */
  get mcpClient() {
    return this.deps.mcpClient;
  }

  /** Prompt cache manager */
  get promptCacheManager() {
    return this.deps.promptCacheManager;
  }

  /** Hooks manager */
  get hooksManager() {
    return this.deps.hooksManager;
  }

  /** Model router */
  get modelRouter() {
    return this.deps.modelRouter;
  }

  /** Plugin marketplace */
  get marketplace() {
    return this.deps.marketplace;
  }

  /** Repair coordinator */
  get repairCoordinator() {
    return this.deps.repairCoordinator;
  }

  // ============================================================================
  // Memory System
  // ============================================================================

  /**
   * Lazy-loaded memory system
   */
  get memory(): EnhancedMemory {
    if (!this._memory) {
      this._memory = getEnhancedMemory({
        enabled: this.config.memoryEnabled,
        embeddingEnabled: true,
        useSQLite: true,
        maxMemories: 10000,
        autoSummarize: true,
      });

      // Set project context
      const cwd = process.cwd();
      if (cwd) {
        this._memory.setProjectContext(cwd).catch(err => {
          logger.warn('Failed to set project context for memory', {
            error: getErrorMessage(err),
          });
        });
      }
    }
    return this._memory;
  }

  /** Check if memory is enabled */
  get memoryEnabled(): boolean {
    return this.config.memoryEnabled;
  }

  /** Enable/disable memory */
  setMemoryEnabled(enabled: boolean): void {
    (this.config as AgentInfrastructureConfig).memoryEnabled = enabled;
    if (!enabled && this._memory) {
      this._memory.dispose();
      this._memory = null;
    }
  }

  /**
   * Store a memory entry
   */
  async remember(
    type: MemoryType,
    content: string,
    options: {
      summary?: string;
      importance?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<MemoryEntry> {
    if (!this.config.memoryEnabled) {
      throw new Error('Memory system is disabled');
    }
    return this.memory.store({
      type,
      content,
      ...options,
    });
  }

  /**
   * Recall memories matching a query
   */
  async recall(
    query?: string,
    options: {
      types?: MemoryType[];
      tags?: string[];
      limit?: number;
      minImportance?: number;
    } = {}
  ): Promise<MemoryEntry[]> {
    if (!this.config.memoryEnabled) {
      return [];
    }
    return this.memory.recall({
      query,
      ...options,
    });
  }

  /**
   * Build memory context for system prompt
   */
  async getMemoryContext(options: MemoryContextOptions = {}): Promise<string> {
    if (!this.config.memoryEnabled) {
      return '';
    }
    return this.memory.buildContext({
      query: options.query,
      includePreferences: options.includePreferences ?? true,
      includeProject: options.includeProject ?? true,
      includeRecentSummaries: options.includeRecentSummaries ?? true,
    });
  }

  /**
   * Store conversation summary
   */
  async storeConversationSummary(
    sessionId: string,
    summary: string,
    topics: string[],
    messageCount: number,
    decisions?: string[]
  ): Promise<void> {
    if (!this.config.memoryEnabled) return;

    await this.memory.storeSummary({
      sessionId,
      summary,
      topics,
      decisions,
      messageCount,
    });
  }

  /**
   * Get memory stats
   */
  getMemoryStats(): {
    totalMemories: number;
    byType: Record<string, number>;
    projects: number;
    summaries: number;
  } | null {
    if (!this.config.memoryEnabled || !this._memory) {
      return null;
    }
    return this.memory.getStats();
  }

  /**
   * Format memory status
   */
  formatMemoryStatus(): string {
    if (!this.config.memoryEnabled) {
      return '🧠 Memory: Disabled';
    }
    if (!this._memory) {
      return '🧠 Memory: Not initialized';
    }
    return this.memory.formatStatus();
  }

  // ============================================================================
  // Model Routing
  // ============================================================================

  /** Check if model routing is enabled */
  get useModelRouting(): boolean {
    return this.config.useModelRouting;
  }

  /** Enable/disable model routing */
  setModelRouting(enabled: boolean): void {
    (this.config as AgentInfrastructureConfig).useModelRouting = enabled;
  }

  /** Get last routing decision */
  get lastRoutingDecision(): RoutingDecision | null {
    return this._lastRoutingDecision;
  }

  /** Set last routing decision */
  setLastRoutingDecision(decision: RoutingDecision): void {
    this._lastRoutingDecision = decision;
  }

  /**
   * Get model routing statistics
   */
  getModelRoutingStats() {
    return {
      enabled: this.config.useModelRouting,
      totalCost: this.modelRouter.getTotalCost(),
      savings: this.modelRouter.getEstimatedSavings(),
      usageByModel: Object.fromEntries(this.modelRouter.getUsageStats()),
      lastDecision: this._lastRoutingDecision,
    };
  }

  /**
   * Format model routing stats
   */
  formatModelRoutingStats(): string {
    const stats = this.getModelRoutingStats();
    const lines = [
      '🧭 Model Routing Statistics',
      `├─ Enabled: ${stats.enabled ? '✅' : '❌'}`,
      `├─ Total Cost: $${stats.totalCost.toFixed(4)}`,
      `├─ Savings: $${stats.savings.saved.toFixed(4)} (${stats.savings.percentage.toFixed(1)}%)`,
    ];

    if (stats.lastDecision) {
      lines.push(`├─ Last Model: ${stats.lastDecision.recommendedModel}`);
      lines.push(`└─ Reason: ${stats.lastDecision.reason}`);
    } else {
      lines.push('└─ No routing decisions yet');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Dispose of all resources
   */
  async dispose(): Promise<void> {
    // Dispose token counter
    if (this.deps.tokenCounter) {
      this.deps.tokenCounter.dispose();
    }

    // Dispose context manager
    if (this.deps.contextManager) {
      this.deps.contextManager.dispose();
    }

    // Dispose repair coordinator
    if (this.deps.repairCoordinator) {
      this.deps.repairCoordinator.dispose();
    }

    // Dispose memory
    if (this._memory) {
      this._memory.dispose();
      this._memory = null;
    }

    this.emit('disposed');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create AgentInfrastructure with default implementations
 *
 * This factory uses the Service Locator pattern internally but returns
 * a properly encapsulated AgentInfrastructure instance.
 */
export async function createAgentInfrastructure(
  apiKey: string,
  model: string,
  baseURL?: string,
  config: AgentInfrastructureConfig = {}
): Promise<AgentInfrastructure> {
  // Lazy imports to avoid circular dependencies
  const { getServiceContainer } = await import('../../infrastructure/service-container.js');
  const { createTokenCounter } = await import('../../utils/token-counter.js');
  const { createContextManager } = await import('../../context/context-manager-v2.js');
  const { getAgentModeManager } = await import('../agent-mode.js');
  const { getSandboxManager } = await import('../../security/sandbox.js');
  const { getMCPClient } = await import('../../mcp/mcp-client.js');
  const { getPromptCacheManager } = await import('../../optimization/prompt-cache.js');
  const { getHooksManager } = await import('../../hooks/lifecycle-hooks.js');
  const { getModelRouter } = await import('../../optimization/model-routing.js');
  const { getPluginMarketplace } = await import('../../plugins/marketplace.js');
  const { getRepairCoordinator } = await import('../execution/repair-coordinator.js');

  const container = getServiceContainer();

  const deps: AgentInfrastructureDeps = {
    container,
    tokenCounter: createTokenCounter(model),
    contextManager: createContextManager(model),
    modeManager: getAgentModeManager(),
    sandboxManager: getSandboxManager(),
    mcpClient: getMCPClient(),
    promptCacheManager: getPromptCacheManager(),
    hooksManager: getHooksManager(process.cwd()),
    modelRouter: getModelRouter(),
    marketplace: getPluginMarketplace(),
    repairCoordinator: getRepairCoordinator(apiKey, baseURL),
  };

  return new AgentInfrastructure(deps, config);
}

/**
 * Create AgentInfrastructure for testing with mock dependencies
 */
export function createTestInfrastructure(
  overrides: Partial<AgentInfrastructureDeps> = {},
  config: AgentInfrastructureConfig = {}
): AgentInfrastructure {
  // Create minimal mock implementations
  const mockContainer = {
    settings: {} as IServiceContainer['settings'],
    checkpoints: {} as IServiceContainer['checkpoints'],
    sessions: {} as IServiceContainer['sessions'],
    costs: {} as IServiceContainer['costs'],
  };

  const mockTokenCounter = {
    dispose: () => {},
  } as unknown as TokenCounter;

  const mockContextManager = {
    dispose: () => {},
  } as unknown as ContextManagerV2;

  const mockModeManager = {} as AgentModeManager;
  const mockSandboxManager = {} as SandboxManager;
  const mockMCPClient = {} as MCPClient;
  const mockPromptCacheManager = {} as PromptCacheManager;
  const mockHooksManager = {} as HooksManager;
  const mockModelRouter = {
    getTotalCost: () => 0,
    getEstimatedSavings: () => ({ saved: 0, percentage: 0 }),
    getUsageStats: () => new Map(),
  } as unknown as ModelRouter;
  const mockMarketplace = {} as PluginMarketplace;
  const mockRepairCoordinator = {
    dispose: () => {},
  } as unknown as RepairCoordinator;

  const deps: AgentInfrastructureDeps = {
    container: mockContainer,
    tokenCounter: mockTokenCounter,
    contextManager: mockContextManager,
    modeManager: mockModeManager,
    sandboxManager: mockSandboxManager,
    mcpClient: mockMCPClient,
    promptCacheManager: mockPromptCacheManager,
    hooksManager: mockHooksManager,
    modelRouter: mockModelRouter,
    marketplace: mockMarketplace,
    repairCoordinator: mockRepairCoordinator,
    ...overrides,
  };

  return new AgentInfrastructure(deps, {
    memoryEnabled: false,
    ...config,
  });
}

/**
 * Create AgentInfrastructure synchronously using singleton getters
 *
 * This is the preferred factory for use in constructors where async
 * initialization isn't possible. Uses the same sync singleton patterns
 * that were previously scattered throughout CodeBuddyAgent.
 */
export function createAgentInfrastructureSync(
  options: {
    apiKey: string;
    model: string;
    baseURL?: string;
    maxContextTokens?: number;
  },
  config: AgentInfrastructureConfig = {}
): AgentInfrastructure {
  // Import singletons synchronously (they use require internally)
   
  const { getServiceContainer } = require('../../infrastructure/service-container.js');
   
  const { createTokenCounter } = require('../../utils/token-counter.js');
   
  const { createContextManager } = require('../../context/context-manager-v2.js');
   
  const { getAgentModeManager } = require('../agent-mode.js');
   
  const { getSandboxManager } = require('../../security/sandbox.js');
   
  const { getMCPClient } = require('../../mcp/mcp-client.js');
   
  const { getPromptCacheManager } = require('../../optimization/prompt-cache.js');
   
  const { getHooksManager } = require('../../hooks/lifecycle-hooks.js');
   
  const { getModelRouter } = require('../../optimization/model-routing.js');
   
  const { getPluginMarketplace } = require('../../plugins/marketplace.js');
   
  const { getRepairCoordinator } = require('../execution/repair-coordinator.js');

  const container = getServiceContainer();

  const deps: AgentInfrastructureDeps = {
    container,
    tokenCounter: createTokenCounter(options.model),
    contextManager: createContextManager(options.model, options.maxContextTokens),
    modeManager: getAgentModeManager(),
    sandboxManager: getSandboxManager(),
    mcpClient: getMCPClient(),
    promptCacheManager: getPromptCacheManager(),
    hooksManager: getHooksManager(process.cwd()),
    modelRouter: getModelRouter(),
    marketplace: getPluginMarketplace(),
    repairCoordinator: getRepairCoordinator(options.apiKey, options.baseURL),
  };

  return new AgentInfrastructure(deps, config);
}
