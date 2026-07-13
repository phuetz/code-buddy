/**
 * Shared Engine Types
 *
 * Type definitions shared between Code Buddy CLI and the desktop GUI.
 * These types form the contract between the EngineAdapter and the
 * Cowork EngineRunner, ensuring type safety across the bridge.
 *
 * @module shared/engine-types
 */

import type { ContextOptimizationMetadata } from './context-optimization-metadata.js';

// ── Stream Events ──────────────────────────────────────────────────────

export type EngineStreamEventType =
  | 'content'
  | 'thinking'
  | 'tool_start'
  | 'tool_end'
  | 'tool_stream'
  | 'token_count'
  | 'cost'
  | 'done'
  | 'error'
  | 'ask_user'
  | 'plan_progress'
  | 'steer'
  | 'diff_preview'
  | 'goal_status';

export interface EngineStreamEvent {
  type: EngineStreamEventType;
  /** Incremental text delta */
  content?: string;
  /** Reasoning / thinking text delta */
  thinking?: string;
  /** Tool call info (tool_start, tool_end, tool_stream) */
  tool?: {
    id: string;
    name: string;
    input?: string;
    output?: string;
    isError?: boolean;
    delta?: string;
    data?: unknown;
    /** Recoverable model-context reduction; raw output is not transported here. */
    contextOptimization?: ContextOptimizationMetadata;
  };
  /** Token usage info */
  tokenCount?: number;
  /** Cost info in dollars */
  cost?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
  /** Error message */
  error?: string;
  /** Ask user question */
  askUser?: {
    question: string;
    options: string[];
  };
  /** Plan progress */
  planProgress?: {
    taskId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    total: number;
    completed: number;
    message?: string;
  };
  /** User guidance delivered to an active run. */
  steer?: {
    content: string;
    source: string;
  };
  /** Diff preview */
  diffPreview?: {
    turnId: number;
    diffs: Array<{
      path: string;
      action: 'create' | 'modify' | 'delete' | 'rename';
      linesAdded: number;
      linesRemoved: number;
      excerpt: string;
    }>;
    plan?: string;
  };
  /** Autonomous goal-loop progress (for host UIs like the Cowork goal banner). */
  goalStatus?: {
    /** Stable mission identity shared with the Intent Graph and Proof Ledger. */
    goalId?: string;
    goal: string;
    status: 'active' | 'paused' | 'done' | 'cleared';
    turnsUsed: number;
    maxTurns: number;
    /** True when completion is gated by the independent verifier. */
    verifyGated?: boolean;
    lastVerdict?: 'done' | 'continue' | 'skipped';
    lastReason?: string;
  };
}

// ── Messages ───────────────────────────────────────────────────────────

export interface EngineMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ── Session Configuration ──────────────────────────────────────────────

export interface EngineSessionConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  /** Per-session reasoning level supplied by desktop hosts. */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Approval posture scoped to this engine session/turn. */
  permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions';
  maxToolRounds?: number;
  workingDirectory?: string;
  /** Runtime system prompt addition supplied by the host (for active Cowork personas). */
  systemPromptAppend?: string;
  /** Environment variable that signals we're running inside Electron */
  embedded?: boolean;
  /** Activate visual grounding fallback using a Set-of-Marks annotated screenshot */
  visionGroundingEnabled?: boolean;
  /** Specific model to use for visual grounding fallback */
  visionGroundingModel?: string;
}

// ── Session Result ─────────────────────────────────────────────────────

export interface EngineSessionResult {
  content: string;
  tokenCount?: number;
  toolCallCount?: number;
  cost?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
}

// ── Model Info ─────────────────────────────────────────────────────────

export interface EngineModelInfo {
  id: string;
  name?: string;
  provider?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

// ── Permission Request ─────────────────────────────────────────────────

export interface EnginePermissionRequest {
  id: string;
  operation: string;
  filename: string;
  content?: string;
  diffPreview?: string;
}

export type EnginePermissionResponse = 'allow' | 'deny' | 'allow_always';

// ── MCP Server Sync ────────────────────────────────────────────────────

/**
 * MCP server configuration as the host (Cowork) ships it to the engine.
 * Subset of `src/mcp/types.ts:MCPServerConfig` plus the host-only fields
 * that don't apply (id, name shape, etc.) collapsed to the shape the
 * core MCPManager expects.
 */
export interface EngineMcpServerConfig {
  /** Unique server identifier — used as the MCP namespace prefix `mcp__<name>__*`. */
  name: string;
  /** Transport definition (stdio command, SSE URL, etc.). */
  transport: {
    type: 'stdio' | 'http' | 'sse' | 'streamable_http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  };
  enabled?: boolean;
}
