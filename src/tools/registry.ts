import { CodeBuddyTool } from "../codebuddy/client.js";
import { ToolMetadata, RegisteredTool, ToolCategory } from "./types.js";
import { logger } from "../utils/logger.js";

/**
 * Centralized registry for all CodeBuddy tools.
 * 
 * Implements the Singleton pattern to ensure a single source of truth for:
 * - Available tools
 * - Tool metadata
 * - Tool enablement state
 * 
 * This registry is used by the `ToolSelector` and agents to discover and access tools.
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, RegisteredTool> = new Map();

  private constructor() {}

  /**
   * Get the singleton instance of ToolRegistry.
   * Creates the instance if it doesn't exist.
   */
  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a single tool with the registry.
   * 
   * @param definition - The tool definition (name, description, parameters)
   * @param metadata - Additional metadata (category, keywords, priority)
   * @param isEnabled - Optional callback to determine if the tool is enabled at runtime (default: always true)
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
   * Register multiple tools at once.
   * 
   * @param tools - Array of tool objects containing definition, metadata, and optional isEnabled callback
   */
  public registerTools(tools: { definition: CodeBuddyTool; metadata: ToolMetadata; isEnabled?: () => boolean }[]): void {
    for (const tool of tools) {
      this.registerTool(tool.definition, tool.metadata, tool.isEnabled);
    }
  }

  /**
   * Get all registered tools that are currently enabled.
   * 
   * @returns Array of tool definitions for use with the LLM
   */
  public getEnabledTools(): CodeBuddyTool[] {
    return Array.from(this.tools.values())
      .filter(t => t.isEnabled())
      .map(t => t.definition);
  }

  /**
   * Get metadata for all enabled tools.
   * Useful for tool selection algorithms (RAG) and UI display.
   * 
   * @returns Array of tool metadata objects
   */
  public getEnabledToolMetadata(): ToolMetadata[] {
    return Array.from(this.tools.values())
      .filter(t => t.isEnabled())
      .map(t => t.metadata);
  }

  /**
   * Get a specific registered tool by name.
   * 
   * @param name - The name of the tool to retrieve
   * @returns The registered tool object or undefined if not found
   */
  public getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered and currently enabled.
   * 
   * @param name - The name of the tool to check
   * @returns True if the tool exists and isEnabled() returns true
   */
  public isToolEnabled(name: string): boolean {
    const tool = this.tools.get(name);
    return tool ? tool.isEnabled() : false;
  }

  /**
   * Clear all registered tools.
   * Mainly used for testing to reset the registry state.
   */
  public clear(): void {
    this.tools.clear();
  }

  /**
   * Get all registered tools (including disabled ones).
   * 
   * @returns Array of all tool definitions
   */
  public getAllTools(): CodeBuddyTool[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }
}

/**
 * Helper to get the tool registry singleton.
 */
export const getToolRegistry = () => ToolRegistry.getInstance();
