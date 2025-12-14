// Branch handlers
export {
  handleFork,
  handleBranches,
  handleCheckout,
  handleMerge,
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
} from './core-handlers.js';

// Export handlers
export {
  handleExport,
  handleExportList,
  handleExportFormats,
} from './export-handlers.js';

// Session handlers
export {
  handleSessions,
} from './session-handlers.js';

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
} from './vibe-handlers.js';

// Permissions handlers (Claude Code-inspired)
export {
  handlePermissions,
} from './permissions-handlers.js';

// Worktree handlers (Claude Code-inspired)
export {
  handleWorktree,
} from './worktree-handlers.js';

// Script handlers (FileCommander Enhanced-inspired)
export {
  handleScript,
} from './script-handlers.js';

// Re-export CommandHandlerResult type
export type { CommandHandlerResult } from './branch-handlers.js';
