/**
 * Session Pruning Types
 *
 * Type definitions for session and memory pruning strategies.
 */

// ============================================================================
// Pruning Rules
// ============================================================================

export interface PruningRule {
  /** Rule identifier */
  id: string;
  /** Rule name */
  name: string;
  /** Rule priority (higher = executed first) */
  priority: number;
  /** Whether the rule is enabled */
  enabled: boolean;
  /** Rule conditions */
  conditions: PruningCondition[];
  /** Pruning action */
  action: PruningAction;
}

export type PruningCondition =
  | AgePruningCondition
  | CountPruningCondition
  | SizePruningCondition
  | TokenPruningCondition
  | TypePruningCondition
  | CustomPruningCondition;

export interface AgePruningCondition {
  type: 'age';
  /** Maximum age in milliseconds */
  maxAgeMs: number;
}

export interface CountPruningCondition {
  type: 'count';
  /** Maximum number of items */
  maxCount: number;
  /** Count from start or end */
  countFrom?: 'start' | 'end';
}

export interface SizePruningCondition {
  type: 'size';
  /** Maximum size in bytes */
  maxBytes: number;
}

export interface TokenPruningCondition {
  type: 'tokens';
  /** Maximum number of tokens */
  maxTokens: number;
}

export interface TypePruningCondition {
  type: 'type';
  /** Message/memory types to match */
  messageTypes: string[];
  /** Whether to include or exclude matching types */
  include: boolean;
}

export interface CustomPruningCondition {
  type: 'custom';
  /** Custom condition function name */
  fn: string;
  /** Custom parameters */
  params?: Record<string, unknown>;
}

export type PruningAction =
  | DeletePruningAction
  | ArchivePruningAction
  | SummarizePruningAction
  | CompactPruningAction;

export interface DeletePruningAction {
  type: 'delete';
}

export interface ArchivePruningAction {
  type: 'archive';
  /** Archive destination */
  destination?: string;
}

export interface SummarizePruningAction {
  type: 'summarize';
  /** Target size after summarization */
  targetTokens?: number;
}

export interface CompactPruningAction {
  type: 'compact';
  /** Compaction ratio (0-1) */
  ratio: number;
}

// ============================================================================
// Pruning Configuration
// ============================================================================

export interface PruningConfig {
  /** Enable automatic pruning */
  enabled: boolean;
  /** Pruning rules */
  rules: PruningRule[];
  /** Check interval in milliseconds */
  checkIntervalMs: number;
  /** Minimum time between pruning operations */
  minPruneIntervalMs: number;
  /** Dry run mode (log but don't prune) */
  dryRun: boolean;
  /** Session-specific configurations */
  sessionConfigs?: Record<string, SessionPruningConfig>;
}

export interface SessionPruningConfig {
  /** Session ID */
  sessionId: string;
  /** Override rules for this session */
  rules?: Partial<PruningRule>[];
  /** Session-specific thresholds */
  thresholds?: PruningThresholds;
  /** Exempt from automatic pruning */
  exempt: boolean;
}

export interface PruningThresholds {
  /** Maximum messages */
  maxMessages?: number;
  /** Maximum tokens */
  maxTokens?: number;
  /** Maximum age in milliseconds */
  maxAgeMs?: number;
  /** Maximum memory size in bytes */
  maxSizeBytes?: number;
}

export const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  enabled: true,
  rules: [
    {
      id: 'default-age',
      name: 'Prune old messages',
      priority: 10,
      enabled: true,
      conditions: [{ type: 'age', maxAgeMs: 24 * 60 * 60 * 1000 }], // 24 hours
      action: { type: 'archive' },
    },
    {
      id: 'default-count',
      name: 'Limit message count',
      priority: 20,
      enabled: true,
      conditions: [{ type: 'count', maxCount: 1000, countFrom: 'end' }],
      action: { type: 'delete' },
    },
    {
      id: 'default-tokens',
      name: 'Limit token count',
      priority: 30,
      enabled: true,
      conditions: [{ type: 'tokens', maxTokens: 100000 }],
      action: { type: 'summarize', targetTokens: 50000 },
    },
  ],
  checkIntervalMs: 5 * 60 * 1000, // 5 minutes
  minPruneIntervalMs: 60 * 1000, // 1 minute
  dryRun: false,
};

// ============================================================================
// Pruning Targets
// ============================================================================

export interface PrunableItem {
  /** Unique identifier */
  id: string;
  /** Session this item belongs to */
  sessionId: string;
  /** Item type */
  type: 'message' | 'memory' | 'checkpoint' | 'file';
  /** Creation timestamp */
  createdAt: Date;
  /** Last accessed timestamp */
  accessedAt?: Date;
  /** Size in bytes */
  sizeBytes: number;
  /** Token count */
  tokens?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Content (for summarization) */
  content?: string;
}

export interface PruningCandidate {
  item: PrunableItem;
  rule: PruningRule;
  reason: string;
}

// ============================================================================
// Pruning Results
// ============================================================================

export interface PruningResult {
  /** Pruning operation ID */
  id: string;
  /** Start timestamp */
  startedAt: Date;
  /** End timestamp */
  completedAt: Date;
  /** Whether the operation succeeded */
  success: boolean;
  /** Items that were pruned */
  prunedItems: PrunedItem[];
  /** Items that were skipped */
  skippedItems: SkippedItem[];
  /** Errors encountered */
  errors: PruningError[];
  /** Summary statistics */
  stats: PruningStats;
}

export interface PrunedItem {
  item: PrunableItem;
  action: PruningAction['type'];
  reason: string;
  savedBytes: number;
  savedTokens?: number;
}

export interface SkippedItem {
  item: PrunableItem;
  reason: string;
}

export interface PruningError {
  item?: PrunableItem;
  rule?: PruningRule;
  error: string;
  recoverable: boolean;
}

export interface PruningStats {
  /** Total items scanned */
  scannedCount: number;
  /** Total items pruned */
  prunedCount: number;
  /** Total items skipped */
  skippedCount: number;
  /** Total items with errors */
  errorCount: number;
  /** Total bytes freed */
  freedBytes: number;
  /** Total tokens freed */
  freedTokens: number;
  /** Duration in milliseconds */
  durationMs: number;
}

// ============================================================================
// Events
// ============================================================================

export interface PruningEvents {
  'start': (config: PruningConfig) => void;
  'progress': (progress: PruningProgress) => void;
  'item-pruned': (item: PrunedItem) => void;
  'item-skipped': (item: SkippedItem) => void;
  'error': (error: PruningError) => void;
  'complete': (result: PruningResult) => void;
}

export interface PruningProgress {
  /** Current item index */
  current: number;
  /** Total items to process */
  total: number;
  /** Percentage complete */
  percent: number;
  /** Current item being processed */
  currentItem?: PrunableItem;
}
