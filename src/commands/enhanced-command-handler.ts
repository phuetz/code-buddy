import { ChatEntry } from "../agent/codebuddy-agent.js";
import { handleGrillMe } from './handlers/grill-me-handler.js';
import { handleDeepthink } from './handlers/deepthink-handler.js';
import { CodeBuddyClient } from "../codebuddy/client.js";

// Import all handlers from modular files
import {
  // Branch handlers
  handleFork,
  handleBranches,
  handleCheckout,
  handleMerge,
  handleBranch,
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
  // Companion handler
  handleCompanion,
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
  handleUltraplan,
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
  // Permissions handlers (Enterprise-grade)
  handlePermissions,
  // Worktree handlers (Enterprise-grade)
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
  handlePlugin,
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
  // Think handler (Tree-of-Thought reasoning)
  handleThink,
  // Team handler (Agent Teams multi-agent coordination)
  handleTeam,
  // Batch handler (CC13 — parallel task decomposition)
  handleBatchCommand,
  // Starter pack handler
  handleStarter,
  // Fast mode handler (Enterprise-aligned)
  handleFastMode,
  // BTW handler (Native Engine v2026.3.14 alignment)
  handleBtw,
  setBtwClient,
  // Heartbeat handler (V4.x — wire user-facing activation of HeartbeatEngine)
  handleHeartbeat,
  // Goal handler (Hermes Agent parity — Ralph loop)
  handleGoal,
  handleSubgoal,
  // Daily reset handler (audit OpenClaw heritage activation)
  handleDailyReset,
  // Team session handler — slash /share (audit OpenClaw heritage activation, TeamSessionManager wake)
  handleShare,
  // Agents handler — slash /agents (audit OpenClaw heritage activation, MultiAgentSystem wake)
  handleAgents,
  handleSubagent,
  handleSwarm,
  // Fleet handler — slash /fleet (Phase (d).5 V0.4.1, inter-Claude WS streaming receiver)
  handleFleet,
  // Clipboard handler
  handleCopy,
  // PR handler (GitHub/GitLab PR creation)
  handlePR,
  // Switch handler (mid-conversation model switching)
  handleSwitch,
  setSwitchModelProvider,
  // Commands previously only handled in client-dispatcher
  handleChangeModel,
  handleChangeMode,
  handleClearChat,
  handleStatus,
  handleNew,
  handleFeatures,
  handleListCheckpoints,
  handleRestoreCheckpoint,
  handleInitGrok,
  handleReinitGrok,
  // Watch handler (file watcher trigger)
  handleWatch,
  // Conflicts handler (merge conflict resolution)
  handleConflicts,
  // Vulns handler (dependency vulnerability scanner)
  handleVulns,
  // Bug handler (static analysis bug scanner)
  handleBug,
  // Suggest handler (proactive suggestions)
  handleSuggest,
  // Telemetry handler (opt-in/opt-out toggle)
  handleTelemetry,
  // Quota handler (rate limit display)
  handleQuota,
  // Voice-code handler (voice-to-code pipeline)
  handleVoiceCode,
  // Coverage handler (coverage target checking)
  handleCoverage,
  // Transform handler (code transformation)
  handleTransform,
  // Dev handlers (golden-path developer workflows)
  handleDev,
  // Replace handler (codebase-wide find & replace)
  handleReplace,
  // Cloud handlers (background agent tasks)
  handleCloud,
  // Trigger handlers (event-driven webhook triggers)
  handleTrigger,
  // Infra handlers (TurboQuant health dashboard)
  handleInfra,
} from "./handlers/index.js";

import { handleLessonsCommand } from "./handlers/index.js";
import { handleContextStats } from "./handlers/extra-handlers.js";
import { handleLogin, handleLogout, handleWhoami } from "./handlers/auth-handlers.js";
import { handlePromptCommand as handlePromptCommandRaw } from "./slash/prompt-commands.js";
import {
  handleShortcuts,
  handleDebugMode,
  handleToolAnalytics,
  handleSecurityReview,
  handleIdentity,
  handlePairing,
  handleElevated,
  handlePolicy,
} from "./handlers/index.js";

import type { CommandHandlerResult } from "./handlers/index.js";

// Re-export CommandHandlerResult for external consumers
export type { CommandHandlerResult };

/** Handler for /docs-generate — runs the DeepWiki V2 docs pipeline */
async function handleDocsGenerate(): Promise<CommandHandlerResult> {
  try {
    const { getKnowledgeGraph } = await import('../knowledge/knowledge-graph.js');
    const { populateDeepCodeGraph } = await import('../knowledge/code-graph-deep-populator.js');
    const { runDocsPipeline } = await import('../docs/docs-pipeline.js');

    const graph = getKnowledgeGraph();

    // Load cached graph from disk if singleton is empty
    if (graph.getStats().tripleCount === 0) {
      try {
        const { loadCodeGraph, codeGraphExists } = await import('../knowledge/code-graph-persistence.js');
        if (codeGraphExists(process.cwd())) {
          loadCodeGraph(graph, process.cwd());
          process.stdout.write(`  [graph] Loaded ${graph.getStats().tripleCount} cached triples\n`);
        }
      } catch { /* persistence module optional */ }
    }

    // Populate if still low
    if (graph.getStats().tripleCount < 100) {
      process.stdout.write('  [graph] Scanning source files...\n');
      const added = populateDeepCodeGraph(graph, process.cwd());
      process.stdout.write(`  [graph] Added ${added} triples from source scan\n`);

      // Persist the newly built graph
      try {
        const { saveCodeGraph } = await import('../knowledge/code-graph-persistence.js');
        saveCodeGraph(graph, process.cwd());
      } catch { /* persistence optional */ }
    }

    if (graph.getStats().tripleCount < 10) {
      return {
        handled: true,
        entry: { type: 'assistant', content: 'Cannot generate docs: code graph is empty. Ensure source files exist.', timestamp: new Date() },
      };
    }

    const result = await runDocsPipeline(graph, {
      cwd: process.cwd(),
      forceDeterministicPlan: true,
      onProgress: (phase, detail) => {
        process.stdout.write(`  [${phase}] ${detail}\n`);
      },
    });

    const msg = `Documentation generated: ${result.pagesGenerated} pages, ${result.conceptsLinked} links in ${(result.durationMs / 1000).toFixed(1)}s → .codebuddy/docs/` +
      (result.errors.length > 0 ? `\nErrors: ${result.errors.join('; ')}` : '');

    return {
      handled: true,
      entry: { type: 'assistant', content: msg, timestamp: new Date() },
    };
  } catch (err) {
    return {
      handled: true,
      entry: { type: 'assistant', content: `Documentation generation failed: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
    };
  }
}

async function handlePromptCommand(args: string): Promise<CommandHandlerResult> {
  const output = await handlePromptCommandRaw(args);
  return {
    handled: true,
    entry: { type: 'assistant', content: output, timestamp: new Date() },
  };
}

/**
 * Handler function type for command dispatch.
 * Each handler receives the parsed args and returns a result.
 */
type CommandHandlerFn = (args: string[]) => Promise<CommandHandlerResult> | CommandHandlerResult;

/**
 * Proxy interface for agent context stats used by the /context stats command.
 */
export interface AgentContextProxy {
  getContextStats: () => unknown;
  formatContextStats: () => string;
  getCurrentModel: () => string;
  getContextMemoryMetrics?: () => {
    summaryCount: number;
    summaryTokens: number;
    peakMessageCount: number;
    compressionCount: number;
    totalTokensSaved: number;
    lastCompressionTime: Date | null;
    warningsTriggered: number;
  };
  getCompressionStats?: () => {
    totalCompressions: number;
    totalTokensSaved: number;
    averageCompressionRatio: number;
    lastCompression: Date | null;
    archivesAvailable: number;
    lastStrategiesUsed: string[];
  };
  getContextBudgetBreakdown?: () => Record<string, { chars: number; tokens: number; percent: number }>;
}

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
  private agentProxy: AgentContextProxy | null = null;

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
    ['__BRANCH__', (args) => handleBranch(args)],

    // Memory & TODOs
    ['__MEMORY__', (args) => handleMemory(args)],
    ['__REMEMBER__', (args) => handleRemember(args)],
    ['__SCAN_TODOS__', () => handleScanTodos()],
    ['__ADDRESS_TODO__', (args) => handleAddressTodo(args)],

    // Context & Workspace
    ['__WORKSPACE__', () => handleWorkspace()],
    ['__ADD_CONTEXT__', (args) => handleAddContext(args)],
    ['__CONTEXT__', (args) => args[0]?.toLowerCase() === 'stats'
      ? handleContextStats(args.slice(1), this.agentProxy ?? undefined)
      : handleContext(args)],

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
    ['__COMPANION__', (args) => handleCompanion(args)],

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

    // Authentication (ChatGPT OAuth — Phase d.23)
    ['__LOGIN__', (args) => handleLogin(args)],
    ['__LOGOUT__', (args) => handleLogout(args)],
    ['__WHOAMI__', () => handleWhoami()],

    // Permissions & Worktree (Enterprise-grade)
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
    ['__PLUGIN__', (args) => handlePlugin(args)],

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
    ['__PROMPT__', (args) => handlePromptCommand(args.join(' '))],

    // Tree-of-Thought reasoning
    ['__THINK__', (args) => handleThink(args)],

    // Agent Teams multi-agent coordination
    ['__TEAM__', (args) => handleTeam(args)],

    // CC13: Batch parallel task decomposition
    ['__BATCH__', (args) => {
      const result = handleBatchCommand(args.join(' '));
      // handleBatchCommand is async, wrap in a sync-compatible result
      return {
        handled: true,
        entry: { type: 'assistant' as const, content: 'Batch command initiated...', timestamp: new Date() },
        asyncAction: result,
      };
    }],

    // Commands previously handled inline in client-dispatcher
    ['__CLEAR_CHAT__', () => handleClearChat()],
    ['__CHANGE_MODEL__', (args) => handleChangeModel(args)],
    ['__CHANGE_MODE__', (args) => handleChangeMode(args)],
    ['__PLAN_MODE__', () => handleChangeMode(['plan'])],
    ['__STATUS__', () => handleStatus()],
    ['__NEW__', (args) => handleNew(args)],
    ['__ULTRAPLAN__', (args) => handleUltraplan(args)],
    ['__LIST_CHECKPOINTS__', (args) => handleListCheckpoints(args)],
    ['__RESTORE_CHECKPOINT__', (args) => handleRestoreCheckpoint(args)],
    ['__INIT_GROK__', (args) => handleInitGrok(args)],
    ['__REINIT_GROK__', () => handleReinitGrok()],
    ['__FEATURES__', () => handleFeatures()],
    ['__LESSONS__', (args) => handleLessonsCommand(args.join(' '))],
    ['__CONTEXT_STATS__', (args) => handleContextStats(args, this.agentProxy ?? undefined)],

    // Re-wired commands (audit phase 4)
    ['__SHORTCUTS__', () => handleShortcuts()],
    ['__DEBUG__', (args) => handleDebugMode(args)],
    ['__TOOL_ANALYTICS__', (args) => handleToolAnalytics(args)],

    // Security & identity commands (audit phase 5)
    ['__SECURITY_REVIEW__', (args) => handleSecurityReview(args)],
    ['__IDENTITY__', (args) => handleIdentity(args)],
    ['__PAIRING__', (args) => handlePairing(args)],
    ['__ELEVATED__', (args) => handleElevated(args)],
    ['__POLICY__', (args) => handlePolicy(args)],

    // Documentation V2 pipeline
    ['__DOCS_GENERATE__', () => handleDocsGenerate()],

    // Starter packs
    ['__STARTER__', (args) => handleStarter(args)],

    // Fast mode (Enterprise-aligned)
    ['__FAST_MODE__', (args) => handleFastMode(args)],

    // BTW side-question (Native Engine v2026.3.14 alignment)
    ['__BTW__', (args) => handleBtw(args)],
    ['__GRILL_ME__', (args) => handleGrillMe(args)],
    ['__DEEPTHINK__', (args) => handleDeepthink(args)],

    // Heartbeat engine activation (fleet AUTONOMOUS-FLEET-PROTOCOL v0.1)
    ['__HEARTBEAT__', (args) => handleHeartbeat(args)],

    // Standing goal — judge + auto-continue loop (Hermes Agent parity)
    ['__GOAL__', (args) => handleGoal(args, { client: this.codebuddyClient })],
    ['__SUBGOAL__', (args) => handleSubgoal(args)],

    // Daily reset scheduler (audit OpenClaw heritage activation)
    ['__DAILY_RESET__', (args) => handleDailyReset(args)],

    // Team session manager — slash /share (audit OpenClaw heritage, TeamSessionManager wake)
    ['__SHARE__', (args) => handleShare(args)],

    // Multi-agent system — slash /agents (audit OpenClaw heritage, MultiAgentSystem wake)
    ['__AGENTS__', (args) => handleAgents(args)],
    ['__SUBAGENT__', (args) => handleSubagent(args)],
    ['__SWARM__', (args) => handleSwarm(args)],

    // Fleet listener — slash /fleet (Phase (d).5 V0.4.1, inter-Claude streaming)
    ['__FLEET__', (args) => handleFleet(args)],

    // Clipboard (copy last response, code block, or text)
    ['__COPY__', (args) => handleCopy(args, this.conversationHistory)],

    // PR creation (GitHub/GitLab)
    ['__PR__', (args) => handlePR(args)],

    // Mid-conversation model switching
    ['__SWITCH__', (args) => handleSwitch(args)],

    // Multi-language lint runner
    ['__LINT__', (args) => this.handleLint(args)],

    // File watcher trigger
    ['__WATCH__', (args) => handleWatch(args)],

    // Merge conflict resolution
    ['__CONFLICTS__', (args) => handleConflicts(args)],

    // Dependency vulnerability scanner
    ['__VULNS__', (args) => handleVulns(args)],

    // Secrets scan
    ['__SECRETS_SCAN__', (args) => this.handleSecretsScan(args)],

    // Bug scanner (static analysis)
    ['__BUG__', (args) => handleBug(args)],

    // Proactive suggestions
    ['__SUGGEST__', (args) => handleSuggest(args)],

    // Telemetry opt-in/opt-out
    ['__TELEMETRY__', (args) => handleTelemetry(args)],

    // Rate limit / quota display
    ['__QUOTA__', () => handleQuota()],

    // Voice-to-code pipeline
    ['__VOICE_CODE__', (args) => handleVoiceCode(args)],

    // Coverage target checking
    ['__COVERAGE__', (args) => handleCoverage(args)],

    // Code transformation
    ['__TRANSFORM__', (args) => handleTransform(args)],

    // Golden-path developer workflows
    ['__DEV__', (args) => handleDev(args)],

    // Codebase-wide find & replace
    ['__REPLACE__', (args) => handleReplace(args)],

    // Cloud background agent tasks
    ['__CLOUD__', (args) => handleCloud(args)],

    // Event-driven webhook triggers
    ['__TRIGGER__', (args) => handleTrigger(args)],

    // Infra health dashboard (TurboQuant)
    ['__INFRA__', (args) => handleInfra(args)],
  ]);

  /**
   * Sets the conversation history for context-aware commands (e.g., save, compact).
   */
  setConversationHistory(history: ChatEntry[]): void {
    this.conversationHistory = history;
  }

  /**
   * Sets the agent context proxy for commands that need agent stats (e.g., /context stats).
   */
  setAgentProxy(proxy: AgentContextProxy): void {
    this.agentProxy = proxy;
  }

  /**
   * Sets the CodeBuddy client instance for commands that require client access.
   */
  setCodeBuddyClient(client: CodeBuddyClient): void {
    this.codebuddyClient = client;
    setBtwClient(client);
  }

  /**
   * Handle /lint command using the multi-language lint runner.
   */
  private async handleLint(args: string[]): Promise<CommandHandlerResult> {
    try {
      const { createLintRunner, formatLintResults, formatDetectedLinters } = await import('../tools/lint-runner.js');
      const runner = createLintRunner();
      const cwd = process.cwd();
      const action = args[0]?.toLowerCase() || 'run';

      const configs = await runner.detect(cwd);

      if (action === 'detect') {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: formatDetectedLinters(configs),
            timestamp: new Date(),
          },
        };
      }

      if (configs.length === 0) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: 'No linters detected for this project.\n\nSupported: eslint, ruff, clippy, golangci-lint, rubocop, phpstan.',
            timestamp: new Date(),
          },
        };
      }

      const availableConfigs = configs.filter((c: { available: boolean }) => c.available);
      if (availableConfigs.length === 0) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: formatDetectedLinters(configs) + '\n\nNo linter CLIs are installed. Install one to use /lint.',
            timestamp: new Date(),
          },
        };
      }

      const files = args.slice(1);
      const results = [];

      for (const config of availableConfigs) {
        if (action === 'fix') {
          results.push(await runner.fix(config, files.length > 0 ? files : undefined));
        } else {
          results.push(await runner.run(config, files.length > 0 ? files : undefined));
        }
      }

      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: formatLintResults(results),
          timestamp: new Date(),
        },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Lint error: ${msg}`,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Handle /secrets-scan command — scans project for hardcoded secrets.
   */
  private async handleSecretsScan(args: string[]): Promise<CommandHandlerResult> {
    try {
      const { scanForSecrets, formatFindings } = await import('../security/secrets-detector.js');
      const targetPath = args[0] || process.cwd();
      const findings = await scanForSecrets(targetPath);
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: formatFindings(findings),
          timestamp: new Date(),
        },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Secrets scan error: ${msg}`,
          timestamp: new Date(),
        },
      };
    }
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
