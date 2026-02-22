import { ChatEntry } from "../agent/codebuddy-agent.js";
import { CodeBuddyClient } from "../codebuddy/client.js";

// Import all handlers from modular files
import {
  // Branch handlers
  handleFork,
  handleBranches,
  handleCheckout,
  handleMerge,
  // Memory handlers
  handleMemory,
  handleRemember,
  handleScanTodos,
  handleAddressTodo,
  // Stats handlers
  handleCost,
  handleStats,
  handleCache,
  handleSelfHealing,
  // Security handlers
  handleSecurity,
  handleDryRun,
  handleGuardian,
  // Voice handlers
  handleVoice,
  handleSpeak,
  handleTTS,
  // UI handlers
  handleTheme,
  handleAvatar,
  // Context handlers
  handleAddContext,
  handleContext,
  handleWorkspace,
  // Test handlers
  handleGenerateTests,
  handleAITest,
  // Core handlers
  handleHelp,
  handleYoloMode,
  handleAutonomy,
  handlePipeline,
  handleParallel,
  handleModelRouter,
  handleSkill,
  handleSaveConversation,
  // Export handlers
  handleExport,
  handleExportList,
  handleExportFormats,
  // Session handlers
  handleSessions,
  // History handlers
  handleHistory,
  // Agent handlers
  handleAgent,
  // Vibe handlers
  handleReload,
  handleLog,
  handleCompact,
  handleTools,
  handleVimMode,
  handleConfig,
  // Permissions handlers (Claude Code-inspired)
  handlePermissions,
  // Worktree handlers (Claude Code-inspired)
  handleWorktree,
  // Script handlers (FileCommander Enhanced-inspired)
  handleScript,
  // FCS handlers (100% FileCommander Compatible)
  handleFCS,
  // Research-based feature handlers
  handleTDD,
  handleWorkflow,
  handleHooks,
  handlePromptCache,
  // Track handlers (Conductor-inspired)
  handleTrack,
  // Plugin handlers
  handlePlugins,
  // Missing handlers (colab, diff)
  handleColab,
  handleDiffCheckpoints,
  // Extra handlers (UX slash commands)
  handleUndo,
  handleDiff,
  handleSearch,
  handleTest,
  handleFix,
  handleReview,
  handlePersonaCommand,
} from "./handlers/index.js";

import type { CommandHandlerResult } from "./handlers/index.js";

// Re-export CommandHandlerResult for external consumers
export type { CommandHandlerResult };

/**
 * Handler function type for command dispatch.
 * Each handler receives the parsed args and returns a result.
 */
type CommandHandlerFn = (args: string[]) => Promise<CommandHandlerResult> | CommandHandlerResult;

/**
 * Enhanced Command Handler.
 *
 * Processes special command tokens (starting with `__`) that are mapped from
 * slash commands. Uses a Map-based registry for O(1) dispatch instead of a
 * linear switch statement.
 *
 * Delegates specific command logic to modular handlers in `src/commands/handlers/`.
 */
export class EnhancedCommandHandler {
  private conversationHistory: ChatEntry[] = [];
  private codebuddyClient: CodeBuddyClient | null = null;

  /**
   * Command handler registry — maps tokens to handler functions.
   * Arrow functions capture `this` for context-dependent handlers.
   */
  private readonly handlerMap: Map<string, CommandHandlerFn> = new Map<string, CommandHandlerFn>([
    // Core commands
    ['__HELP__', () => handleHelp()],
    ['__YOLO_MODE__', (args) => handleYoloMode(args)],
    ['__AUTONOMY__', (args) => handleAutonomy(args)],
    ['__PIPELINE__', (args) => handlePipeline(args)],
    ['__PARALLEL__', (args) => handleParallel(args)],
    ['__MODEL_ROUTER__', (args) => handleModelRouter(args)],
    ['__SKILL__', (args) => handleSkill(args)],

    // Stats & Cost
    ['__COST__', (args) => handleCost(args)],
    ['__STATS__', (args) => handleStats(args)],
    ['__CACHE__', (args) => handleCache(args)],
    ['__SELF_HEALING__', (args) => handleSelfHealing(args)],

    // Security
    ['__SECURITY__', (args) => handleSecurity(args)],
    ['__DRY_RUN__', (args) => handleDryRun(args)],
    ['__GUARDIAN__', (args) => handleGuardian(args)],

    // Branch management
    ['__FORK__', (args) => handleFork(args)],
    ['__BRANCHES__', () => handleBranches()],
    ['__CHECKOUT__', (args) => handleCheckout(args)],
    ['__MERGE__', (args) => handleMerge(args)],

    // Memory & TODOs
    ['__MEMORY__', (args) => handleMemory(args)],
    ['__REMEMBER__', (args) => handleRemember(args)],
    ['__SCAN_TODOS__', () => handleScanTodos()],
    ['__ADDRESS_TODO__', (args) => handleAddressTodo(args)],

    // Context & Workspace
    ['__WORKSPACE__', () => handleWorkspace()],
    ['__ADD_CONTEXT__', (args) => handleAddContext(args)],
    ['__CONTEXT__', (args) => handleContext(args)],

    // Export (context-dependent: conversationHistory)
    ['__SAVE_CONVERSATION__', (args) => handleSaveConversation(args, this.conversationHistory)],
    ['__EXPORT__', (args) => handleExport(args)],
    ['__EXPORT_LIST__', () => handleExportList()],
    ['__EXPORT_FORMATS__', () => handleExportFormats()],

    // Testing (context-dependent: codebuddyClient)
    ['__GENERATE_TESTS__', (args) => handleGenerateTests(args)],
    ['__AI_TEST__', (args) => handleAITest(args, this.codebuddyClient)],

    // UI
    ['__THEME__', (args) => handleTheme(args)],
    ['__AVATAR__', (args) => handleAvatar(args)],

    // Voice & TTS
    ['__VOICE__', (args) => handleVoice(args)],
    ['__SPEAK__', (args) => handleSpeak(args)],
    ['__TTS__', (args) => handleTTS(args)],

    // Sessions & History
    ['__SESSIONS__', (args) => handleSessions(args)],
    ['__HISTORY__', (args) => handleHistory(args)],

    // Custom Agents
    ['__AGENT__', (args) => handleAgent(args)],

    // Vibe-inspired commands (context-dependent: conversationHistory)
    ['__RELOAD__', () => handleReload()],
    ['__LOG__', () => handleLog()],
    ['__COMPACT__', (args) => handleCompact(args, this.conversationHistory)],
    ['__TOOLS__', (args) => handleTools(args)],
    ['__VIM_MODE__', (args) => handleVimMode(args)],
    ['__CONFIG__', (args) => handleConfig(args)],

    // Permissions & Worktree (Claude Code-inspired)
    ['__PERMISSIONS__', (args) => handlePermissions(args)],
    ['__WORKTREE__', (args) => handleWorktree(args)],

    // Script & FCS execution
    ['__SCRIPT__', (args) => handleScript(args)],
    ['__FCS__', (args) => handleFCS(args)],

    // Research-based features
    ['__TDD_MODE__', (args) => handleTDD(args)],
    ['__WORKFLOW__', (args) => handleWorkflow(args)],
    ['__HOOKS__', (args) => handleHooks(args)],
    ['__PROMPT_CACHE__', (args) => handlePromptCache(args)],

    // Track System (Conductor-inspired)
    ['__TRACK__', (args) => handleTrack(args)],
    ['__PLUGINS__', (args) => handlePlugins(args)],

    // Collaboration & Diff
    ['__COLAB__', (args) => handleColab(args)],
    ['__DIFF_CHECKPOINTS__', (args) => handleDiffCheckpoints(args)],

    // Extra UX commands
    ['__UNDO__', (args) => handleUndo(args)],
    ['__DIFF__', (args) => args.length > 0 ? handleDiffCheckpoints(args) : handleDiff(args)],
    ['__SEARCH__', (args) => handleSearch(args)],
    ['__TEST__', (args) => handleTest(args)],
    ['__FIX__', (args) => handleFix(args)],
    ['__REVIEW__', (args) => handleReview(args)],
    ['__PERSONA__', (args) => handlePersonaCommand(args.join(' '))],
  ]);

  /**
   * Sets the conversation history for context-aware commands (e.g., save, compact).
   */
  setConversationHistory(history: ChatEntry[]): void {
    this.conversationHistory = history;
  }

  /**
   * Sets the CodeBuddy client instance for commands that require client access.
   */
  setCodeBuddyClient(client: CodeBuddyClient): void {
    this.codebuddyClient = client;
  }

  /**
   * Handles a special command token via Map-based O(1) dispatch.
   *
   * @param token - The command token (e.g., `__HELP__`, `__YOLO_MODE__`).
   * @param args - Arguments passed to the command.
   * @param _fullInput - The full input string (available but unused by most handlers).
   * @returns A promise resolving to the command result.
   */
  async handleCommand(
    token: string,
    args: string[],
    _fullInput: string
  ): Promise<CommandHandlerResult> {
    const handler = this.handlerMap.get(token);
    if (handler) {
      return handler(args);
    }
    return { handled: false };
  }

  /**
   * Get all registered command tokens.
   * Useful for introspection, help generation, and testing.
   */
  getRegisteredTokens(): string[] {
    return Array.from(this.handlerMap.keys());
  }
}

// Singleton instance
let enhancedCommandHandlerInstance: EnhancedCommandHandler | null = null;

/**
 * Gets the singleton instance of EnhancedCommandHandler.
 *
 * @returns The singleton instance.
 */
export function getEnhancedCommandHandler(): EnhancedCommandHandler {
  if (!enhancedCommandHandlerInstance) {
    enhancedCommandHandlerInstance = new EnhancedCommandHandler();
  }
  return enhancedCommandHandlerInstance;
}

/**
 * Resets the singleton instance of EnhancedCommandHandler.
 * Primarily used for testing.
 */
export function resetEnhancedCommandHandler(): void {
  enhancedCommandHandlerInstance = null;
}