/**
 * Standard tool result interface
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: unknown;
  // Alternative property names used by some tools
  content?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Generic typed tool result for type-safe tool outputs
 * @template T - The type of the output data
 */
export interface TypedToolResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool result with string output (most common case)
 */
export type StringToolResult = TypedToolResult<string>;

/**
 * Tool result with structured data output
 */
export type DataToolResult<T> = TypedToolResult<T> & {
  data?: T;
};

/**
 * Async tool result type helper
 */
export type AsyncToolResult<T = unknown> = Promise<TypedToolResult<T>>;

/**
 * Base tool interface
 */
export interface Tool {
  name: string;
  description: string;
  execute: (...args: unknown[]) => Promise<ToolResult>;
}

/**
 * Tool arguments as parsed from JSON
 */
export type ToolArguments = Record<string, unknown>;

/**
 * Validated tool call with typed arguments
 */
export interface ValidatedToolCall<TArgs extends ToolArguments = ToolArguments> {
  id: string;
  name: string;
  arguments: TArgs;
}

/**
 * Type guard for error objects
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Extract error message from unknown error.
 * Canonical implementation in src/errors/index.ts — re-exported here for convenience.
 */
export { getErrorMessage } from '../errors/index.js';

/**
 * Extract error code from unknown error (for filesystem errors like ENOENT)
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

/**
 * Type for generic record with unknown values
 */
export type UnknownRecord = Record<string, unknown>;

export interface EditorCommand {
  command: 'view' | 'str_replace' | 'create' | 'insert' | 'undo_edit';
  path?: string;
  old_str?: string;
  new_str?: string;
  content?: string;
  insert_line?: number;
  view_range?: [number, number];
  replace_all?: boolean;
  /** SHA-256 hash of file content AFTER the edit (for undo verification) */
  fileHash?: string;
}

export interface AgentState {
  currentDirectory: string;
  editHistory: EditorCommand[];
  tools: Tool[];
}

export interface ConfirmationState {
  skipThisSession: boolean;
  pendingOperation: boolean;
}

// Cache types
export type {
  BaseCacheEntry,
  TimedCacheEntry,
  LRUCacheEntry,
  FullCacheEntry,
  BaseCacheStats,
  DetailedCacheStats,
  CategorizedCacheStats,
  BaseCacheConfig,
  LRUCacheConfig,
  SemanticCacheConfig,
  CacheLookupResult,
  CacheEvent,
  ICache,
  IAsyncCache,
} from './cache-types.js';
export {
  isCacheEntry,
  isExpired,
  calculateHitRate,
  createCacheEntry,
  createTimedCacheEntry,
  createLRUCacheEntry,
  createCacheStats,
} from './cache-types.js';

// API types
export type { ChatMessage, MessageContent, MessageContentPart, ToolCall } from './api.js';
