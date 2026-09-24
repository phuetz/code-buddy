import { ChatEntry } from "../agent/codebuddy-agent.js";
import { handleGrillMe } from './handlers/grill-me-handler.js';
import { handleDeepthink } from './handlers/deepthink-handler.js';
import { CodeBuddyClient } from "../codebuddy/client.js";
import { withFactsMemorySessionClient } from "../memory/facts-memory.js";

// Import all handlers from modular files
import {
  handleFork,
  handleBranches,
  handleCheckout,
  handleMerge,
  handleBranch,
  handleMemory,
  handleRemember,
  handleScanTodos,
  handleAddressTodo,
  handleCost,
  handleStats,
  handleCache,
  handleSelfHealing,
  handleSecurity,
  handleDryRun,
  handleGuardian,
  handleVoice,
  handleSpeak,
  handleTTS,
  handleCompanion,
  handleTheme,
  handleAvatar,
  handleAddContext,
  handleContext,
  handleWorkspace,
  handleGenerateTests,
  handleAITest,
  handleHelp,
  handleYoloMode,
  handleAutonomy,
  handlePipeline,
  handleParallel,
  handleModelRouter,
  handleSkill,
  handleSaveConversation,
  handleUltraplan,
  handleExport,
  handleExportList,
  handleExportFormats,
  handleSessions,
  handleHistory,
  handleAgent,
  handleReload,
  handleLog,
  handleCompact,
  handleTools,
  handleVimMode,
  handleConfig,
  handlePermissions,
  handleWorktree,
  handleScript,
  handleFCS,
  handleTDD,
  handleWorkflow,
  handleHooks,
  handlePromptCache,
  handleTrack,
  handlePlugins,
  handlePlugin,
  handleColab,
  handleDiffCheckpoints,
  handleUndo,
  handleDiff,
  handleSearch,
  handleTest,
  handleFix,
  handleReview,
  handlePersonaCommand,
  handleThink,
  handleTeam,
  handleBatchSlashCommand,
  createBatchChatFn,
  createDefaultBatchSpawnFn,
  handleStarter,
  handleFastMode,
  handleBtw,
  setBtwClient,
  handleHeartbeat,
  handleCompanionLoops,
  handleGoal,
  handleLoop,
  handleSubgoal,
  handleDailyReset,
  handleShare,
  handleAgents,
  handleSubagent,
  handleSwarm,
  handleFleet,
  handleCopy,
  handlePR,
  handleSwitch,
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
  handleWatch,
  handleConflicts,
  handleVulns,
  handleBug,
  handleSuggest,
  handleTelemetry,
  handleQuota,
  handleVoiceCode,
  handleCoverage,
  handleTransform,
  handleDev,
  handleReplace,
  handleCloud,
  handleTrigger,
  handleInfra,
  handleRedo,
  handleTimeline,
  handleKnowledgeGraph,
  handleApprovals,
} from "./handlers/index.js";

import { handleLessonsCommand } from "./handlers/index.js";
import { handleContextStats } from "./handlers/extra-handlers.js";
import { handleResources } from "./handlers/resources-handler.js";
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
import { failureFlag } from './slash-failure.js';

export type { CommandHandlerResult };

async function handleDocsGenerate(): Promise<CommandHandlerResult> {
  try {
    const { getKnowledgeGraph } = await import('../knowledge/knowledge-graph.js');
    const { populateDeepCodeGraph } = await import('../knowledge/code-graph-deep-populator.js');
    const { runDocsPipeline } = await import('../docs/docs-pipeline.js');
    const graph = getKnowledgeGraph();
    if (graph.getStats().tripleCount === 0) {
      try {
        const { loadCodeGraph, codeGraphExists } = await import('../knowledge/code-graph-persistence.js');
        if (codeGraphExists(process.cwd())) {
          loadCodeGraph(graph, process.cwd());
          process.stdout.write(`  [graph] Loaded ${graph.getStats().tripleCount} cached triples\n`);
        }
      } catch { /* persistence module optional */ }
    }
    if (graph.getStats().tripleCount < 100) {
      process.stdout.write('  [graph] Scanning source files...\n');
      const added = populateDeepCodeGraph(graph, process.cwd());
      process.stdout.write(`  [graph] Added ${added} triples from source scan\n`);
      try {
        const { saveCodeGraph } = await import('../knowledge/code-graph-persistence.js');
        saveCodeGraph(graph, process.cwd());
      } catch { /* persistence optional */ }
    }
    if (graph.getStats().tripleCount < 10) {
      return {
        handled: true,
...failureFlag('Cannot generate docs: code graph is empty. Ensure source files exist.'),
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
...failureFlag(msg),
      entry: { type: 'assistant', content: msg, timestamp: new Date() },
    };
  } catch (err) {
    const content = `Documentation generation failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      handled: true,
      ...failureFlag(content),
      entry: { type: 'assistant', content, timestamp: new Date() },
    };
  }
}

async function handlePromptCommand(args: string): Promise<CommandHandlerResult> {
  const output = await handlePromptCommandRaw(args);
  return {
    handled: true,
...failureFlag(output),
    entry: { type: 'assistant', content: output, timestamp: new Date() },
  };
}

interface LegacyHandlerFields {
  output?: unknown;
  error?: unknown;
  response?: unknown;
  message?: unknown;
}

export function normalizeHandlerResult(result: CommandHandlerResult): CommandHandlerResult {
  if (!result.handled || result.entry) {
    return result;
  }
  const legacy = result as CommandHandlerResult & LegacyHandlerFields;
  const text = [legacy.output, legacy.response, legacy.message, legacy.error]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (!text) {
    return result;
  }
  return {
    ...result,
    entry: { type: 'assistant', content: text, timestamp: new Date() },
  };
}

type CommandHandlerFn = (args: string[]) => Promise<CommandHandlerResult> | CommandHandlerResult;

export interface AgentContextProxy {
  getMemoryScope?: () => { cwd: string; botId?: string };
  getContextStats: () => unknown;
  formatContextStats: () => string;
  getCurrentModel: () => string;
  getCurrentSessionId?: () => string | null;
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

export class EnhancedCommandHandler {
  private conversationHistory: ChatEntry[] = [];
  private codebuddyClient: CodeBuddyClient | null = null;
  private agentProxy: AgentContextProxy | null = null;

  private readonly handlerMap: Map<string, CommandHandlerFn> = new Map<string, CommandHandlerFn>([
    ['__HELP__', () => handleHelp()],
    ['__YOLO_MODE__', (args) => handleYoloMode(args)],
    ['__AUTONOMY__', (args) => handleAutonomy(args)],
    ['__PIPELINE__', (args) => handlePipeline(args)],
    ['__PARALLEL__', (args) => handleParallel(args)],
    ['__MODEL_ROUTER__', (args) => handleModelRouter(args)],
    ['__SKILL__', (args) => handleSkill(args)],
    ['__COST__', (args) => handleCost(args)],
    ['__STATS__', (args) => handleStats(args)],
    ['__CACHE__', (args) => handleCache(args)],
    ['__SELF_HEALING__', (args) => handleSelfHealing(args)],
    ['__SECURITY__', (args) => handleSecurity(args)],
    ['__DRY_RUN__', (args) => handleDryRun(args)],
    ['__GUARDIAN__', (args) => handleGuardian(args)],
    ['__FORK__', (args) => handleFork(args)],
    ['__BRANCHES__', () => handleBranches()],
    ['__CHECKOUT__', (args) => handleCheckout(args)],
    ['__MERGE__', (args) => handleMerge(args)],
    ['__BRANCH__', (args) => handleBranch(args)],
    ['__MEMORY__', (args) => this.agentProxy?.getMemoryScope ? handleMemory(args, this.agentProxy.getMemoryScope()) : handleMemory(args)],
    ['__REMEMBER__', (args) => this.agentProxy?.getMemoryScope ? handleRemember(args, this.agentProxy.getMemoryScope()) : handleRemember(args)],
    ['__SCAN_TODOS__', () => handleScanTodos()],
    ['__ADDRESS_TODO__', (args) => handleAddressTodo(args)],
    ['__WORKSPACE__', () => handleWorkspace()],
    ['__ADD_CONTEXT__', (args) => handleAddContext(args)],
    ['__CONTEXT__', (args) => args[0]?.toLowerCase() === 'stats'
      ? handleContextStats(args.slice(1), this.agentProxy ?? undefined)
      : handleContext(args)],
    ['__SAVE_CONVERSATION__', (args) => handleSaveConversation(args, this.conversationHistory)],
    ['__EXPORT__', (args) => handleExport(args, this.conversationHistory, this.agentProxy?.getCurrentModel())],
    ['__EXPORT_LIST__', () => handleExportList()],
    ['__EXPORT_FORMATS__', () => handleExportFormats()],
    ['__GENERATE_TESTS__', (args) => handleGenerateTests(args)],
    ['__AI_TEST__', (args) => handleAITest(args, this.codebuddyClient)],
    ['__THEME__', (args) => handleTheme(args)],
    ['__AVATAR__', (args) => handleAvatar(args)],
    ['__VOICE__', (args) => handleVoice(args)],
    ['__SPEAK__', (args) => handleSpeak(args)],
    ['__TTS__', (args) => handleTTS(args)],
    ['__COMPANION__', (args) => handleCompanion(args)],
    ['__SESSIONS__', (args) => handleSessions(args)],
    ['__HISTORY__', (args) => handleHistory(args)],
    ['__AGENT__', (args) => handleAgent(args)],
    ['__RELOAD__', () => handleReload()],
    ['__LOG__', () => handleLog()],
    ['__COMPACT__', (args) => handleCompact(args, this.conversationHistory)],
    ['__TOOLS__', (args) => handleTools(args)],
    ['__VIM_MODE__', (args) => handleVimMode(args)],
    ['__CONFIG__', (args) => handleConfig(args)],
    ['__LOGIN__', (args) => handleLogin(args)],
    ['__LOGOUT__', (args) => handleLogout(args)],
    ['__WHOAMI__', () => handleWhoami()],
    ['__PERMISSIONS__', (args) => handlePermissions(args)],
    ['__WORKTREE__', (args) => handleWorktree(args)],
    ['__SCRIPT__', (args) => handleScript(args)],
    ['__FCS__', (args) => handleFCS(args)],
    ['__TDD_MODE__', (args) => handleTDD(args)],
    ['__WORKFLOW__', (args) => handleWorkflow(args)],
    ['__HOOKS__', (args) => handleHooks(args)],
    ['__PROMPT_CACHE__', (args) => handlePromptCache(args)],
    ['__TRACK__', (args) => handleTrack(args)],
    ['__PLUGINS__', (args) => handlePlugins(args)],
    ['__PLUGIN__', (args) => handlePlugin(args)],
    ['__COLAB__', (args) => handleColab(args)],
    ['__DIFF_CHECKPOINTS__', (args) => handleDiffCheckpoints(args)],
    ['__REDO__', (args) => handleRedo(args)],
    ['__TIMELINE__', (args) => handleTimeline(args, this.agentProxy?.getCurrentSessionId?.())],
    ['__KNOWLEDGE_GRAPH__', (args) => handleKnowledgeGraph(args)],
    ['__APPROVALS__', (args) => handleApprovals(args)],
    ['__UNDO__', (args) => handleUndo(args)],
    ['__DIFF__', (args) => args.length > 0 ? handleDiffCheckpoints(args) : handleDiff(args)],
    ['__SEARCH__', (args) => handleSearch(args)],
    ['__TEST__', (args) => handleTest(args)],
    ['__FIX__', (args) => handleFix(args)],
    ['__REVIEW__', (args) => handleReview(args)],
    ['__PERSONA__', (args) => handlePersonaCommand(args.join(' '))],
    ['__PROMPT__', (args) => handlePromptCommand(args.join(' '))],
    ['__THINK__', (args) => handleThink(args)],
    ['__TEAM__', (args) => handleTeam(args)],
    ['__BATCH__', (args) => handleBatchSlashCommand(
      args,
      this.createBatchChatFn(),
      this.createBatchSpawnFn(),
    )],
    ['__CLEAR_CHAT__', () => handleClearChat()],
    ['__CHANGE_MODEL__', (args) => handleChangeModel(args, this.agentProxy?.getCurrentModel())],
    ['__CHANGE_MODE__', (args) => handleChangeMode(args)],
    ['__PLAN_MODE__', () => handleChangeMode(['plan'])],
    ['__STATUS__', () => handleStatus(this.agentProxy?.getCurrentModel())],
    ['__RESOURCES__', () => handleResources()],
    ['__NEW__', (args) => handleNew(args)],
    ['__ULTRAPLAN__', (args) => handleUltraplan(args)],
    ['__LIST_CHECKPOINTS__', (args) => handleListCheckpoints(args)],
    ['__RESTORE_CHECKPOINT__', (args) => handleRestoreCheckpoint(args)],
    ['__INIT_GROK__', (args) => handleInitGrok(args)],
    ['__REINIT_GROK__', () => handleReinitGrok()],
    ['__FEATURES__', () => handleFeatures()],
    ['__LESSONS__', (args) => handleLessonsCommand(args.join(' '))],
    ['__CONTEXT_STATS__', (args) => handleContextStats(args, this.agentProxy ?? undefined)],
    ['__SHORTCUTS__', () => handleShortcuts()],
    ['__DEBUG__', (args) => handleDebugMode(args)],
    ['__TOOL_ANALYTICS__', (args) => handleToolAnalytics(args)],
    ['__SECURITY_REVIEW__', (args) => handleSecurityReview(args)],
    ['__IDENTITY__', (args) => handleIdentity(args)],
    ['__PAIRING__', (args) => handlePairing(args)],
    ['__ELEVATED__', (args) => handleElevated(args)],
    ['__POLICY__', (args) => handlePolicy(args)],
    ['__DOCS_GENERATE__', () => handleDocsGenerate()],
    ['__STARTER__', (args) => handleStarter(args)],
    ['__FAST_MODE__', (args) => handleFastMode(args)],
    ['__BTW__', (args) => handleBtw(args)],
    ['__GRILL_ME__', (args) => handleGrillMe(args)],
    ['__DEEPTHINK__', (args) => handleDeepthink(args)],
    ['__HEARTBEAT__', (args) => handleHeartbeat(args)],
    ['__COMPANION_LOOPS__', (args) => handleCompanionLoops(args)],
    ['__GOAL__', (args) => handleGoal(args, { client: this.codebuddyClient })],
    ['__LOOP__', (args) => handleLoop(args, { client: this.codebuddyClient })],
    ['__SUBGOAL__', (args) => handleSubgoal(args)],
    ['__DAILY_RESET__', (args) => handleDailyReset(args)],
    ['__SHARE__', (args) => handleShare(args)],
    ['__AGENTS__', (args) => handleAgents(args)],
    ['__SUBAGENT__', (args) => handleSubagent(args)],
    ['__SWARM__', (args) => handleSwarm(args)],
    ['__FLEET__', (args) => handleFleet(args)],
    ['__COPY__', (args) => handleCopy(args, this.conversationHistory)],
    ['__PR__', (args) => handlePR(args)],
    ['__SWITCH__', (args) => handleSwitch(args)],
    ['__LINT__', (args) => this.handleLint(args)],
    ['__WATCH__', (args) => handleWatch(args)],
    ['__CONFLICTS__', (args) => handleConflicts(args)],
    ['__VULNS__', (args) => handleVulns(args)],
    ['__SECRETS_SCAN__', (args) => this.handleSecretsScan(args)],
    ['__BUG__', (args) => handleBug(args)],
    ['__SUGGEST__', (args) => handleSuggest(args)],
    ['__TELEMETRY__', (args) => handleTelemetry(args)],
    ['__QUOTA__', () => handleQuota()],
    ['__VOICE_CODE__', (args) => handleVoiceCode(args)],
    ['__COVERAGE__', (args) => handleCoverage(args)],
    ['__TRANSFORM__', (args) => handleTransform(args)],
    ['__DEV__', (args) => handleDev(args)],
    ['__REPLACE__', (args) => handleReplace(args)],
    ['__CLOUD__', (args) => handleCloud(args)],
    ['__TRIGGER__', (args) => handleTrigger(args)],
    ['__INFRA__', (args) => handleInfra(args)],
  ]);

  setConversationHistory(history: ChatEntry[]): void {
    this.conversationHistory = history;
  }

  setAgentProxy(proxy: AgentContextProxy): void {
    this.agentProxy = proxy;
  }

  setCodeBuddyClient(client: CodeBuddyClient): void {
    this.codebuddyClient = client;
    setBtwClient(client);
  }

  private createBatchChatFn() {
    return createBatchChatFn(this.codebuddyClient);
  }

  private createBatchSpawnFn() {
    const client = this.codebuddyClient;
    if (!client) return undefined;
    return createDefaultBatchSpawnFn({
      cwd: process.cwd(),
      apiKey: client.getApiKey(),
      baseURL: client.getBaseURL(),
      model: client.getCurrentModel(),
    });
  }

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
...failureFlag(formatDetectedLinters(configs)),
          entry: { type: 'assistant', content: formatDetectedLinters(configs), timestamp: new Date() },
        };
      }
      if (configs.length === 0) {
        return {
          handled: true,
...failureFlag('No linters detected for this project.\n\nSupported: eslint, ruff, clippy, golangci-lint, rubocop, phpstan.'),
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
...failureFlag(formatDetectedLinters(configs) + '\n\nNo linter CLIs are installed. Install one to use /lint.'),
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
      const failedLint = results.some((item: { success?: boolean }) => item.success === false);
      return {
        handled: true,
        ...(failedLint ? { failed: true } : {}),
        entry: { type: 'assistant', content: formatLintResults(results), timestamp: new Date() },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        handled: true,
        failed: true,
        entry: { type: 'assistant', content: `Lint error: ${msg}`, timestamp: new Date() },
      };
    }
  }

  private async handleSecretsScan(args: string[]): Promise<CommandHandlerResult> {
    try {
      const { scanForSecrets, formatFindings } = await import('../security/secrets-detector.js');
      const targetPath = args[0] || process.cwd();
      const findings = await scanForSecrets(targetPath);
      return {
        handled: true,
...failureFlag(formatFindings(findings)),
        entry: { type: 'assistant', content: formatFindings(findings), timestamp: new Date() },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        handled: true,
        failed: true,
        entry: { type: 'assistant', content: `Secrets scan error: ${msg}`, timestamp: new Date() },
      };
    }
  }

  async handleCommand(
    token: string,
    args: string[],
    _fullInput: string
  ): Promise<CommandHandlerResult> {
    const handler = this.handlerMap.get(token);
    if (handler) {
      return withFactsMemorySessionClient(this.codebuddyClient ?? null, async () =>
        normalizeHandlerResult(await handler(args)));
    }
    return { handled: false };
  }

  getRegisteredTokens(): string[] {
    return Array.from(this.handlerMap.keys());
  }
}

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
