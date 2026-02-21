/**
 * Pro Features - Shared Types
 *
 * Channel-agnostic type definitions for all pro features:
 * scoped auth, diff-first, run tracker, run commands, enhanced commands, CI watcher.
 */

// ============================================================================
// Scoped Auth Types
// ============================================================================

/** Permission scope tiers (ordered by privilege) */
export type AuthScope = 'read-only' | 'write-patch' | 'run-tests' | 'deploy';

/** Scope privilege order for comparison */
export const SCOPE_LEVEL: Record<AuthScope, number> = {
  'read-only': 0,
  'write-patch': 1,
  'run-tests': 2,
  'deploy': 3,
};

/** Authorization decision returned by scope checks */
export interface AuthDecision {
  allowed: boolean;
  reason?: string;
  requiredScope?: AuthScope;
  userScopes?: AuthScope[];
}

/** Scoped permission entry for a user */
export interface ScopedPermission {
  userId: string;
  scopes: AuthScope[];
  repos: string[];
  folders: string[];
  denyCommands: string[];
  expiresAt?: string;
  grantedAt: string;
  grantedBy?: string;
}

/** Secret handle - maps a friendly name to an env var, never exposed to LLM */
export interface SecretHandle {
  handle: string;
  envVar: string;
  description?: string;
  addedAt: string;
}

/** Pending double-confirmation entry */
export interface PendingConfirm {
  id: string;
  userId: string;
  operation: string;
  details?: string;
  createdAt: number;
  expiresAt: number;
}

/** Temporary full access grant */
export interface TemporaryAccess {
  userId: string;
  grantedAt: number;
  expiresAt: number;
  grantedBy?: string;
}

/** Context for scope checks */
export interface ScopeCheckContext {
  repo?: string;
  folder?: string;
  command?: string;
}

// ============================================================================
// Diff-First Types
// ============================================================================

/** Configuration for diff-first mode */
export interface DiffFirstConfig {
  enabled: boolean;
  planFirst: boolean;
  maxDiffLines: number;
  autoApplyThreshold: number;
}

/** Summary of changes to a single file */
export interface FileDiffSummary {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  linesAdded: number;
  linesRemoved: number;
  excerpt: string;
}

/** A pending diff awaiting user approval */
export interface PendingDiff {
  id: string;
  chatId: string;
  userId: string;
  messageId?: string;
  turnId: number;
  diffs: FileDiffSummary[];
  plan?: string;
  status: 'pending' | 'applied' | 'cancelled' | 'expired';
  createdAt: number;
  expiresAt: number;
  fullDiff?: string;
}

/** Result of applying a diff */
export interface ApplyResult {
  success: boolean;
  filesApplied: number;
  error?: string;
}

// ============================================================================
// Run Tracker Types
// ============================================================================

/** Status of a run */
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';

/** A single step in a run */
export interface RunStep {
  stepId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  success?: boolean;
  startedAt: number;
  endedAt?: number;
  turnId?: number;
  filesChanged?: string[];
}

/** An artifact produced by a run */
export interface RunArtifact {
  type: 'file' | 'diff' | 'test-result' | 'pr' | 'commit';
  path?: string;
  ref?: string;
  description: string;
}

/** A complete run record */
export interface RunRecord {
  id: string;
  sessionId: string;
  objective: string;
  status: RunStatus;
  steps: RunStep[];
  artifacts: RunArtifact[];
  tokenCount: number;
  totalCost: number;
  startedAt: number;
  endedAt?: number;
  chatId?: string;
  userId?: string;
}

// ============================================================================
// CI Watcher Types
// ============================================================================

/** CI alert types */
export type CIAlertType =
  | 'build-failure'
  | 'flaky-test'
  | 'pr-review'
  | 'vulnerable-deps'
  | 'deploy-failure';

/** CI provider types */
export type CIProviderType = 'github-actions' | 'gitlab-ci' | 'jenkins' | 'custom-webhook';

/** CI provider configuration */
export interface CIProvider {
  type: CIProviderType;
  repoUrl: string;
  apiTokenHandle?: string;
  label?: string;
}

/** CI watcher configuration */
export interface CIWatchConfig {
  enabled: boolean;
  chatId: string;
  providers: CIProvider[];
  alertOn: CIAlertType[];
  mutedPatterns: string[];
}

/** A CI event parsed from a webhook payload */
export interface CIEvent {
  id: string;
  type: CIAlertType;
  provider: CIProviderType;
  repo: string;
  branch: string;
  title: string;
  details: string;
  logUrl?: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  commit?: string;
  workflow?: string;
  timestamp: number;
}

// ============================================================================
// Enhanced Commands Types
// ============================================================================

/** A pinned context item */
export interface ContextPin {
  id: string;
  content: string;
  pinnedBy: string;
  chatId: string;
  timestamp: number;
  tags: string[];
}

/** Structured repo info returned by handleRepo */
export interface RepoInfo {
  remote: string;
  branch: string;
  commitCount: string;
  lastCommit: string;
  recentCommits: string;
  openPRs?: string;
}

/** Structured branch info returned by handleBranch */
export interface BranchInfo {
  branch: string;
  mainBranch: string;
  diffStat?: string;
  commitsAhead: string;
  commitsBehind: string;
}

/** Structured PR info for a single PR */
export interface PRInfo {
  number: string;
  title: string;
  state: string;
  author: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body: string;
  url?: string;
}

/** Summary for PR list */
export interface PRSummary {
  number: number;
  title: string;
  author: string;
}

// ============================================================================
// Formatter Types
// ============================================================================

/** Generic message button */
export interface MessageButton {
  text: string;
  type: 'url' | 'callback';
  url?: string;
  data?: string;
}

/** Formatted message ready for channel delivery */
export interface ProFormattedMessage {
  text: string;
  buttons?: MessageButton[];
  parseMode?: string;
}

/** Command list entry */
export interface CommandEntry {
  command: string;
  description: string;
}

/**
 * Channel-specific formatter interface.
 * Each channel provides its own implementation (or uses the default TextProFormatter).
 */
export interface ChannelProFormatter {
  formatDiffMessage(pending: PendingDiff): ProFormattedMessage;
  formatFullDiff(pending: PendingDiff): string;
  formatPlanMessage(plan: string, filesTouched: string[], commands: string[]): ProFormattedMessage;
  formatRunsList(runs: RunRecord[]): ProFormattedMessage;
  formatRunTimeline(run: RunRecord): ProFormattedMessage;
  formatRunDetail(run: RunRecord, testSteps: RunStep[], commitRefs: string[]): ProFormattedMessage;
  formatCIAlert(event: CIEvent, analysis?: string): ProFormattedMessage;
  formatRepoInfo(info: RepoInfo): ProFormattedMessage;
  formatBranchInfo(info: BranchInfo): ProFormattedMessage;
  formatPRInfo(pr: PRInfo): ProFormattedMessage;
  formatPRList(prs: PRSummary[]): ProFormattedMessage;
  getCommandList(): CommandEntry[];
}
