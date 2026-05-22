// Branch handlers
export {
  handleFork,
  handleBranches,
  handleCheckout,
  handleMerge,
  handleBranch,
} from './branch-handlers.js';

// Memory handlers
export {
  handleMemory,
  handleRemember,
  handleScanTodos,
  handleAddressTodo,
} from './memory-handlers.js';

// Stats handlers
export {
  handleCost,
  handleStats,
  handleCache,
  handleSelfHealing,
} from './stats-handlers.js';

// Security handlers
export {
  handleSecurity,
  handleDryRun,
  handleGuardian,
  handlePairing,
  handleSecurityReview,
  handleIdentity,
  handleElevated,
  handlePolicy,
} from './security-handlers.js';

// Voice handlers
export {
  handleVoice,
  handleSpeak,
  handleTTS,
} from './voice-handlers.js';

// UI handlers
export {
  handleTheme,
  handleAvatar,
} from './ui-handlers.js';

// Context handlers
export {
  handleAddContext,
  handleContext,
  handleWorkspace,
} from './context-handlers.js';

// Test handlers
export {
  handleGenerateTests,
  handleAITest,
} from './test-handlers.js';

// Core handlers
export {
  handleHelp,
  handleYoloMode,
  handleAutonomy,
  handlePipeline,
  handleParallel,
  handleModelRouter,
  handleSkill,
  handleSaveConversation,
  handleShortcuts,
  handleToolAnalytics,
} from './core-handlers.js';

// Ultraplan handler
export { handleUltraplan } from './ultraplan-handler.js';

// Export handlers
export {
  handleExport,
  handleExportList,
  handleExportFormats,
} from './export-handlers.js';

// Session handlers
export {
  handleSessions,
  cleanupSessions,
} from './session-handlers.js';

// Clipboard handlers
export {
  handleCopy,
} from './clipboard-handler.js';

// History handlers
export {
  handleHistory,
} from './history-handlers.js';

// Agent handlers
export {
  handleAgent,
  checkAgentTriggers,
} from './agent-handlers.js';

// Vibe handlers (Mistral Vibe-inspired)
export {
  handleReload,
  handleLog,
  handleCompact,
  handleTools,
  handleVimMode,
  handleConfig,
} from './vibe-handlers.js';

// Authentication handlers (ChatGPT OAuth — Phase d.23)
export {
  handleLogin,
  handleLogout,
  handleWhoami,
} from './auth-handlers.js';

// Permissions handlers (Enterprise-grade)
export {
  handlePermissions,
} from './permissions-handlers.js';

// Worktree handlers (Enterprise-grade)
export {
  handleWorktree,
} from './worktree-handlers.js';

// Script handlers (FileCommander Enhanced-inspired)
export {
  handleScript,
} from './script-handlers.js';

// FCS handlers (100% FileCommander Compatible)
export {
  handleFCS,
  isFCSScript,
  executeInlineFCS,
} from './fcs-handlers.js';

// Research-based feature handlers (TDD, CI/CD, Hooks, Caching, Model Routing)
export {
  handleTDD,
  handleWorkflow,
  handleHooks,
  handlePromptCache,
  handleModelRouter as handleModelRouterCommand,
} from './research-handlers.js';

// Track handlers (Conductor-inspired) — consolidated into lightweight.ts (V3.C)
export {
  handleTrack,
} from './lightweight.js';

// Plugin handlers
export {
  handlePlugins,
  handlePlugin,
} from './plugin-handlers.js';

// Colab handlers (AI Collaboration)
export {
  handleColabCommand,
} from './colab-handler.js';

// Missing handlers (model, mode, clear, status, new, colab, diff, features, checkpoints, restore)
export {
  handleChangeModel,
  handleChangeMode,
  handleClearChat,
  handleStatus,
  handleNew,
  handleColab,
  handleDiffCheckpoints,
  handleFeatures,
  handleListCheckpoints,
  handleRestoreCheckpoint,
  handleInitGrok,
  handleReinitGrok,
} from './missing-handlers.js';

// Debug handlers (enhanced debug mode)
export {
  handleDebugMode,
} from './debug-handlers.js';

// Extra handlers (UX slash commands)
export {
  handleUndo,
  handleDiff,
  handleContextStats,
  handleSearch,
  handleTest,
  handleFix,
  handleReview,
} from './extra-handlers.js';

// Persona handler
export {
  handlePersonaCommand,
} from './persona-handler.js';

// Think handlers (Tree-of-Thought reasoning)
export {
  handleThink,
  getActiveThinkingMode,
  setActiveThinkingMode,
} from './think-handlers.js';

// Team handlers (Agent Teams multi-agent coordination)
export {
  handleTeam,
} from './team-handlers.js';

// Batch handlers (CC13 — parallel task decomposition)
export {
  handleBatchCommand,
  decomposeBatchGoal,
  executeBatchPlan,
  formatBatchPlan,
  formatBatchResults,
} from './batch-handlers.js';

// Starter pack handlers
export {
  handleStarter,
} from './starter-handlers.js';

// Fast mode handler (Enterprise-aligned)
export {
  handleFastMode,
  isFastModeEnabled,
  getFastModeModel,
  getFastModeServiceTier,
  getFastModeState,
  enableFastMode,
  disableFastMode,
  setFastModel,
} from './fast-mode-handler.js';

// Backup handlers (Native Engine v2026.3.8 alignment)
export {
  handleBackup,
} from './backup-handlers.js';

// BTW handler (Native Engine v2026.3.14 alignment)
export {
  handleBtw,
  setBtwClient,
} from './btw-handler.js';

// Heartbeat handler (fleet AUTONOMOUS-FLEET-PROTOCOL v0.1)
export { handleHeartbeat } from './heartbeat-handler.js';

// Daily reset handler (audit OpenClaw heritage activation)
export { handleDailyReset } from './daily-reset-handler.js';

// Team session handler — slash /share (audit OpenClaw heritage activation, TeamSessionManager wake)
export { handleShare } from './team-session-handler.js';

// Agents handler — slash /agents (audit OpenClaw heritage activation, MultiAgentSystem wake)
export { handleAgents } from './agents-handler.js';

// Subagent handler — slash /subagent (rc.4: list/inspect PREDEFINED_SUBAGENTS, surfaces Explore + others)
export { handleSubagent } from './subagent-handler.js';

// Swarm handler — slash /swarm (rc.4: UX wrapper around /agents run with strategy=parallel,
// inspired by Korben's article on Claude Code's hidden Swarms mode)
export { handleSwarm } from './swarm-handler.js';

// Fleet handler — slash /fleet (Phase (d).5 V0.4.1 — inter-Claude WS streaming receiver)
export { handleFleet } from './fleet-handler.js';

// PR handlers (GitHub/GitLab PR creation)
export {
  handlePR,
} from './pr-handlers.js';

// Switch handler (mid-conversation model switching)
export {
  handleSwitch,
  setSwitchModelProvider,
} from './switch-handler.js';

// Watch handler (file watcher trigger)
export {
  handleWatch,
} from './watch-handler.js';

// Conflicts handler (merge conflict resolution)
export {
  handleConflicts,
} from './conflicts-handler.js';

// Vulns handler (dependency vulnerability scanner) — consolidated into lightweight.ts (V3.C)
export {
  handleVulns,
} from './lightweight.js';

// Bug handler (static analysis bug scanner)
export {
  handleBug,
} from './bug-handler.js';

// Suggest handler (proactive suggestions)
export {
  handleSuggest,
} from './suggest-handler.js';

// Telemetry handler (opt-in/opt-out toggle) — consolidated into lightweight.ts (V3.C)
export {
  handleTelemetry,
} from './lightweight.js';

// Quota handler (rate limit display) — consolidated into lightweight.ts (V3.C)
export {
  handleQuota,
} from './lightweight.js';

// Voice-code handler (voice-to-code pipeline)
export {
  handleVoiceCode,
} from './voice-code-handler.js';

// Coverage handler (coverage target checking) — consolidated into lightweight.ts (V3.C)
export {
  handleCoverage,
} from './lightweight.js';

// Lessons handler — consolidated into lightweight.ts (V3.C)
export {
  handleLessonsCommand,
} from './lightweight.js';

// Transform handler (code transformation)
export {
  handleTransform,
} from './transform-handler.js';

// Dev handlers (golden-path developer workflows)
export {
  handleDev,
} from './dev-handlers.js';

// Replace handler (codebase-wide find & replace)
export {
  handleReplace,
} from './replace-handler.js';

// Cloud handlers (background agent tasks)
export {
  handleCloud,
} from './cloud-handlers.js';

// Trigger handlers (event-driven webhook triggers)
export {
  handleTrigger,
} from './trigger-handlers.js';

// Infra handlers (TurboQuant health dashboard)
export {
  handleInfra,
} from './infra-handlers.js';

// Re-export CommandHandlerResult type
export type { CommandHandlerResult } from './branch-handlers.js';
