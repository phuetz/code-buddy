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
  // Agent handlers
  handleAgent,
  // Vibe handlers
  handleReload,
  handleLog,
  handleCompact,
  handleTools,
  handleVimMode,
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
  handleModelRouterCommand,
  // Track handlers (Conductor-inspired)
  handleTrack,
  // Type
  CommandHandlerResult,
} from "./handlers/index.js";

// Re-export CommandHandlerResult for external consumers
export { CommandHandlerResult };

/**
 * Enhanced Command Handler - Processes special command tokens
 * Returns the chat entry to display, or null if command should be passed to AI
 */
export class EnhancedCommandHandler {
  private conversationHistory: ChatEntry[] = [];
  private codebuddyClient: CodeBuddyClient | null = null;

  setConversationHistory(history: ChatEntry[]): void {
    this.conversationHistory = history;
  }

  setCodeBuddyClient(client: CodeBuddyClient): void {
    this.codebuddyClient = client;
  }

  /**
   * Handle a special command token
   */
  async handleCommand(
    token: string,
    args: string[],
    _fullInput: string
  ): Promise<CommandHandlerResult> {
    switch (token) {
      // Core commands
      case "__HELP__":
        return handleHelp();

      case "__YOLO_MODE__":
        return handleYoloMode(args);

      case "__AUTONOMY__":
        return handleAutonomy(args);

      case "__PIPELINE__":
        return handlePipeline(args);

      case "__PARALLEL__":
        return handleParallel(args);

      case "__MODEL_ROUTER__":
        return handleModelRouter(args);

      case "__SKILL__":
        return handleSkill(args);

      // Stats & Cost
      case "__COST__":
        return handleCost(args);

      case "__STATS__":
        return handleStats(args);

      case "__CACHE__":
        return handleCache(args);

      case "__SELF_HEALING__":
        return handleSelfHealing(args);

      // Security
      case "__SECURITY__":
        return handleSecurity(args);

      case "__DRY_RUN__":
        return handleDryRun(args);

      case "__GUARDIAN__":
        return handleGuardian(args);

      // Branch management
      case "__FORK__":
        return handleFork(args);

      case "__BRANCHES__":
        return handleBranches();

      case "__CHECKOUT__":
        return handleCheckout(args);

      case "__MERGE__":
        return handleMerge(args);

      // Memory & TODOs
      case "__MEMORY__":
        return handleMemory(args);

      case "__REMEMBER__":
        return handleRemember(args);

      case "__SCAN_TODOS__":
        return handleScanTodos();

      case "__ADDRESS_TODO__":
        return handleAddressTodo(args);

      // Context & Workspace
      case "__WORKSPACE__":
        return handleWorkspace();

      case "__ADD_CONTEXT__":
        return handleAddContext(args);

      case "__CONTEXT__":
        return handleContext(args);

      // Export
      case "__SAVE_CONVERSATION__":
        return handleSaveConversation(args, this.conversationHistory);

      case "__EXPORT__":
        return handleExport(args);

      case "__EXPORT_LIST__":
        return handleExportList();

      case "__EXPORT_FORMATS__":
        return handleExportFormats();

      // Testing
      case "__GENERATE_TESTS__":
        return handleGenerateTests(args);

      case "__AI_TEST__":
        return handleAITest(args, this.codebuddyClient);

      // UI
      case "__THEME__":
        return handleTheme(args);

      case "__AVATAR__":
        return handleAvatar(args);

      // Voice & TTS
      case "__VOICE__":
        return handleVoice(args);

      case "__SPEAK__":
        return handleSpeak(args);

      case "__TTS__":
        return handleTTS(args);

      // Sessions
      case "__SESSIONS__":
        return handleSessions(args);

      // Custom Agents
      case "__AGENT__":
        return handleAgent(args);

      // Vibe-inspired commands
      case "__RELOAD__":
        return handleReload();

      case "__LOG__":
        return handleLog();

      case "__COMPACT__":
        return handleCompact(args, this.conversationHistory);

      case "__TOOLS__":
        return handleTools(args);

      case "__VIM_MODE__":
        return handleVimMode(args);

      // Permissions (Claude Code-inspired)
      case "__PERMISSIONS__":
        return handlePermissions(args);

      // Git worktrees (Claude Code-inspired)
      case "__WORKTREE__":
        return handleWorktree(args);

      // Script execution (FileCommander Enhanced-inspired)
      case "__SCRIPT__":
        return handleScript(args);

      // FCS execution (100% FileCommander Compatible)
      case "__FCS__":
        return handleFCS(args);

      // Research-based features (TDD, CI/CD, Hooks, Caching)
      case "__TDD_MODE__":
        return handleTDD(args);

      case "__WORKFLOW__":
        return handleWorkflow(args);

      case "__HOOKS__":
        return handleHooks(args);

      case "__PROMPT_CACHE__":
        return handlePromptCache(args);

      // Track System (Conductor-inspired)
      case "__TRACK__":
        return handleTrack(args);

      default:
        return { handled: false };
    }
  }
}

// Singleton instance
let enhancedCommandHandlerInstance: EnhancedCommandHandler | null = null;

export function getEnhancedCommandHandler(): EnhancedCommandHandler {
  if (!enhancedCommandHandlerInstance) {
    enhancedCommandHandlerInstance = new EnhancedCommandHandler();
  }
  return enhancedCommandHandlerInstance;
}

export function resetEnhancedCommandHandler(): void {
  enhancedCommandHandlerInstance = null;
}
