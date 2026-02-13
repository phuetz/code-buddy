import { CodeBuddyAgent, ChatEntry } from "../agent/codebuddy-agent.js";
import { getSlashCommandManager } from "./slash-commands.js";
import { getEnhancedCommandHandler } from "./enhanced-command-handler.js";
import { GitWorkflowHandler } from "./workflow/git-workflow.js";
import { getErrorMessage } from "../types/index.js";
import { ConfirmationService } from "../utils/confirmation-service.js";
import { getPersistentCheckpointManager } from "../checkpoints/persistent-checkpoint-manager.js";
import { initCodeBuddyProject, formatInitResult } from "../utils/init-project.js";
import { AgentMode } from "../agent/agent-mode.js";
import { updateCurrentModel } from "../utils/model-config.js";

export interface ClientCommandContext {
  agent: CodeBuddyAgent;
  chatHistory: ChatEntry[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatEntry[]>>;
  setIsProcessing: (processing: boolean) => void;
  setIsStreaming: (streaming: boolean) => void;
  setTokenCount: (count: number) => void;
  setProcessingTime: (time: number) => void;
  processingStartTime: React.MutableRefObject<number>;
  setInput: (input: string) => void;
  clearInput: () => void;
  resetHistory: () => void;
  setShowModelSelection: (show: boolean) => void;
  setSelectedModelIndex: (index: number) => void;
  availableModels: { model: string }[];
  processUserMessage: (input: string) => Promise<void>;
}

export class ClientCommandDispatcher {
  /**
   * Dispatches a command input to the appropriate handler.
   * @returns true if the input was handled as a command, false otherwise.
   */
  static async dispatch(
    input: string,
    context: ClientCommandContext
  ): Promise<boolean> {
    const trimmedInput = input.trim();

    // 1. Handle Slash Commands
    if (trimmedInput.startsWith("/")) {
      return await this.handleSlashCommand(trimmedInput, context);
    }

    // 2. Handle Shell Bypass
    if (trimmedInput.startsWith("!")) {
      await this.handleShellBypass(trimmedInput.slice(1).trim(), context);
      return true;
    }

    // 3. Handle Direct Bash Commands (Legacy/Quick Access)
    if (this.isDirectBashCommand(trimmedInput)) {
      await this.handleDirectBashCommand(trimmedInput, context);
      return true;
    }

    return false;
  }

  private static async handleSlashCommand(
    input: string,
    context: ClientCommandContext
  ): Promise<boolean> {
    const slashManager = getSlashCommandManager();
    const result = slashManager.execute(input);

    if (result.success && result.prompt) {
      // Handle Internal Special Commands
      if (await this.handleInternalCommand(result.prompt, input, context)) {
        return true;
      }

      // Handle Enhanced Commands (__COMMAND__)
      if (result.prompt.startsWith("__") && result.prompt.endsWith("__")) {
        return await this.handleEnhancedCommand(result.prompt, input, context);
      }
      
      // If it's a slash command that returns a prompt (but not special), send to AI
      await context.processUserMessage(result.prompt);
      context.clearInput();
      return true;

    } else if (!result.success) {
      // Legacy fallback for commands not in SlashCommandManager yet or explicit errors
      if (input === "/commit-and-push") {
        await GitWorkflowHandler.handleCommitAndPush(context);
        return true;
      }

      if (input === "/models") {
         context.setShowModelSelection(true);
         context.setSelectedModelIndex(0);
         context.clearInput();
         return true;
      }
      
      if (input.startsWith("/models ")) {
         await this.handleModelSwitch(input, context);
         return true;
      }

      if (input === "/exit") {
          process.exit(0);
      }

      // Show error if it was an unknown slash command
      const entry: ChatEntry = {
        type: "assistant",
        content: result.error || "Unknown command",
        timestamp: new Date(),
      };
      context.setChatHistory((prev) => [...prev, entry]);
      context.clearInput();
      return true;
    }

    return false;
  }

  private static async handleInternalCommand(
    token: string,
    originalInput: string,
    context: ClientCommandContext
  ): Promise<boolean> {
    switch (token) {
      case "__CLEAR_CHAT__":
        context.setChatHistory([]);
        context.setIsProcessing(false);
        context.setIsStreaming(false);
        context.setTokenCount(0);
        context.setProcessingTime(0);
        context.processingStartTime.current = 0;
        ConfirmationService.getInstance().resetSession();
        context.clearInput();
        context.resetHistory();
        return true;

      case "__CHANGE_MODEL__":
        context.setShowModelSelection(true);
        context.setSelectedModelIndex(0);
        context.clearInput();
        return true;

      case "__CHANGE_MODE__":
        this.handleChangeMode(originalInput, context);
        return true;

      case "__LIST_CHECKPOINTS__":
        this.handleListCheckpoints(context);
        return true;

      case "__RESTORE_CHECKPOINT__":
        this.handleRestoreCheckpoint(originalInput, context);
        return true;

      case "__INIT_GROK__":
        this.handleInitGrok(context);
        return true;
      
      case "__FEATURES__":
         const { handleFeaturesCommand } = await import("./features.js");
         const featuresEntry: ChatEntry = {
            type: "assistant",
            content: handleFeaturesCommand(),
            timestamp: new Date(),
         };
         context.setChatHistory((prev) => [...prev, featuresEntry]);
         context.clearInput();
         return true;

      case "__CONTEXT__": {
        // Intercept /context stats to provide agent context window stats
        const contextArgs = originalInput.trim().split(/\s+/).slice(1);
        if (contextArgs[0]?.toLowerCase() === 'stats') {
          const { handleContextStats } = await import("./handlers/extra-handlers.js");
          const agentProxy = {
            getContextStats: () => context.agent.getContextStats(),
            formatContextStats: () => context.agent.formatContextStats(),
            getCurrentModel: () => context.agent.getCurrentModel(),
          };
          const statsResult = await handleContextStats(contextArgs.slice(1), agentProxy);
          if (statsResult.entry) {
            context.setChatHistory((prev) => [...prev, statsResult.entry!]);
          }
          context.clearInput();
          return true;
        }
        // Fall through to enhanced handler for other /context subcommands
        return false;
      }

      default:
        // Not an internal command handled here
        return false;
    }
  }

  private static async handleEnhancedCommand(
    token: string,
    originalInput: string,
    context: ClientCommandContext
  ): Promise<boolean> {
      const enhancedHandler = getEnhancedCommandHandler();
      enhancedHandler.setConversationHistory(context.chatHistory);
      enhancedHandler.setCodeBuddyClient(context.agent.getClient());

      const args = originalInput.trim().split(" ").slice(1);
      const handlerResult = await enhancedHandler.handleCommand(
        token,
        args,
        originalInput
      );

      if (handlerResult.handled) {
        if (handlerResult.entry) {
          context.setChatHistory((prev) => [...prev, handlerResult.entry!]);
        }

        if (handlerResult.passToAI && handlerResult.prompt) {
          // Pass the generated prompt to the AI
          await context.processUserMessage(handlerResult.prompt);
        }

        context.clearInput();
        return true;
      }
      
      // If recognized as Enhanced Command token but not handled, fall through
      return false;
  }

  private static handleChangeMode(input: string, context: ClientCommandContext) {
      const args = input.trim().split(" ").slice(1);
      const mode = args[0] as AgentMode | undefined;
      if (mode && ["plan", "code", "ask"].includes(mode)) {
        context.agent.setMode(mode);
        const entry: ChatEntry = {
          type: "assistant",
          content: `✓ Switched to ${mode} mode`,
          timestamp: new Date(),
        };
        context.setChatHistory((prev) => [...prev, entry]);
      } else {
        const entry: ChatEntry = {
          type: "assistant",
          content: `Invalid mode. Available: plan, code, ask`,
          timestamp: new Date(),
        };
        context.setChatHistory((prev) => [...prev, entry]);
      }
      context.clearInput();
  }

  private static handleListCheckpoints(context: ClientCommandContext) {
      const checkpointManager = getPersistentCheckpointManager();
      const entry: ChatEntry = {
        type: "assistant",
        content: checkpointManager.formatCheckpointList(),
        timestamp: new Date(),
      };
      context.setChatHistory((prev) => [...prev, entry]);
      context.clearInput();
  }

  private static handleRestoreCheckpoint(input: string, context: ClientCommandContext) {
      const checkpointManager = getPersistentCheckpointManager();
      const args = input.trim().split(" ").slice(1);

      if (args.length === 0) {
        // Show checkpoints list
        const entry: ChatEntry = {
          type: "assistant",
          content: checkpointManager.formatCheckpointList(),
          timestamp: new Date(),
        };
        context.setChatHistory((prev) => [...prev, entry]);
      } else {
        // Restore specific checkpoint
        const checkpoints = checkpointManager.getCheckpoints();
        const arg = args[0];
        let checkpointId = arg;

        // If arg is a number, use it as index
        const index = parseInt(arg, 10);
        if (!isNaN(index) && index > 0 && index <= checkpoints.length) {
          checkpointId = checkpoints[index - 1].id;
        }

        const restoreResult = checkpointManager.restore(checkpointId);
        const entry: ChatEntry = {
          type: "assistant",
          content: restoreResult.success
            ? `✅ Restored checkpoint!\n\nFiles restored:\n${restoreResult.restored.map(f => `  • ${f}`).join('\n')}`
            : `❌ Failed to restore: ${restoreResult.errors.join(', ')}`,
          timestamp: new Date(),
        };
        context.setChatHistory((prev) => [...prev, entry]);
      }
      context.clearInput();
  }

  private static handleInitGrok(context: ClientCommandContext) {
      const initResult = initCodeBuddyProject();
      const entry: ChatEntry = {
        type: "assistant",
        content: formatInitResult(initResult),
        timestamp: new Date(),
      };
      context.setChatHistory((prev) => [...prev, entry]);
      context.clearInput();
  }

  private static async handleModelSwitch(input: string, context: ClientCommandContext) {
      const modelArg = input.trim().split(" ")[1];
      const modelNames = context.availableModels.map((m) => m.model);

      if (modelNames.includes(modelArg)) {
        context.agent.setModel(modelArg);
        updateCurrentModel(modelArg);
        const confirmEntry: ChatEntry = {
          type: "assistant",
          content: `✓ Switched to model: ${modelArg}`,
          timestamp: new Date(),
        };
        context.setChatHistory((prev) => [...prev, confirmEntry]);
      } else {
        const errorEntry: ChatEntry = {
          type: "assistant",
          content: `Invalid model: ${modelArg}\n\nAvailable models: ${modelNames.join(", ")}`,
          timestamp: new Date(),
        };
        context.setChatHistory((prev) => [...prev, errorEntry]);
      }
      context.clearInput();
  }

  private static async handleShellBypass(command: string, context: ClientCommandContext) {
    if (!command) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: "Usage: !<command> - Execute shell command directly\nExample: !ls -la",
        timestamp: new Date(),
      };
      context.setChatHistory((prev) => [...prev, errorEntry]);
      context.clearInput();
      return;
    }

    const userEntry: ChatEntry = {
      type: "user",
      content: `!${command}`,
      timestamp: new Date(),
    };
    context.setChatHistory((prev) => [...prev, userEntry]);

    try {
      const result = await context.agent.executeBashCommand(command);

      const commandEntry: ChatEntry = {
        type: "tool_result",
        content: result.success
          ? result.output || "Command completed"
          : result.error || "Command failed",
        timestamp: new Date(),
        toolCall: {
          id: `shell_bypass_${Date.now()}`,
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({ command }),
          },
        },
        toolResult: result,
      };
      context.setChatHistory((prev) => [...prev, commandEntry]);
    } catch (error) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Error executing command: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      };
      context.setChatHistory((prev) => [...prev, errorEntry]);
    }

    context.clearInput();
  }

  private static isDirectBashCommand(input: string): boolean {
    const directBashCommands = [
      "ls", "pwd", "cd", "cat", "mkdir", "touch", 
      "echo", "grep", "find", "cp", "mv", "rm"
    ];
    const firstWord = input.trim().split(" ")[0];
    return directBashCommands.includes(firstWord);
  }

  private static async handleDirectBashCommand(command: string, context: ClientCommandContext) {
      const userEntry: ChatEntry = {
        type: "user",
        content: command,
        timestamp: new Date(),
      };
      context.setChatHistory((prev) => [...prev, userEntry]);

      try {
        const result = await context.agent.executeBashCommand(command);

        const commandEntry: ChatEntry = {
          type: "tool_result",
          content: result.success
            ? result.output || "Command completed"
            : result.error || "Command failed",
          timestamp: new Date(),
          toolCall: {
            id: `bash_${Date.now()}`,
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command }),
            },
          },
          toolResult: result,
        };
        context.setChatHistory((prev) => [...prev, commandEntry]);
      } catch (error) {
        const errorEntry: ChatEntry = {
          type: "assistant",
          content: `Error executing command: ${getErrorMessage(error)}`,
          timestamp: new Date(),
        };
        context.setChatHistory((prev) => [...prev, errorEntry]);
      }

      context.clearInput();
  }
}
