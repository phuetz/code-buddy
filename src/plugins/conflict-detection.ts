/**
 * OpenClaw-inspired Plugin Conflict Detection System
 *
 * Features:
 * - Conflict detection between plugin IDs and tool names
 * - Allowlist filtering (exact match, plugin ID, group membership)
 * - Metadata tracking for plugin tool origins
 * - Safe plugin tool registration
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../types/index.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PluginTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  required?: boolean;
  tools?: PluginTool[] | ((context: PluginContext) => PluginTool[] | Promise<PluginTool[]>);
  dependencies?: string[];
  priority?: number;
}

export interface PluginContext {
  workspaceRoot: string;
  configDir: string;
  agentId?: string;
  sessionId?: string;
}

export interface PluginToolMeta {
  pluginId: string;
  pluginName: string;
  optional: boolean;
  loadedAt: Date;
}

export interface ConflictReport {
  hasConflicts: boolean;
  conflicts: ConflictInfo[];
  warnings: string[];
}

export interface ConflictInfo {
  type: 'plugin_id_vs_tool' | 'duplicate_tool' | 'dependency_missing';
  pluginId: string;
  conflictsWith: string;
  message: string;
  resolution?: string;
}

export interface AllowlistConfig {
  /** Exact tool names to allow */
  tools?: string[];
  /** Plugin IDs to allow (all tools from these plugins) */
  plugins?: string[];
  /** Groups to allow (e.g., 'group:plugins' allows all plugins) */
  groups?: string[];
  /** Default behavior when no match found */
  defaultAllow?: boolean;
}

// ============================================================================
// Plugin Tool Registry
// ============================================================================

export class PluginConflictDetector extends EventEmitter {
  private builtInTools: Set<string> = new Set();
  private registeredPlugins: Map<string, Plugin> = new Map();
  private toolMeta: WeakMap<PluginTool, PluginToolMeta> = new WeakMap();
  private toolsByName: Map<string, { tool: PluginTool; pluginId: string }> = new Map();
  private allowlist: AllowlistConfig;

  constructor(builtInTools: string[] = [], allowlist: AllowlistConfig = {}) {
    super();
    this.builtInTools = new Set(builtInTools.map(t => t.toLowerCase()));
    this.allowlist = {
      defaultAllow: false,
      ...allowlist,
    };
  }

  /**
   * Check for conflicts before registering a plugin
   */
  checkConflicts(plugin: Plugin): ConflictReport {
    const conflicts: ConflictInfo[] = [];
    const warnings: string[] = [];

    // 1. Check if plugin ID conflicts with built-in tool names
    if (this.builtInTools.has(plugin.id.toLowerCase())) {
      conflicts.push({
        type: 'plugin_id_vs_tool',
        pluginId: plugin.id,
        conflictsWith: plugin.id,
        message: `Plugin ID "${plugin.id}" conflicts with built-in tool name`,
        resolution: 'Rename the plugin or use a unique ID',
      });
    }

    // 2. Check if plugin ID conflicts with existing plugin
    if (this.registeredPlugins.has(plugin.id)) {
      const existing = this.registeredPlugins.get(plugin.id)!;
      conflicts.push({
        type: 'duplicate_tool',
        pluginId: plugin.id,
        conflictsWith: existing.id,
        message: `Plugin "${plugin.id}" is already registered`,
        resolution: 'Unregister existing plugin first',
      });
    }

    // 3. Check dependencies
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.registeredPlugins.has(dep)) {
          conflicts.push({
            type: 'dependency_missing',
            pluginId: plugin.id,
            conflictsWith: dep,
            message: `Plugin "${plugin.id}" depends on "${dep}" which is not registered`,
            resolution: `Register plugin "${dep}" before "${plugin.id}"`,
          });
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      warnings,
    };
  }

  /**
   * Check tool conflicts within a plugin
   */
  checkToolConflicts(plugin: Plugin, tools: PluginTool[]): ConflictReport {
    const conflicts: ConflictInfo[] = [];
    const warnings: string[] = [];
    const toolNames = new Set<string>();

    for (const tool of tools) {
      const lowerName = tool.name.toLowerCase();

      // Check against built-in tools
      if (this.builtInTools.has(lowerName)) {
        conflicts.push({
          type: 'plugin_id_vs_tool',
          pluginId: plugin.id,
          conflictsWith: tool.name,
          message: `Tool "${tool.name}" from plugin "${plugin.id}" conflicts with built-in tool`,
          resolution: 'Rename the tool or skip it',
        });
        continue;
      }

      // Check against already registered plugin tools
      if (this.toolsByName.has(lowerName)) {
        const existing = this.toolsByName.get(lowerName)!;
        if (existing.pluginId !== plugin.id) {
          conflicts.push({
            type: 'duplicate_tool',
            pluginId: plugin.id,
            conflictsWith: existing.pluginId,
            message: `Tool "${tool.name}" already registered by plugin "${existing.pluginId}"`,
            resolution: 'Rename the tool or remove duplicate',
          });
        }
        continue;
      }

      // Check for duplicates within same plugin
      if (toolNames.has(lowerName)) {
        warnings.push(`Duplicate tool "${tool.name}" within plugin "${plugin.id}"`);
        continue;
      }

      toolNames.add(lowerName);
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      warnings,
    };
  }

  /**
   * Check if a tool is allowed by the allowlist
   */
  isToolAllowed(toolName: string, pluginId: string, isRequired: boolean): boolean {
    // Required plugins always allowed
    if (isRequired) {
      return true;
    }

    const { tools, plugins, groups, defaultAllow } = this.allowlist;

    // Check exact tool name match
    if (tools?.some(t => t.toLowerCase() === toolName.toLowerCase())) {
      return true;
    }

    // Check plugin ID match
    if (plugins?.some(p => p.toLowerCase() === pluginId.toLowerCase())) {
      return true;
    }

    // Check group membership
    if (groups?.includes('group:plugins')) {
      return true;
    }

    // Default behavior
    return defaultAllow || false;
  }

  /**
   * Register a plugin and resolve its tools
   */
  async registerPlugin(
    plugin: Plugin,
    context: PluginContext
  ): Promise<{
    success: boolean;
    registeredTools: PluginTool[];
    skippedTools: string[];
    errors: string[];
  }> {
    const errors: string[] = [];
    const skippedTools: string[] = [];
    const registeredTools: PluginTool[] = [];

    // Check plugin-level conflicts
    const pluginConflicts = this.checkConflicts(plugin);
    if (pluginConflicts.hasConflicts) {
      for (const conflict of pluginConflicts.conflicts) {
        errors.push(conflict.message);
      }
      this.emit('plugin:blocked', { pluginId: plugin.id, conflicts: pluginConflicts.conflicts });
      return { success: false, registeredTools, skippedTools, errors };
    }

    // Resolve tools
    let tools: PluginTool[] = [];
    if (plugin.tools) {
      try {
        if (typeof plugin.tools === 'function') {
          const result = plugin.tools(context);
          tools = result instanceof Promise ? await result : result;
        } else {
          tools = plugin.tools;
        }
      } catch (error) {
        errors.push(`Failed to resolve tools for plugin "${plugin.id}": ${getErrorMessage(error)}`);
        this.emit('plugin:error', { pluginId: plugin.id, error });
        return { success: false, registeredTools, skippedTools, errors };
      }
    }

    // Check tool-level conflicts
    const toolConflicts = this.checkToolConflicts(plugin, tools);
    if (toolConflicts.warnings.length > 0) {
      for (const warning of toolConflicts.warnings) {
        logger.warn(warning);
      }
    }

    // Register allowed tools
    for (const tool of tools) {
      const lowerName = tool.name.toLowerCase();

      // Skip conflicting tools
      if (toolConflicts.conflicts.some(c => c.conflictsWith === tool.name)) {
        skippedTools.push(tool.name);
        continue;
      }

      // Check allowlist
      if (!this.isToolAllowed(tool.name, plugin.id, plugin.required || false)) {
        skippedTools.push(tool.name);
        this.emit('tool:filtered', { toolName: tool.name, pluginId: plugin.id, reason: 'allowlist' });
        continue;
      }

      // Attach metadata
      const meta: PluginToolMeta = {
        pluginId: plugin.id,
        pluginName: plugin.name,
        optional: !plugin.required,
        loadedAt: new Date(),
      };
      this.toolMeta.set(tool, meta);

      // Register tool
      this.toolsByName.set(lowerName, { tool, pluginId: plugin.id });
      registeredTools.push(tool);
    }

    // Register plugin
    this.registeredPlugins.set(plugin.id, plugin);

    this.emit('plugin:registered', {
      pluginId: plugin.id,
      toolCount: registeredTools.length,
      skippedCount: skippedTools.length,
    });

    return {
      success: true,
      registeredTools,
      skippedTools,
      errors,
    };
  }

  /**
   * Unregister a plugin and its tools
   */
  unregisterPlugin(pluginId: string): boolean {
    const plugin = this.registeredPlugins.get(pluginId);
    if (!plugin) {
      return false;
    }

    // Remove tools
    for (const [name, entry] of this.toolsByName) {
      if (entry.pluginId === pluginId) {
        this.toolsByName.delete(name);
      }
    }

    this.registeredPlugins.delete(pluginId);
    this.emit('plugin:unregistered', { pluginId });

    return true;
  }

  /**
   * Get tool metadata
   */
  getToolMeta(tool: PluginTool): PluginToolMeta | undefined {
    return this.toolMeta.get(tool);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): PluginTool[] {
    return Array.from(this.toolsByName.values()).map(entry => entry.tool);
  }

  /**
   * Get tools by plugin
   */
  getToolsByPlugin(pluginId: string): PluginTool[] {
    return Array.from(this.toolsByName.values())
      .filter(entry => entry.pluginId === pluginId)
      .map(entry => entry.tool);
  }

  /**
   * Update allowlist
   */
  updateAllowlist(config: Partial<AllowlistConfig>): void {
    this.allowlist = { ...this.allowlist, ...config };
    this.emit('allowlist:updated', this.allowlist);
  }

  /**
   * Add built-in tool names
   */
  addBuiltInTools(tools: string[]): void {
    for (const tool of tools) {
      this.builtInTools.add(tool.toLowerCase());
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    plugins: number;
    tools: number;
    builtInTools: number;
    allowlistRules: number;
  } {
    return {
      plugins: this.registeredPlugins.size,
      tools: this.toolsByName.size,
      builtInTools: this.builtInTools.size,
      allowlistRules:
        (this.allowlist.tools?.length || 0) +
        (this.allowlist.plugins?.length || 0) +
        (this.allowlist.groups?.length || 0),
    };
  }

  /**
   * Generate a conflict report for all registered plugins
   */
  generateFullReport(): string {
    const lines: string[] = ['Plugin Registry Report', '======================', ''];

    // Plugins
    lines.push('Registered Plugins:');
    for (const [id, plugin] of this.registeredPlugins) {
      const toolCount = this.getToolsByPlugin(id).length;
      lines.push(`  - ${plugin.name} (${id}): ${toolCount} tools`);
    }
    lines.push('');

    // Tools by plugin
    lines.push('Tools by Plugin:');
    for (const [id] of this.registeredPlugins) {
      const tools = this.getToolsByPlugin(id);
      if (tools.length > 0) {
        lines.push(`  ${id}:`);
        for (const tool of tools) {
          const meta = this.getToolMeta(tool);
          const optional = meta?.optional ? ' (optional)' : '';
          lines.push(`    - ${tool.name}${optional}`);
        }
      }
    }
    lines.push('');

    // Stats
    const stats = this.getStats();
    lines.push('Statistics:');
    lines.push(`  Plugins: ${stats.plugins}`);
    lines.push(`  Plugin Tools: ${stats.tools}`);
    lines.push(`  Built-in Tools: ${stats.builtInTools}`);
    lines.push(`  Allowlist Rules: ${stats.allowlistRules}`);

    return lines.join('\n');
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.registeredPlugins.clear();
    this.toolsByName.clear();
    this.emit('registry:cleared');
  }
}

// ============================================================================
// Singleton & Convenience Functions
// ============================================================================

let conflictDetectorInstance: PluginConflictDetector | null = null;

export function getPluginConflictDetector(
  builtInTools?: string[],
  allowlist?: AllowlistConfig
): PluginConflictDetector {
  if (!conflictDetectorInstance) {
    conflictDetectorInstance = new PluginConflictDetector(builtInTools, allowlist);
  }
  return conflictDetectorInstance;
}

export function resetPluginConflictDetector(): void {
  conflictDetectorInstance = null;
}

/**
 * Convenience: Register multiple plugins
 */
export async function registerPlugins(
  plugins: Plugin[],
  context: PluginContext,
  builtInTools: string[] = []
): Promise<{
  registered: string[];
  failed: string[];
  totalTools: number;
}> {
  const detector = getPluginConflictDetector(builtInTools);
  const registered: string[] = [];
  const failed: string[] = [];
  let totalTools = 0;

  // Sort by priority (required first, then by priority)
  const sorted = [...plugins].sort((a, b) => {
    if (a.required && !b.required) return -1;
    if (!a.required && b.required) return 1;
    return (b.priority || 0) - (a.priority || 0);
  });

  for (const plugin of sorted) {
    const result = await detector.registerPlugin(plugin, context);
    if (result.success) {
      registered.push(plugin.id);
      totalTools += result.registeredTools.length;
    } else {
      failed.push(plugin.id);
    }
  }

  return { registered, failed, totalTools };
}
