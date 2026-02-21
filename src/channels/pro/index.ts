/**
 * Pro Features Module
 *
 * Channel-agnostic pro features that any channel adapter can use.
 * Barrel re-exports for all pro modules.
 */

// Types
export type {
  AuthScope,
  AuthDecision,
  ScopedPermission,
  SecretHandle,
  PendingConfirm,
  TemporaryAccess,
  ScopeCheckContext,
  DiffFirstConfig,
  FileDiffSummary,
  PendingDiff,
  ApplyResult,
  RunStatus,
  RunStep,
  RunArtifact,
  RunRecord,
  CIAlertType,
  CIProviderType,
  CIProvider,
  CIWatchConfig,
  CIEvent,
  ContextPin,
  RepoInfo,
  BranchInfo,
  PRInfo,
  PRSummary,
  MessageButton,
  ProFormattedMessage,
  CommandEntry,
  ChannelProFormatter,
} from './types.js';
export { SCOPE_LEVEL } from './types.js';

// Core managers
export { ScopedAuthManager } from './scoped-auth.js';
export { DiffFirstManager } from './diff-first.js';
export { RunTracker } from './run-tracker.js';
export { RunCommands } from './run-commands.js';
export { EnhancedCommands } from './enhanced-commands.js';
export { CIWatcher } from './ci-watcher.js';

// Formatter
export { TextProFormatter } from './text-formatter.js';

// Router
export { ProCallbackRouter, parseCallbackData } from './callback-router.js';
export type { ParsedCallback, SendFn, EmitTaskFn } from './callback-router.js';

// Bundle
export { ProFeatures } from './pro-features.js';
export type { ProFeaturesConfig } from './pro-features.js';
