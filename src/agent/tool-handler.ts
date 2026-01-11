/**
 * Tool Handler
 * Encapsulates tool management and execution logic
 */

import {
  TextEditorTool,
  MorphEditorTool,
  BashTool,
  TodoTool,
  SearchTool,
  WebSearchTool,
  ImageTool,
  ReasoningTool,
  BrowserTool,
} from "../tools/index.js";
import { CodeBuddyToolCall } from "../codebuddy/client.js";
import { ToolResult } from "../types/index.js";
import { CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { HooksManager } from "../hooks/lifecycle-hooks.js";
import { PluginMarketplace } from "../plugins/marketplace.js";
import { getMCPManager } from "../codebuddy/tools.js";
import { getErrorMessage } from "../types/errors.js";
import { logger } from "../utils/logger.js";

export interface ToolHandlerDependencies {
  checkpointManager: CheckpointManager;
  hooksManager: HooksManager;
  marketplace: PluginMarketplace;
  autoRepairCallback?: (error: string, command: string) => Promise<{ success: boolean; fixes: string[]; message: string }>;
  autoRepairEnabled?: boolean;
}

export class ToolHandler {
  // Lazy-loaded tool instances
  private _textEditor: TextEditorTool | null = null;
  private _morphEditor: MorphEditorTool | null | undefined = undefined;
  private _bash: BashTool | null = null;
  private _todoTool: TodoTool | null = null;
  private _search: SearchTool | null = null;
  private _webSearch: WebSearchTool | null = null;
  private _imageTool: ImageTool | null = null;
  private _reasoningTool: ReasoningTool | null = null;
  private _browserTool: BrowserTool | null = null;

  constructor(private deps: ToolHandlerDependencies) {}

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

  public get bash(): BashTool {
    if (!this._bash) {
      this._bash = new BashTool();
    }
    return this._bash;
  }

  public get todoTool(): TodoTool {
    if (!this._todoTool) {
      this._todoTool = new TodoTool();
    }
    return this._todoTool;
  }

  public get search(): SearchTool {
    if (!this._search) {
      this._search = new SearchTool();
    }
    return this._search;
  }

  public get webSearch(): WebSearchTool {
    if (!this._webSearch) {
      this._webSearch = new WebSearchTool();
    }
    return this._webSearch;
  }

  public get imageTool(): ImageTool {
    if (!this._imageTool) {
      this._imageTool = new ImageTool();
    }
    return this._imageTool;
  }

  public get reasoningTool(): ReasoningTool {
    if (!this._reasoningTool) {
      this._reasoningTool = new ReasoningTool();
    }
    return this._reasoningTool;
  }

  public get browserTool(): BrowserTool {
    if (!this._browserTool) {
      this._browserTool = new BrowserTool();
    }
    return this._browserTool;
  }

  public async executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);

      switch (toolCall.function.name) {
        case "view_file":
          const range: [number, number] | undefined =
            args.start_line && args.end_line
              ? [args.start_line, args.end_line]
              : undefined;
          return await this.textEditor.view(args.path, range);

        case "create_file": {
          // Create checkpoint before creating file
          this.deps.checkpointManager.checkpointBeforeCreate(args.path);

          // Execute pre-edit hooks
          await this.deps.hooksManager.executeHooks("pre-edit", {
            file: args.path,
            content: args.content,
          });

          const createResult = await this.textEditor.create(args.path, args.content);

          // Execute post-edit hooks
          await this.deps.hooksManager.executeHooks("post-edit", {
            file: args.path,
            content: args.content,
            output: createResult.output,
          });

          return createResult;
        }

        case "str_replace_editor": {
          // Create checkpoint before editing file
          this.deps.checkpointManager.checkpointBeforeEdit(args.path);

          // Execute pre-edit hooks
          await this.deps.hooksManager.executeHooks("pre-edit", {
            file: args.path,
            content: args.new_str,
          });

          const editResult = await this.textEditor.strReplace(
            args.path,
            args.old_str,
            args.new_str,
            args.replace_all
          );

          // Execute post-edit hooks
          await this.deps.hooksManager.executeHooks("post-edit", {
            file: args.path,
            content: args.new_str,
            output: editResult.output,
          });

          return editResult;
        }

        case "edit_file":
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

        case "bash": {
          // Execute pre-bash hooks
          try {
            await this.deps.hooksManager.executeHooks("pre-bash", {
              command: args.command,
            });
          } catch (hookError) {
            logger.warn("Pre-bash hook failed, continuing with execution", { error: getErrorMessage(hookError) });
          }

          let bashResult = await this.bash.execute(args.command);

          // INTEGRATION: Auto-repair on failure
          if (!bashResult.success && bashResult.error && this.deps.autoRepairEnabled && this.deps.autoRepairCallback) {
            const repairResult = await this.deps.autoRepairCallback(bashResult.error, args.command);
            
            if (repairResult.success) {
              logger.info(`Retrying command after successful repair: ${args.command}`);
              const retryResult = await this.bash.execute(args.command);
              
              if (retryResult.success) {
                bashResult = {
                  ...retryResult,
                  output: `[Auto-repaired: ${repairResult.fixes.join(', ')}]

${retryResult.output}`
                };
              } else {
                bashResult.output = (bashResult.output || '') + 
                  `

[Auto-repair applied but command still fails: ${repairResult.fixes.join(', ')}]`;
              }
            }
          }

          // Execute post-bash hooks
          try {
            await this.deps.hooksManager.executeHooks("post-bash", {
              command: args.command,
              output: bashResult.output,
              error: bashResult.error,
            });
          } catch (hookError) {
            logger.warn("Post-bash hook failed", { error: getErrorMessage(hookError) });
          }

          return bashResult;
        }

        case "create_todo_list":
          return await this.todoTool.createTodoList(args.todos);

        case "update_todo_list":
          return await this.todoTool.updateTodoList(args.updates);

        case "search":
          return await this.search.search(args.query, {
            searchType: args.search_type,
            includePattern: args.include_pattern,
            excludePattern: args.exclude_pattern,
            caseSensitive: args.case_sensitive,
            wholeWord: args.whole_word,
            regex: args.regex,
            maxResults: args.max_results,
            fileTypes: args.file_types,
            includeHidden: args.include_hidden,
          });

        case "find_symbols":
          return await this.search.findSymbols(args.name, {
            types: args.types,
            exportedOnly: args.exported_only,
          });

        case "find_references":
          return await this.search.findReferences(
            args.symbol_name,
            args.context_lines ?? 2
          );

        case "find_definition":
          return await this.search.findDefinition(args.symbol_name);

        case "search_multi":
          return await this.search.searchMultiple(
            args.patterns,
            args.operator ?? "OR"
          );

        case "web_search":
          return await this.webSearch.search(args.query, {
            maxResults: args.max_results,
          });

        case "web_fetch":
          return await this.webSearch.fetchPage(args.url);

        case "browser":
          return await this.browserTool.execute({
            action: args.action,
            url: args.url,
            selector: args.selector,
            value: args.value,
            script: args.script,
            timeout: args.timeout,
            screenshotOptions: args.screenshotOptions,
            scrollOptions: args.scrollOptions,
          });

        case "reason":
          return await this.reasoningTool.execute({
            problem: args.problem,
            context: args.context,
            mode: args.mode,
            constraints: args.constraints,
          });

        default:
          // Check if this is an MCP tool
          if (toolCall.function.name.startsWith("mcp__")) {
            return await this.executeMCPTool(toolCall);
          }

          // Check if this is a plugin tool
          if (toolCall.function.name.startsWith("plugin__")) {
            return await this.executePluginTool(toolCall);
          }

          return {
            success: false,
            error: `Unknown tool: ${toolCall.function.name}`,
          };
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Tool execution error: ${getErrorMessage(error)}`,
      };
    }
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
