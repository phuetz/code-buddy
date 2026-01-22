/**
 * Tool Manager
 *
 * Centralized tool management with permissions and configuration (mistral-vibe style).
 * Handles tool discovery, lazy instantiation, and permission checks.
 *
 * Uses TypedEventEmitterAdapter for type-safe events with backward compatibility.
 */

import { getConfigManager, ToolConfig, ToolPermission } from '../config/toml-config.js';
import {
  TypedEventEmitterAdapter,
  ToolEvents,
  ToolRegisteredEvent,
  ToolInstantiatedEvent,
  ToolEvent,
  BaseEvent,
} from '../events/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Base tool interface
 */
export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * Tool result
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool registration info
 */
export interface ToolRegistration {
  /** Tool class constructor */
  factory: () => Tool;
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Default permission level */
  defaultPermission: ToolPermission;
  /** Default timeout in seconds */
  defaultTimeout: number;
  /** Whether tool is read-only (safe for parallel execution) */
  readOnly: boolean;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
}

// ============================================================================
// Tool Manager Events (Extended for local use)
// ============================================================================

/**
 * Extended tool events including execution events
 */
interface ToolManagerEvents extends ToolEvents {
  'tool:executed': ToolEvent;
}

// ============================================================================
// Tool Manager
// ============================================================================

/**
 * Centralized tool manager with type-safe events.
 *
 * Emits the following events:
 * - 'tool:registered' - When a tool is registered
 * - 'tool:instantiated' - When a tool instance is created (lazy)
 * - 'tool:executed' - When a tool is successfully executed
 * - 'tool:error' - When a tool execution fails
 */
export class ToolManager extends TypedEventEmitterAdapter<ToolManagerEvents> {
  private registrations: Map<string, ToolRegistration> = new Map();
  private instances: Map<string, Tool> = new Map();
  private permissionCache: Map<string, ToolPermission> = new Map();

  constructor() {
    super({ maxHistorySize: 100 });
  }

  /**
   * Register a tool
   */
  register(registration: ToolRegistration): void {
    this.registrations.set(registration.name, registration);
    this.emitTyped('tool:registered', {
      toolName: registration.name,
      description: registration.description,
    });
  }

  /**
   * Register multiple tools
   */
  registerAll(registrations: ToolRegistration[]): void {
    for (const reg of registrations) {
      this.register(reg);
    }
  }

  /**
   * Get a tool instance (lazy instantiation)
   */
  get(name: string): Tool | undefined {
    // Check cache first
    if (this.instances.has(name)) {
      return this.instances.get(name);
    }

    // Get registration
    const registration = this.registrations.get(name);
    if (!registration) {
      return undefined;
    }

    // Instantiate and cache
    const instance = registration.factory();
    this.instances.set(name, instance);
    this.emitTyped('tool:instantiated', {
      toolName: name,
    });

    return instance;
  }

  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.registrations.has(name);
  }

  /**
   * Get all registered tool names
   */
  getNames(): string[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * Get tools by tag
   */
  getByTag(tag: string): string[] {
    const results: string[] = [];
    for (const [name, reg] of this.registrations) {
      if (reg.tags?.includes(tag)) {
        results.push(name);
      }
    }
    return results;
  }

  /**
   * Get read-only tools (safe for parallel execution)
   */
  getReadOnlyTools(): string[] {
    const results: string[] = [];
    for (const [name, reg] of this.registrations) {
      if (reg.readOnly) {
        results.push(name);
      }
    }
    return results;
  }

  /**
   * Get tool registration info
   */
  getRegistration(name: string): ToolRegistration | undefined {
    return this.registrations.get(name);
  }

  /**
   * Get effective permission for a tool
   */
  getPermission(toolName: string): ToolPermission {
    // Check cache
    if (this.permissionCache.has(toolName)) {
      return this.permissionCache.get(toolName)!;
    }

    // Check config
    const configManager = getConfigManager();
    const toolConfig = configManager.getToolConfig(toolName);

    if (toolConfig?.permission) {
      this.permissionCache.set(toolName, toolConfig.permission);
      return toolConfig.permission;
    }

    // Use default from registration
    const registration = this.registrations.get(toolName);
    const permission = registration?.defaultPermission || 'ask';
    this.permissionCache.set(toolName, permission);
    return permission;
  }

  /**
   * Get timeout for a tool
   */
  getTimeout(toolName: string): number {
    const configManager = getConfigManager();
    const toolConfig = configManager.getToolConfig(toolName);

    if (toolConfig?.timeout) {
      return toolConfig.timeout * 1000; // Convert to ms
    }

    const registration = this.registrations.get(toolName);
    return (registration?.defaultTimeout || 120) * 1000;
  }

  /**
   * Check if a tool call is allowed
   */
  checkPermission(toolName: string, args: Record<string, unknown>): PermissionCheckResult {
    const permission = this.getPermission(toolName);

    // Never allowed
    if (permission === 'never') {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is disabled in configuration`,
        requiresConfirmation: false,
      };
    }

    // Check command patterns for bash-like tools
    if (toolName === 'bash' || toolName === 'execute_command') {
      const command = args.command as string;
      if (command) {
        const configManager = getConfigManager();
        const check = configManager.isToolCommandAllowed(toolName, command);

        if (!check.allowed) {
          return {
            allowed: false,
            reason: check.reason || 'Command blocked by configuration',
            requiresConfirmation: false,
          };
        }
      }
    }

    // Always allowed
    if (permission === 'always') {
      return {
        allowed: true,
        requiresConfirmation: false,
      };
    }

    // Ask permission
    return {
      allowed: true,
      requiresConfirmation: true,
    };
  }

  /**
   * Execute a tool with permission check
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    options?: {
      skipPermissionCheck?: boolean;
      onConfirmation?: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
    }
  ): Promise<ToolResult> {
    // Get tool
    const tool = this.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolName}" not found`,
      };
    }

    // Check permission
    if (!options?.skipPermissionCheck) {
      const permCheck = this.checkPermission(toolName, args);

      if (!permCheck.allowed) {
        return {
          success: false,
          error: permCheck.reason || 'Permission denied',
        };
      }

      if (permCheck.requiresConfirmation && options?.onConfirmation) {
        const confirmed = await options.onConfirmation(toolName, args);
        if (!confirmed) {
          return {
            success: false,
            error: 'User denied permission',
          };
        }
      }
    }

    // Execute with timeout
    const timeout = this.getTimeout(toolName);
    const startTime = Date.now();

    try {
      // Create a cancellable timeout
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<ToolResult>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms`)), timeout);
      });

      const result = await Promise.race([
        tool.execute(args).finally(() => {
          if (timeoutId) clearTimeout(timeoutId);
        }),
        timeoutPromise,
      ]);

      const duration = Date.now() - startTime;
      this.emitTyped('tool:executed', {
        toolName,
        result: {
          success: result.success,
          output: result.output,
          error: result.error,
        },
        duration,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.emitTyped('tool:error', {
        toolName,
        result: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        duration,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get tool config from TOML
   */
  getConfig(toolName: string): ToolConfig | undefined {
    const configManager = getConfigManager();
    return configManager.getToolConfig(toolName);
  }

  /**
   * Clear instance cache
   */
  clearCache(): void {
    this.instances.clear();
    this.permissionCache.clear();
  }

  /**
   * Get tool stats
   */
  getStats(): {
    registered: number;
    instantiated: number;
    readOnly: number;
    byPermission: Record<ToolPermission, number>;
  } {
    const byPermission: Record<ToolPermission, number> = {
      always: 0,
      ask: 0,
      never: 0,
    };

    for (const name of this.registrations.keys()) {
      const perm = this.getPermission(name);
      byPermission[perm]++;
    }

    return {
      registered: this.registrations.size,
      instantiated: this.instances.size,
      readOnly: this.getReadOnlyTools().length,
      byPermission,
    };
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    // Dispose tool instances that have dispose methods
    for (const [_name, instance] of this.instances) {
      if ('dispose' in instance && typeof instance.dispose === 'function') {
        try {
          instance.dispose();
        } catch {
          // Ignore disposal errors
        }
      }
    }
    this.instances.clear();
    this.registrations.clear();
    this.permissionCache.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Default Tool Registrations
// ============================================================================

/**
 * Create default tool registrations
 */
export function createDefaultRegistrations(): ToolRegistration[] {
  return [
    {
      name: 'view_file',
      description: 'View contents of a file',
      factory: () => {
        // Lazy import to avoid circular dependencies
        const { TextEditorTool } = require('./text-editor.js');
        return new TextEditorTool();
      },
      defaultPermission: 'always',
      defaultTimeout: 30,
      readOnly: true,
      tags: ['file', 'read'],
    },
    {
      name: 'str_replace_editor',
      description: 'Edit file contents with string replacement',
      factory: () => {
        const { TextEditorTool } = require('./text-editor.js');
        return new TextEditorTool();
      },
      defaultPermission: 'ask',
      defaultTimeout: 30,
      readOnly: false,
      tags: ['file', 'write'],
    },
    {
      name: 'create_file',
      description: 'Create a new file',
      factory: () => {
        const { TextEditorTool } = require('./text-editor.js');
        return new TextEditorTool();
      },
      defaultPermission: 'ask',
      defaultTimeout: 10,
      readOnly: false,
      tags: ['file', 'write'],
    },
    {
      name: 'bash',
      description: 'Execute bash commands',
      factory: () => {
        const { BashTool } = require('./bash.js');
        return new BashTool();
      },
      defaultPermission: 'ask',
      defaultTimeout: 120,
      readOnly: false,
      tags: ['shell', 'system'],
    },
    {
      name: 'search',
      description: 'Search files using ripgrep',
      factory: () => {
        const { SearchTool } = require('./enhanced-search.js');
        return new SearchTool();
      },
      defaultPermission: 'always',
      defaultTimeout: 30,
      readOnly: true,
      tags: ['search', 'read'],
    },
    {
      name: 'web_search',
      description: 'Search the web',
      factory: () => {
        const { WebSearchTool } = require('./web-search.js');
        return new WebSearchTool();
      },
      defaultPermission: 'always',
      defaultTimeout: 30,
      readOnly: true,
      tags: ['web', 'search'],
    },
    {
      name: 'web_fetch',
      description: 'Fetch content from a URL',
      factory: () => {
        const { FetchTool } = require('./fetch.js');
        return new FetchTool();
      },
      defaultPermission: 'ask',
      defaultTimeout: 60,
      readOnly: true,
      tags: ['web', 'fetch'],
    },
    {
      name: 'glob',
      description: 'Find files matching a pattern',
      factory: () => {
        const { GlobTool } = require('./glob.js');
        return new GlobTool();
      },
      defaultPermission: 'always',
      defaultTimeout: 30,
      readOnly: true,
      tags: ['file', 'search'],
    },
    {
      name: 'todo',
      description: 'Manage todo items',
      factory: () => {
        const { TodoTool } = require('./todo.js');
        return new TodoTool();
      },
      defaultPermission: 'always',
      defaultTimeout: 10,
      readOnly: false,
      tags: ['task', 'management'],
    },
  ];
}

// ============================================================================
// Singleton Export
// ============================================================================

let toolManagerInstance: ToolManager | null = null;

export function getToolManager(): ToolManager {
  if (!toolManagerInstance) {
    toolManagerInstance = new ToolManager();
    // Register default tools
    toolManagerInstance.registerAll(createDefaultRegistrations());
  }
  return toolManagerInstance;
}

/**
 * Create a new tool manager instance (for testing)
 */
export function createToolManager(): ToolManager {
  return new ToolManager();
}

/**
 * Reset the tool manager singleton (for testing)
 */
export function resetToolManager(): void {
  if (toolManagerInstance) {
    toolManagerInstance.dispose();
  }
  toolManagerInstance = null;
}
