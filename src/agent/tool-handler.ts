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
  createGitTools,
  createMiscTools,
  createProcessTools,
  createScriptTools,
  createPlanTools,
} from "../tools/registry/index.js";
import type { FormalToolRegistry, IToolExecutionContext } from "../tools/registry/index.js";
import { CodeBuddyToolCall } from "../codebuddy/client.js";
import { ToolResult } from "../types/index.js";
import { CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { HooksManager } from "../hooks/lifecycle-hooks.js";
import { PluginMarketplace } from "../plugins/marketplace.js";
import { getMCPManager } from "../codebuddy/tools.js";
import { getErrorMessage } from "../errors/index.js";
import { logger } from "../utils/logger.js";
import { RepairCoordinator } from "./execution/repair-coordinator.js";
import { getPolicyManager, type PolicyDecision } from "../security/tool-policy/index.js";
import { getTrustFolderManager } from "../security/trust-folders.js";
import {
  getToolHooksManager,
  registerDefaultHooks,
  setCurrentProvider,
  type ToolHookContext,
  type ToolHookResult,
  type LLMProvider,
} from "../tools/hooks/index.js";
import { WritePolicy, WRITE_TOOL_NAMES } from "../security/write-policy.js";
import { RunStore } from "../observability/run-store.js";

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
 *
 * Policy integration:
 * - Uses PolicyManager to check tool permissions before execution
 * - Respects hierarchical tool groups and profiles
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

  // Callback for requesting user confirmation
  private confirmationCallback?: (toolName: string, args: Record<string, unknown>, decision: PolicyDecision) => Promise<boolean>;

  /** Active run ID for RunStore observability (set by dev workflows) */
  private currentRunId: string | undefined;

  constructor(private deps: ToolHandlerDependencies) {
    this.registry = getFormalToolRegistry();
    this.initializeRegistry();
    this.initializeToolHooks();
  }

  /**
   * Initialize tool hooks system with default hooks
   */
  private initializeToolHooks(): void {
    registerDefaultHooks();
    logger.debug('Tool hooks system initialized');
  }

  /**
   * Set the current LLM provider for result sanitization
   * Call this when switching providers
   */
  public setProvider(provider: LLMProvider): void {
    setCurrentProvider(provider);
  }

  /**
   * Set the active run ID for RunStore observability.
   * Tool calls and results will be emitted to the run's event log.
   */
  setRunId(runId: string | undefined): void {
    this.currentRunId = runId;
  }

  /**
   * Set callback for user confirmation
   * Called when policy requires confirmation before tool execution
   */
  setConfirmationCallback(
    callback: (toolName: string, args: Record<string, unknown>, decision: PolicyDecision) => Promise<boolean>
  ): void {
    this.confirmationCallback = callback;
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
      ...createGitTools(),
      ...createMiscTools(),
      ...createProcessTools(),
      ...createScriptTools(),
      ...createPlanTools(),
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
   * Hook integration:
   * - Executes before_tool_call hooks (can modify args)
   * - Executes after_tool_call hooks (can modify result)
   * - Executes error/denied hooks on failures
   *
   * Policy integration:
   * - Checks PolicyManager before execution
   * - Denies blocked tools
   * - Requests confirmation for tools requiring it
   *
   * @param toolCall - Tool call structure from the LLM response
   * @returns Tool execution result with success status and output/error
   */
  public async executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    const startTime = Date.now();
    const hooksManager = getToolHooksManager();

    try {
      const args = JSON.parse(toolCall.function.arguments);
      const toolName = toolCall.function.name;

      // Create hook context
      let hookContext: ToolHookContext = {
        toolName,
        originalArgs: { ...args },
        args,
        toolCallId: toolCall.id,
        timestamp: startTime,
      };

      // Check policy before execution
      const policyDecision = this.checkToolPolicy(toolName, args);

      if (policyDecision.action === 'deny') {
        logger.info(`Tool denied by policy: ${toolName}`, { reason: policyDecision.reason });

        // Execute denied hooks
        await hooksManager.executeDeniedHooks(
          hookContext,
          new Error(policyDecision.reason || 'Tool denied by policy')
        );

        return {
          success: false,
          error: `Tool "${toolName}" is not allowed: ${policyDecision.reason}`,
        };
      }

      if (policyDecision.action === 'confirm') {
        // Request user confirmation if callback is set
        if (this.confirmationCallback) {
          const confirmed = await this.confirmationCallback(toolName, args, policyDecision);
          if (!confirmed) {
            logger.info(`Tool execution cancelled by user: ${toolName}`);

            // Execute denied hooks for user cancellation
            await hooksManager.executeDeniedHooks(
              hookContext,
              new Error('User cancelled execution')
            );

            return {
              success: false,
              error: `User cancelled execution of "${toolName}"`,
            };
          }
          // User confirmed - set session override to allow future executions
          getPolicyManager().setSessionOverride(toolName, 'allow');
        }
        // If no callback, proceed (for backwards compatibility)
      }

      // Check trust folders for file/bash operations
      const trustManager = getTrustFolderManager();
      if (trustManager.isEnforcementEnabled()) {
        const targetPath = args.path || args.file_path || args.target_file;
        if (typeof targetPath === 'string' && !trustManager.isTrusted(targetPath)) {
          logger.info(`Tool blocked by trust folder: ${toolName}`, { path: targetPath });
          return {
            success: false,
            error: `Path "${targetPath}" is not in a trusted directory. Use /trust to add it.`,
          };
        }
      }

      // ── WritePolicy gating (strict / confirm modes) ──────────────
      if (WRITE_TOOL_NAMES.has(toolName)) {
        const writePolicy = WritePolicy.getInstance();
        const paths: string[] = [];
        if (typeof args.path === 'string') paths.push(args.path);
        if (typeof args.target_file === 'string') paths.push(args.target_file);
        if (Array.isArray(args.files)) {
          for (const f of args.files) {
            if (typeof f === 'string') paths.push(f);
            else if (typeof f?.path === 'string') paths.push(f.path);
          }
        }

        const gateResult = await writePolicy.gate(
          { toolName, paths, description: args.description as string | undefined },
          this.currentRunId
        );

        if (!gateResult.allowed) {
          return {
            success: false,
            error: gateResult.reason || `WritePolicy blocked tool "${toolName}"`,
          };
        }
      }

      // ── RunStore: emit tool_call event ───────────────────────────
      if (this.currentRunId) {
        RunStore.getInstance().emit(this.currentRunId, {
          type: 'tool_call',
          data: {
            toolName,
            toolCallId: toolCall.id,
            args: this.sanitizeArgsForLog(args),
          },
        });
      }

      // Execute before_tool_call hooks (can modify args)
      hookContext = await hooksManager.executeBeforeHooks(hookContext);
      const modifiedArgs = hookContext.args;

      // Execute tool with potentially modified args
      let result: ToolResult;

      // Handle special tool prefixes first
      if (toolName.startsWith("mcp__")) {
        result = await this.executeMCPTool(toolCall);
      } else if (toolName.startsWith("plugin__")) {
        result = await this.executePluginTool(toolCall);
      } else if (toolName === "edit_file") {
        // Handle legacy edit_file (Morph Fast Apply)
        if (!this.morphEditor) {
          result = {
            success: false,
            error:
              "Morph Fast Apply not available. Please set MORPH_API_KEY environment variable to use this feature.",
          };
        } else {
          result = await this.morphEditor.editFile(
            modifiedArgs.target_file as string,
            modifiedArgs.instructions as string,
            modifiedArgs.code_edit as string
          );
        }
      } else if (this.registry.has(toolName)) {
        // Dispatch through registry for all other tools
        result = await this.executeRegistryTool(toolName, modifiedArgs);
      } else {
        // Suggest common alternatives for hallucinated tool names
        const suggestions: Record<string, string> = {
          npm: 'Use the "bash" tool with npm commands (e.g., bash with command "npm install")',
          node: 'Use the "bash" tool with node commands (e.g., bash with command "node script.js")',
          python: 'Use the "bash" tool with python commands',
          pip: 'Use the "bash" tool with pip commands',
          curl: 'Use the "bash" tool with curl commands',
          docker: 'Use the "bash" tool with docker commands',
          cat: 'Use the "view_file" tool to read files',
          grep: 'Use the "search" tool to search files',
          sed: 'Use the "str_replace_editor" tool to edit files',
          mv: 'Use the "bash" tool with mv commands',
          cp: 'Use the "bash" tool with cp commands',
          mkdir: 'Use the "bash" tool with mkdir commands',
          write: 'Use the "create_file" or "str_replace_editor" tool',
          edit: 'Use the "str_replace_editor" tool to edit files',
          read: 'Use the "view_file" tool to read files',
        };
        const suggestion = suggestions[toolName.toLowerCase()];
        result = {
          success: false,
          error: `Unknown tool: ${toolName}.${suggestion ? ` ${suggestion}.` : ' Use "bash" for shell commands, "view_file" to read files, "str_replace_editor" to edit files, or "create_file" to create new files.'}`,
        };
      }

      // Convert to hook result format
      const hookResult: ToolHookResult = {
        success: result.success,
        output: result.output,
        error: result.error,
        executionTimeMs: Date.now() - startTime,
      };

      // Execute after_tool_call hooks (can modify result)
      const finalHookResult = await hooksManager.executeAfterHooks(hookContext, hookResult);

      // Execute error hooks if failed
      if (!finalHookResult.success && finalHookResult.error) {
        await hooksManager.executeErrorHooks(
          hookContext,
          new Error(finalHookResult.error)
        );
      }

      // ── RunStore: emit tool_result event ─────────────────────────
      if (this.currentRunId) {
        RunStore.getInstance().emit(this.currentRunId, {
          type: 'tool_result',
          data: {
            toolName,
            toolCallId: toolCall.id,
            success: finalHookResult.success,
            outputLength: finalHookResult.output?.length || 0,
            error: finalHookResult.error,
            durationMs: Date.now() - startTime,
          },
        });
      }

      // Return final result
      return {
        success: finalHookResult.success,
        output: finalHookResult.output,
        error: finalHookResult.error,
      };
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);

      // Execute error hooks
      try {
        await hooksManager.executeErrorHooks(
          {
            toolName: toolCall.function.name,
            originalArgs: {},
            args: {},
            toolCallId: toolCall.id,
            timestamp: startTime,
          },
          error instanceof Error ? error : new Error(errorMessage)
        );
      } catch {
        // Ignore hook errors
      }

      return {
        success: false,
        error: `Tool execution error: ${errorMessage}`,
      };
    }
  }

  /**
   * Sanitize tool args for logging (truncate large content fields).
   */
  private sanitizeArgsForLog(args: Record<string, unknown>): Record<string, unknown> {
    const MAX_LEN = 500;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && v.length > MAX_LEN) {
        result[k] = v.slice(0, MAX_LEN) + `…[${v.length} chars]`;
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  /**
   * Check tool policy before execution
   * @param toolName Tool name to check
   * @param args Tool arguments
   * @returns Policy decision
   */
  private checkToolPolicy(toolName: string, args: Record<string, unknown>): PolicyDecision {
    const policyManager = getPolicyManager();
    return policyManager.checkTool(toolName, args);
  }

  /**
   * Check if a tool is allowed by policy
   * @param toolName Tool name to check
   * @param args Tool arguments
   * @returns True if tool is allowed
   */
  public isToolAllowed(toolName: string, args?: Record<string, unknown>): boolean {
    const policyManager = getPolicyManager();
    return policyManager.isAllowed(toolName, args);
  }

  /**
   * Get policy decision for a tool (for UI display)
   * @param toolName Tool name to check
   * @param args Tool arguments
   * @returns Policy decision
   */
  public getToolPolicy(toolName: string, args?: Record<string, unknown>): PolicyDecision {
    return this.checkToolPolicy(toolName, args || {});
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

  /**
   * Execute a tool with streaming output.
   * Currently only supports bash. Falls back to executeTool for other tools.
   * Yields string deltas for real-time output.
   */
  public async *executeToolStreaming(
    toolCall: CodeBuddyToolCall
  ): AsyncGenerator<string, ToolResult, undefined> {
    const toolName = toolCall.function.name;

    // Only bash supports streaming currently
    if (toolName === 'bash') {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        const command = args.command as string;
        const timeout = (args.timeout as number) || 30000;

        const gen = this.bash.executeStreaming(command, timeout);
        let result = await gen.next();
        while (!result.done) {
          yield result.value;
          result = await gen.next();
        }
        return result.value;
      } catch (error) {
        return { success: false, error: `Streaming execution error: ${getErrorMessage(error)}` };
      }
    }

    // Fallback: non-streaming execution
    return await this.executeTool(toolCall);
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

  /**
   * Refresh tools from skills directories.
   * Called after auto-installing a skill via SkillDiscoveryTool
   * to make newly installed skill tools available to the agent.
   */
  public async refreshToolsFromSkills(): Promise<void> {
    try {
      const { SkillRegistry } = await import('../skills/skill-registry.js');
      const registry = new SkillRegistry();
      await registry.refresh();
      logger.info('Tool registry refreshed from skills');
    } catch (err) {
      logger.warn('Failed to refresh tools from skills', {
        error: err instanceof Error ? err.message : String(err),
      });
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
