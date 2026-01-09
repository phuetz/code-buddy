import { CodeBuddyTool } from "../codebuddy/client.js";
import { ToolMetadata, RegisteredTool, ToolCategory } from "./types.js";
import { logger } from "../utils/logger.js";

/**
 * Centralized registry for all CodeBuddy tools
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, RegisteredTool> = new Map();

  private constructor() {}

  /**
   * Get the singleton instance of ToolRegistry
   */
  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a tool with the registry
   */
  public registerTool(
    definition: CodeBuddyTool,
    metadata: ToolMetadata,
    isEnabled: () => boolean = () => true
  ): void {
    const name = definition.function.name;
    if (this.tools.has(name)) {
      logger.debug(`Overwriting tool registration for: ${name}`);
    }
    this.tools.set(name, { definition, metadata, isEnabled });
  }

  /**
   * Register multiple tools at once
   */
  public registerTools(tools: { definition: CodeBuddyTool; metadata: ToolMetadata; isEnabled?: () => boolean }[]): void {
    for (const tool of tools) {
      this.registerTool(tool.definition, tool.metadata, tool.isEnabled);
    }
  }

  /**
   * Get all registered tools that are currently enabled
   */
  public getEnabledTools(): CodeBuddyTool[] {
    return Array.from(this.tools.values())
      .filter(t => t.isEnabled())
      .map(t => t.definition);
  }

  /**
   * Get metadata for all enabled tools
   */
  public getEnabledToolMetadata(): ToolMetadata[] {
    return Array.from(this.tools.values())
      .filter(t => t.isEnabled())
      .map(t => t.metadata);
  }

  /**
   * Get a specific tool by name
   */
  public getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered and enabled
   */
  public isToolEnabled(name: string): boolean {
    const tool = this.tools.get(name);
    return tool ? tool.isEnabled() : false;
  }

  /**
   * Clear all registered tools (mainly for testing)
   */
  public clear(): void {
    this.tools.clear();
  }

  /**
   * Get all registered tools (including disabled ones)
   */
  public getAllTools(): CodeBuddyTool[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }
}

/**
 * Helper to get the tool registry singleton
 */
export const getToolRegistry = () => ToolRegistry.getInstance();
