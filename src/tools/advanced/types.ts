/**
 * Advanced Tools Types
 *
 * Types for multi-file editing and operation history.
 */

/**
 * File operation types
 */
export type FileOperationType = "create" | "edit" | "delete" | "rename" | "move";

/**
 * Edit operation types
 */
export type EditOperationType = "replace" | "insert" | "delete_lines";

/**
 * A single file operation
 */
export interface FileOperation {
  id: string;
  type: FileOperationType;
  filePath: string;
  newPath?: string; // For rename/move
  content?: string; // For create
  edits?: EditOperation[]; // For edit
  timestamp: number;
}

/**
 * A single edit operation within a file
 */
export interface EditOperation {
  type: EditOperationType;
  startLine: number;
  endLine?: number;
  oldText?: string;
  newText: string;
}

/**
 * Transaction for atomic multi-file operations
 */
export interface Transaction {
  id: string;
  operations: FileOperation[];
  status: "pending" | "committed" | "rolled_back" | "failed";
  createdAt: number;
  committedAt?: number;
  rollbackData: RollbackData[];
  description?: string;
}

/**
 * Data needed to rollback an operation
 */
export interface RollbackData {
  operationId: string;
  filePath: string;
  originalContent?: string;
  originalPath?: string;
  existed: boolean;
}

/**
 * Result of a transaction
 */
export interface TransactionResult {
  success: boolean;
  transactionId: string;
  operationsExecuted: number;
  operationsFailed: number;
  errors: OperationError[];
  duration: number;
}

/**
 * Operation error
 */
export interface OperationError {
  operationId: string;
  filePath: string;
  message: string;
}

/**
 * History entry
 */
export interface HistoryEntry {
  id: string;
  type: "operation" | "transaction";
  description: string;
  operations: FileOperation[];
  rollbackData: RollbackData[];
  timestamp: number;
  canUndo: boolean;
}

/**
 * File snapshot for history
 */
export interface FileSnapshot {
  filePath: string;
  content: string;
  exists: boolean;
  permissions?: string;
  modifiedAt: number;
}

/**
 * History configuration
 */
export interface HistoryConfig {
  maxEntries: number;
  retentionDays: number;
  maxFileSize: number; // Max file size to snapshot
  excludePatterns: string[];
  persistPath: string;
}

/**
 * Default history configuration
 */
export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxEntries: 100,
  retentionDays: 7,
  maxFileSize: 1024 * 1024, // 1MB
  excludePatterns: ["node_modules", ".git", "dist", "*.log"],
  persistPath: "~/.grok/operation-history.json",
};

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Preview of changes
 */
export interface ChangePreview {
  filePath: string;
  type: FileOperationType;
  diff?: string;
  linesAdded: number;
  linesRemoved: number;
}
