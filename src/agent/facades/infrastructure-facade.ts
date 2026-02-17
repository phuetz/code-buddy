/**
 * Infrastructure Facade
 *
 * Encapsulates infrastructure services management.
 * This facade handles:
 * - MCP (Model Context Protocol) servers
 * - Sandbox management for command execution
 * - Lifecycle hooks
 * - Prompt cache management
 * - Plugin marketplace
 */

import type { MCPClient } from '../../mcp/mcp-client.js';
import type { SandboxManager } from '../../security/sandbox.js';
import type { HooksManager } from '../../hooks/lifecycle-hooks.js';
import type { PromptCacheManager } from '../../optimization/prompt-cache.js';
import type { PluginMarketplace } from '../../plugins/marketplace.js';
import { loadMCPConfig } from '../../mcp/config.js';
import { initializeMCPServers } from '../../codebuddy/tools.js';
import { getErrorMessage } from '../../errors/index.js';
import { logger } from '../../utils/logger.js';
import { ICMBridge } from '../../memory/icm-bridge.js';
import { getConfigManager } from '../../config/toml-config.js';

/**
 * Command validation result
 */
export interface CommandValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Prompt cache statistics
 */
export interface PromptCacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalTokensSaved: number;
  estimatedCostSaved: number;
  entries: number;
}

/**
 * Dependencies required by InfrastructureFacade
 */
export interface InfrastructureFacadeDeps {
  mcpClient: MCPClient;
  sandboxManager: SandboxManager;
  hooksManager: HooksManager;
  promptCacheManager: PromptCacheManager;
  marketplace: PluginMarketplace;
}

/**
 * Facade for infrastructure services in agents.
 *
 * Responsibilities:
 * - Managing MCP server connections and tools
 * - Validating commands through sandbox
 * - Managing lifecycle hooks
 * - Prompt caching operations
 * - Plugin marketplace access
 */
export class InfrastructureFacade {
  private readonly mcpClient: MCPClient;
  private readonly sandboxManager: SandboxManager;
  private readonly hooksManager: HooksManager;
  private readonly promptCacheManager: PromptCacheManager;
  private readonly marketplace: PluginMarketplace;
  private readonly icmBridge: ICMBridge;

  constructor(deps: InfrastructureFacadeDeps) {
    this.mcpClient = deps.mcpClient;
    this.sandboxManager = deps.sandboxManager;
    this.hooksManager = deps.hooksManager;
    this.promptCacheManager = deps.promptCacheManager;
    this.marketplace = deps.marketplace;
    this.icmBridge = new ICMBridge();
  }

  // ============================================================================
  // MCP Management
  // ============================================================================

  /**
   * Connect to all configured MCP servers
   */
  async connectMCPServers(): Promise<void> {
    await this.mcpClient.connectAll();
  }

  /**
   * Get MCP connection status as formatted string
   */
  getMCPStatus(): string {
    return this.mcpClient.formatStatus();
  }

  /**
   * Get all tools from connected MCP servers
   */
  async getMCPTools(): Promise<Map<string, unknown[]>> {
    return this.mcpClient.getAllTools();
  }

  /**
   * Get the MCP client instance (for advanced operations)
   */
  getMCPClient(): MCPClient {
    return this.mcpClient;
  }

  /**
   * Initialize MCP servers asynchronously
   * This is a fire-and-forget operation
   */
  initializeMCP(): void {
    (async () => {
      try {
        const config = loadMCPConfig();
        if (config.servers.length > 0) {
          await initializeMCPServers();
        }

        // Initialize ICM bridge if enabled
        const buddyConfig = getConfigManager().getConfig();
        if (buddyConfig.integrations?.icm_enabled && this.mcpClient) {
          await this.icmBridge.initialize(this.mcpClient as unknown as import('../../memory/icm-bridge.js').MCPToolCaller);
        }
      } catch (error) {
        logger.warn('MCP initialization failed', { error: getErrorMessage(error) });
      }
    })().catch((error) => {
      logger.warn('Uncaught error in MCP initialization', { error: getErrorMessage(error) });
    });
  }

  /**
   * Get the ICM bridge instance for memory operations
   */
  getICMBridge(): ICMBridge {
    return this.icmBridge;
  }

  // ============================================================================
  // Sandbox Management
  // ============================================================================

  /**
   * Get sandbox status as formatted string
   */
  getSandboxStatus(): string {
    return this.sandboxManager.formatStatus();
  }

  /**
   * Validate a command against sandbox rules
   */
  validateCommand(command: string): CommandValidation {
    return this.sandboxManager.validateCommand(command);
  }

  /**
   * Get the sandbox manager instance (for advanced operations)
   */
  getSandboxManager(): SandboxManager {
    return this.sandboxManager;
  }

  // ============================================================================
  // Lifecycle Hooks
  // ============================================================================

  /**
   * Get the hooks manager instance
   */
  getHooksManager(): HooksManager {
    return this.hooksManager;
  }

  /**
   * Get hooks status as formatted string
   */
  getHooksStatus(): string {
    return this.hooksManager.formatStatus();
  }

  // ============================================================================
  // Prompt Cache
  // ============================================================================

  /**
   * Get the prompt cache manager instance
   */
  getPromptCacheManager(): PromptCacheManager {
    return this.promptCacheManager;
  }

  /**
   * Get prompt cache statistics
   */
  getPromptCacheStats(): PromptCacheStats {
    return this.promptCacheManager.getStats();
  }

  /**
   * Format prompt cache statistics as string
   */
  formatPromptCacheStats(): string {
    return this.promptCacheManager.formatStats();
  }

  // ============================================================================
  // Plugin Marketplace
  // ============================================================================

  /**
   * Get the plugin marketplace instance
   */
  getMarketplace(): PluginMarketplace {
    return this.marketplace;
  }
}
