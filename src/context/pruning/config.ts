/**
 * Context Pruning Configuration
 *
 * Configuration for TTL-based context pruning to manage
 * context window size efficiently.
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * Pruning configuration
 */
export interface PruningConfig {
  /** TTL for tool call results in milliseconds (default: 5 minutes) */
  ttlMs: number;
  /** Characters to keep from head when soft trimming */
  softTrimHeadChars: number;
  /** Characters to keep from tail when soft trimming */
  softTrimTailChars: number;
  /** Keep last N assistant messages regardless of TTL */
  keepLastNAssistant: number;
  /** Minimum characters in a message before it can be pruned */
  minPrunableChars: number;
  /** Whether to keep system messages */
  keepSystemMessages: boolean;
  /** Whether to keep user messages */
  keepUserMessages: boolean;
  /** Maximum age for any message in milliseconds (0 = no limit) */
  maxMessageAge: number;
}

/**
 * Default pruning configuration
 */
export const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  ttlMs: 5 * 60 * 1000,           // 5 minutes
  softTrimHeadChars: 1500,
  softTrimTailChars: 1500,
  keepLastNAssistant: 3,
  minPrunableChars: 4000,
  keepSystemMessages: true,
  keepUserMessages: true,
  maxMessageAge: 0,               // No limit by default
};

// ============================================================================
// Types
// ============================================================================

/**
 * Timestamp tracking for a tool call
 */
export interface ToolCallTimestamp {
  /** Tool call ID */
  toolCallId: string;
  /** Tool name */
  toolName: string;
  /** Timestamp when tool was called */
  calledAt: number;
  /** Message index containing this tool call */
  messageIndex: number;
  /** Whether this tool call has been pruned */
  pruned: boolean;
}

/**
 * Message with pruning metadata
 */
export interface PrunableMessage {
  /** Original message index */
  index: number;
  /** Message role */
  role: string;
  /** Message content (may be pruned) */
  content: string | null | unknown;
  /** Original content length */
  originalLength: number;
  /** Timestamp when message was added */
  timestamp: number;
  /** Tool call IDs in this message */
  toolCallIds: string[];
  /** Whether this message has been soft-trimmed */
  softTrimmed: boolean;
  /** Whether this message has been hard-cleared */
  hardCleared: boolean;
}

/**
 * Pruning result
 */
export interface PruningResult {
  /** Messages after pruning */
  messages: PrunableMessage[];
  /** Number of messages soft-trimmed */
  softTrimmedCount: number;
  /** Number of messages hard-cleared */
  hardClearedCount: number;
  /** Total characters removed */
  charactersRemoved: number;
  /** Tool calls pruned */
  toolCallsPruned: string[];
}

/**
 * Pruning events
 */
export interface PruningEvents {
  'pruning:soft-trim': { messageIndex: number; charsRemoved: number };
  'pruning:hard-clear': { messageIndex: number; toolCallId: string };
  'pruning:complete': PruningResult;
}
