/**
 * Bash Allowlist Types
 *
 * Pattern-based command approval system for persistent allowlisting
 * of bash commands. Supports glob patterns, exact matches, and
 * command prefix matching.
 */

// ============================================================================
// Approval Pattern Types
// ============================================================================

/**
 * Type of pattern matching to use
 */
export type PatternType =
  | 'exact'     // Exact string match
  | 'prefix'    // Command starts with pattern
  | 'glob'      // Glob pattern (*, ?, etc.)
  | 'regex';    // Regular expression

/**
 * Decision for a pattern
 */
export type ApprovalDecision = 'allow' | 'deny';

/**
 * An approval pattern entry
 */
export interface ApprovalPattern {
  /** Unique identifier */
  id: string;
  /** The pattern to match */
  pattern: string;
  /** Type of pattern matching */
  type: PatternType;
  /** Decision for matching commands */
  decision: ApprovalDecision;
  /** Human-readable description/reason */
  description?: string;
  /** Number of times this pattern has been used */
  useCount: number;
  /** When the pattern was created */
  createdAt: Date;
  /** When the pattern was last matched */
  lastUsedAt?: Date;
  /** Optional expiration time (null = never expires) */
  expiresAt?: Date | null;
  /** Whether this pattern is enabled */
  enabled: boolean;
  /** Tags for organization */
  tags?: string[];
  /** Source of this pattern (user, system, plugin) */
  source: PatternSource;
}

/**
 * Where the pattern came from
 */
export type PatternSource =
  | 'user'       // User-created via prompt
  | 'system'     // System default
  | 'plugin'     // From a plugin
  | 'import';    // Imported from file

// ============================================================================
// Approval Flow Types
// ============================================================================

/**
 * Result of checking a command against the allowlist
 */
export interface AllowlistCheckResult {
  /** Whether a pattern matched */
  matched: boolean;
  /** The matching pattern (if any) */
  pattern?: ApprovalPattern;
  /** Decision (if matched) or fallback */
  decision: ApprovalDecision | 'prompt';
  /** Reason for this result */
  reason: string;
}

/**
 * Options for approval prompts
 */
export interface ApprovalPromptOptions {
  /** Command being executed */
  command: string;
  /** Working directory */
  cwd: string;
  /** Timeout for user response (ms) */
  timeout?: number;
  /** Whether to show "always allow" option */
  showAlwaysAllow?: boolean;
  /** Whether to show "always deny" option */
  showAlwaysDeny?: boolean;
}

/**
 * Result from user approval prompt
 */
export interface ApprovalPromptResult {
  /** User's decision */
  decision: 'allow-once' | 'allow-always' | 'deny-once' | 'deny-always';
  /** Pattern to save (for always options) */
  pattern?: string;
  /** Type of pattern (for always options) */
  patternType?: PatternType;
  /** User-provided description */
  description?: string;
  /** Whether the prompt timed out */
  timedOut?: boolean;
}

// ============================================================================
// Store Types
// ============================================================================

/**
 * Persisted allowlist configuration
 */
export interface AllowlistConfig {
  /** Schema version for migrations */
  version: number;
  /** All stored patterns */
  patterns: ApprovalPattern[];
  /** Default settings */
  defaults: {
    /** Default timeout for prompts (ms) */
    timeout: number;
    /** Default decision when no pattern matches and no prompt */
    fallback: ApprovalDecision | 'prompt';
    /** Whether to show "always allow" option in prompts */
    showAlwaysAllow: boolean;
    /** Whether to show "always deny" option in prompts */
    showAlwaysDeny: boolean;
  };
  /** Statistics */
  stats: {
    /** Total commands checked */
    totalChecks: number;
    /** Commands allowed */
    allowed: number;
    /** Commands denied */
    denied: number;
    /** Commands prompted */
    prompted: number;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_ALLOWLIST_CONFIG: AllowlistConfig = {
  version: 1,
  patterns: [],
  defaults: {
    timeout: 30000,
    fallback: 'prompt',
    showAlwaysAllow: true,
    showAlwaysDeny: true,
  },
  stats: {
    totalChecks: 0,
    allowed: 0,
    denied: 0,
    prompted: 0,
  },
};

// ============================================================================
// Events
// ============================================================================

/**
 * Allowlist events
 */
export interface AllowlistEvents {
  'pattern:added': ApprovalPattern;
  'pattern:removed': { id: string };
  'pattern:matched': { command: string; pattern: ApprovalPattern };
  'pattern:expired': { id: string };
  'check:allowed': { command: string; pattern?: ApprovalPattern };
  'check:denied': { command: string; pattern?: ApprovalPattern };
  'check:prompted': { command: string };
  'config:saved': AllowlistConfig;
  'config:loaded': AllowlistConfig;
}

// ============================================================================
// Predefined Patterns
// ============================================================================

/**
 * Default safe patterns (system-provided)
 */
export const DEFAULT_SAFE_PATTERNS: Partial<ApprovalPattern>[] = [
  // Package managers - read operations
  {
    pattern: 'npm list*',
    type: 'glob',
    decision: 'allow',
    description: 'npm list commands are safe read operations',
    tags: ['npm', 'package-manager', 'safe'],
  },
  {
    pattern: 'npm outdated*',
    type: 'glob',
    decision: 'allow',
    description: 'npm outdated is a safe read operation',
    tags: ['npm', 'package-manager', 'safe'],
  },
  {
    pattern: 'npm view*',
    type: 'glob',
    decision: 'allow',
    description: 'npm view is a safe read operation',
    tags: ['npm', 'package-manager', 'safe'],
  },
  // Git - read operations
  {
    pattern: 'git status*',
    type: 'glob',
    decision: 'allow',
    description: 'git status is a safe read operation',
    tags: ['git', 'vcs', 'safe'],
  },
  {
    pattern: 'git log*',
    type: 'glob',
    decision: 'allow',
    description: 'git log is a safe read operation',
    tags: ['git', 'vcs', 'safe'],
  },
  {
    pattern: 'git diff*',
    type: 'glob',
    decision: 'allow',
    description: 'git diff is a safe read operation',
    tags: ['git', 'vcs', 'safe'],
  },
  {
    pattern: 'git branch*',
    type: 'glob',
    decision: 'allow',
    description: 'git branch (without -d/-D) is safe',
    tags: ['git', 'vcs', 'safe'],
  },
  {
    pattern: 'git show*',
    type: 'glob',
    decision: 'allow',
    description: 'git show is a safe read operation',
    tags: ['git', 'vcs', 'safe'],
  },
  // Testing
  {
    pattern: 'npm test*',
    type: 'glob',
    decision: 'allow',
    description: 'npm test commands run project tests',
    tags: ['npm', 'testing', 'safe'],
  },
  {
    pattern: 'npm run test*',
    type: 'glob',
    decision: 'allow',
    description: 'npm run test commands',
    tags: ['npm', 'testing', 'safe'],
  },
  {
    pattern: 'jest*',
    type: 'glob',
    decision: 'allow',
    description: 'Jest test runner',
    tags: ['testing', 'jest', 'safe'],
  },
  // Linting/formatting
  {
    pattern: 'npm run lint*',
    type: 'glob',
    decision: 'allow',
    description: 'Linting commands',
    tags: ['npm', 'lint', 'safe'],
  },
  {
    pattern: 'eslint*',
    type: 'glob',
    decision: 'allow',
    description: 'ESLint commands',
    tags: ['lint', 'eslint', 'safe'],
  },
  {
    pattern: 'prettier*',
    type: 'glob',
    decision: 'allow',
    description: 'Prettier commands',
    tags: ['format', 'prettier', 'safe'],
  },
  // Build
  {
    pattern: 'npm run build*',
    type: 'glob',
    decision: 'allow',
    description: 'Build commands',
    tags: ['npm', 'build', 'safe'],
  },
  {
    pattern: 'tsc*',
    type: 'glob',
    decision: 'allow',
    description: 'TypeScript compiler',
    tags: ['typescript', 'build', 'safe'],
  },
];

/**
 * Patterns that should always be denied
 */
export const DEFAULT_DENY_PATTERNS: Partial<ApprovalPattern>[] = [
  {
    pattern: 'rm -rf /*',
    type: 'glob',
    decision: 'deny',
    description: 'Prevents recursive deletion of root',
    tags: ['dangerous', 'destructive'],
  },
  {
    pattern: 'rm -rf ~/*',
    type: 'glob',
    decision: 'deny',
    description: 'Prevents recursive deletion of home directory',
    tags: ['dangerous', 'destructive'],
  },
  {
    pattern: 'sudo rm*',
    type: 'glob',
    decision: 'deny',
    description: 'Blocks privileged deletion',
    tags: ['dangerous', 'sudo'],
  },
  {
    pattern: ':(){ :|:& };:',
    type: 'exact',
    decision: 'deny',
    description: 'Fork bomb',
    tags: ['dangerous', 'fork-bomb'],
  },
];
