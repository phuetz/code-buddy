/**
 * Tool Handler Module
 *
 * Central dispatcher for all tool execution in the CodeBuddy agent.
 * Uses the Tool Registry pattern for clean, maintainable tool dispatch.
 *
 * Key features:
 * - FormalToolRegistry for type-safe tool dispatch (no switch-case)
 * - Checkpoint system for file operation safety
 * - Lifecycle hooks (pre/post edit, pre/post bash)
 * - Auto-repair for failed bash commands
 * - MCP (Model Context Protocol) external tools
 * - Plugin marketplace tools
 *
 * All tools are registered as ITool adapters in the FormalToolRegistry.
 * Tool instances are lazy-loaded on first access for optimal startup time.
 */

import {
  TextEditorTool,
  MorphEditorTool,
  ImageTool,
  BashTool,
} from "../tools/index.js";
import {
  getFormalToolRegistry,
  createTextEditorTools,
  createBashTools,
  createSearchTools,
  createWebTools,
  createTodoTools,
  createDockerTools,
  createKubernetesTools,
  createMiscTools,
} from "../tools/registry/index.js";
import type { FormalToolRegistry, IToolExecutionContext } from "../tools/registry/index.js";
import { CodeBuddyToolCall } from "../codebuddy/client.js";
import { ToolResult } from "../types/index.js";
import { CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { HooksManager } from "../hooks/lifecycle-hooks.js";
import { PluginMarketplace } from "../plugins/marketplace.js";
import { getMCPManager } from "../codebuddy/tools.js";
import { getErrorMessage } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import { RepairCoordinator } from "./execution/repair-coordinator.js";

/**
 * Dependencies required to initialize the ToolHandler
 */
export interface ToolHandlerDependencies {
  /** Manages file operation checkpoints for undo/restore capability */
  checkpointManager: CheckpointManager;
  /** Executes pre/post hooks for file and bash operations */
  hooksManager: HooksManager;
  /** Provides access to installed plugin tools */
  marketplace: PluginMarketplace;
  /** Coordinates auto-repair attempts for failed commands */
  repairCoordinator: RepairCoordinator;
}

/**
 * ToolHandler manages tool instantiation and execution
 *
 * All tools are registered with FormalToolRegistry for type-safe dispatch.
 * The executeTool method dispatches LLM tool calls through the registry.
 *
 * Registry-based dispatch:
 * - All tools are registered with FormalToolRegistry
 * - Provides type-safe execution with validation and metrics
 * - MCP and plugin tools are handled separately
 */
export class ToolHandler {
  // Formal tool registry for type-safe dispatch
  private registry: FormalToolRegistry;
  private registryInitialized = false;

  // Legacy lazy-loaded tool instances (for direct API access)
  private _textEditor: TextEditorTool | null = null;
  private _morphEditor: MorphEditorTool | null | undefined = undefined;
  private _imageTool: ImageTool | null = null;
  private _bash: BashTool | null = null;

  constructor(private deps: ToolHandlerDependencies) {
    this.registry = getFormalToolRegistry();
    this.initializeRegistry();
  }

  /**
   * Initialize the tool registry with all registered tools
   */
  private initializeRegistry(): void {
    if (this.registryInitialized) return;

    // Register all tool adapters
    const allTools = [
      ...createTextEditorTools(),
      ...createBashTools(),
      ...createSearchTools(),
      ...createWebTools(),
      ...createTodoTools(),
      ...createDockerTools(),
      ...createKubernetesTools(),
      ...createMiscTools(),
    ];

    for (const tool of allTools) {
      if (!this.registry.has(tool.name)) {
        this.registry.register(tool);
        logger.debug(`Registered tool: ${tool.name}`);
      }
    }

    this.registryInitialized = true;
    logger.debug('Tool registry initialized', { toolCount: this.registry.getNames().length });
  }

  public get textEditor(): TextEditorTool {
    if (!this._textEditor) {
      this._textEditor = new TextEditorTool();
    }
    return this._textEditor;
  }

  public get morphEditor(): MorphEditorTool | null {
    if (this._morphEditor === undefined) {
      this._morphEditor = process.env.MORPH_API_KEY ? new MorphEditorTool() : null;
    }
    return this._morphEditor;
  }

  public get imageTool(): ImageTool {
    if (!this._imageTool) {
      this._imageTool = new ImageTool();
    }
    return this._imageTool;
  }

  /**
   * Get the BashTool instance for direct API access
   * Note: Tool execution should go through executeTool() which uses the registry
   */
  public get bash(): BashTool {
    if (!this._bash) {
      this._bash = new BashTool();
    }
    return this._bash;
  }

  /**
   * Execute a tool call from the LLM
   *
   * All tools are dispatched through the FormalToolRegistry.
   * Special handling for:
   * - MCP tools (mcp__*): External tool servers
   * - Plugin tools (plugin__*): Marketplace plugins
   * - edit_file: Morph Fast Apply (legacy, optional)
   *
   * @param toolCall - Tool call structure from the LLM response
   * @returns Tool execution result with success status and output/error
   */
  public async executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const toolName = toolCall.function.name;

      // Handle special tool prefixes first
      if (toolName.startsWith("mcp__")) {
        return await this.executeMCPTool(toolCall);
      }

      if (toolName.startsWith("plugin__")) {
        return await this.executePluginTool(toolCall);
      }

      // Handle legacy edit_file (Morph Fast Apply)
      if (toolName === "edit_file") {
        if (!this.morphEditor) {
          return {
            success: false,
            error:
              "Morph Fast Apply not available. Please set MORPH_API_KEY environment variable to use this feature.",
          };
        }
        return await this.morphEditor.editFile(
          args.target_file,
          args.instructions,
          args.code_edit
        );
      }

      // Dispatch through registry for all other tools
      if (this.registry.has(toolName)) {
        return await this.executeRegistryTool(toolName, args);
      }

      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Tool execution error: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Execute a tool through the FormalToolRegistry
   *
   * Handles:
   * - File-modifying tools: checkpoints and pre/post-edit hooks
   * - Bash tool: pre/post-bash hooks and auto-repair
   * - Other tools: direct execution
   *
   * @param toolName - Name of the registered tool
   * @param args - Tool arguments
   * @returns Tool execution result
   */
  private async executeRegistryTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const registeredTool = this.registry.get(toolName);
    if (!registeredTool) {
      return {
        success: false,
        error: `Tool "${toolName}" not found in registry`,
      };
    }

    const metadata = registeredTool.metadata;
    const context: IToolExecutionContext = {
      cwd: process.cwd(),
    };

    // Handle bash tool with hooks and auto-repair
    if (toolName === 'bash') {
      return await this.executeBashWithHooks(args, context);
    }

    // Handle file-modifying tools with checkpoints and hooks
    if (metadata.modifiesFiles && args.path) {
      const filePath = args.path as string;

      // Create checkpoint before modifying file
      if (toolName === 'create_file') {
        this.deps.checkpointManager.checkpointBeforeCreate(filePath);
      } else {
        this.deps.checkpointManager.checkpointBeforeEdit(filePath);
      }

      // Execute pre-edit hooks
      await this.deps.hooksManager.executeHooks("pre-edit", {
        file: filePath,
        content: (args.content || args.new_str || '') as string,
      });

      // Execute through registry
      const result = await this.registry.execute(toolName, args, context);

      // Execute post-edit hooks
      await this.deps.hooksManager.executeHooks("post-edit", {
        file: filePath,
        content: (args.content || args.new_str || '') as string,
        output: result.output,
      });

      return result;
    }

    // Non-file-modifying tools execute directly through registry
    return await this.registry.execute(toolName, args, context);
  }

  /**
   * Execute bash tool with lifecycle hooks and auto-repair
   */
  private async executeBashWithHooks(
    args: Record<string, unknown>,
    context: IToolExecutionContext
  ): Promise<ToolResult> {
    const command = args.command as string;

    // Execute pre-bash hooks
    try {
      await this.deps.hooksManager.executeHooks("pre-bash", { command });
    } catch (hookError) {
      logger.warn("Pre-bash hook failed, continuing with execution", {
        error: getErrorMessage(hookError),
      });
    }

    // Execute bash through registry
    let bashResult = await this.registry.execute("bash", args, context);

    // Auto-repair on failure
    if (!bashResult.success && bashResult.error && this.deps.repairCoordinator.isRepairEnabled()) {
      const repairResult = await this.deps.repairCoordinator.attemptRepair(
        bashResult.error,
        command
      );

      if (repairResult.success) {
        logger.info(`Retrying command after successful repair: ${command}`);
        const retryResult = await this.registry.execute("bash", args, context);

        if (retryResult.success) {
          bashResult = {
            ...retryResult,
            output: `[Auto-repaired: ${repairResult.fixes.join(", ")}]\n\n${retryResult.output}`,
          };
        } else {
          bashResult.output =
            (bashResult.output || "") +
            `\n\n[Auto-repair applied but command still fails: ${repairResult.fixes.join(", ")}]`;
        }
      }
    }

    // Execute post-bash hooks
    try {
      await this.deps.hooksManager.executeHooks("post-bash", {
        command,
        output: bashResult.output,
        error: bashResult.error,
      });
    } catch (hookError) {
      logger.warn("Post-bash hook failed", { error: getErrorMessage(hookError) });
    }

    return bashResult;
  }

  private async executeMCPTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const mcpManager = getMCPManager();

      const result = await mcpManager.callTool(toolCall.function.name, args);

      if (result.isError) {
        const errorContent = result.content[0] as { text?: string } | undefined;
        return {
          success: false,
          error: errorContent?.text || "MCP tool error",
        };
      }

      const output = result.content
        .map((item) => {
          if (item.type === "text") {
            return item.text;
          } else if (item.type === "resource") {
            return `Resource: ${item.resource?.uri || "Unknown"}`;
          }
          return String(item);
        })
        .join("\n");

      return {
        success: true,
        output: output || "Success",
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `MCP tool execution error: ${getErrorMessage(error)}`,
      };
    }
  }

  private async executePluginTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const toolName = toolCall.function.name.replace("plugin__", "");

      const result = await this.deps.marketplace.executeTool(toolName, args);

      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Plugin tool execution error: ${getErrorMessage(error)}`,
      };
    }
  }
}
