/**
 * Operation History Tool
 *
 * Tracks file operations and provides undo/redo capabilities.
 * Persists history to disk for recovery across sessions.
 *
 * Inspired by hurry-mode's operation history capabilities.
 */

import { UnifiedVfsRouter } from '../../services/vfs/unified-vfs-router.js';
import * as path from "path";
import * as os from "os";
import { logger } from "../../utils/logger.js";
import {
  HistoryEntry,
  FileSnapshot,
  HistoryConfig,
  FileOperation,
  RollbackData,
  DEFAULT_HISTORY_CONFIG,
} from "./types.js";
import { getErrorMessage } from "../../types/index.js";

/**
 * Operation History Manager
 */
export class OperationHistory {
  private config: HistoryConfig;
  private history: HistoryEntry[] = [];
  private currentPosition: number = -1;
  private persistPath: string;
  private vfs = UnifiedVfsRouter.Instance;

  constructor(config: Partial<HistoryConfig> = {}) {
    this.config = { ...DEFAULT_HISTORY_CONFIG, ...config };
    this.persistPath = this.config.persistPath.replace("~", os.homedir());
  }

  /**
   * Initialize history (load from disk)
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.persistPath);
    await this.vfs.ensureDir(dir);

    // Load existing history
    await this.load();
  }

  /**
   * Record a new operation
   */
  async record(
    description: string,
    operations: FileOperation[],
    rollbackData: RollbackData[]
  ): Promise<string> {
    // Remove any entries after current position (for redo)
    if (this.currentPosition < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentPosition + 1);
    }

    const entry: HistoryEntry = {
      id: this.createId("hist"),
      type: operations.length > 1 ? "transaction" : "operation",
      description,
      operations,
      rollbackData,
      timestamp: Date.now(),
      canUndo: true,
    };

    this.history.push(entry);
    this.currentPosition = this.history.length - 1;

    // Enforce max entries
    this.enforceMaxEntries();

    // Persist
    await this.save();

    return entry.id;
  }

  /**
   * Record a file snapshot before modification
   */
  async recordSnapshot(filePath: string): Promise<FileSnapshot | null> {
    // Check file size
    try {
      const stats = await this.vfs.stat(filePath);
      if (stats.size > this.config.maxFileSize) {
        return null; // Too large to snapshot
      }

      // Check exclude patterns
      for (const pattern of this.config.excludePatterns) {
        if (pattern.startsWith("*")) {
          if (filePath.endsWith(pattern.slice(1))) {
            return null;
          }
        } else if (filePath.includes(pattern)) {
          return null;
        }
      }

      return {
        filePath,
        content: await this.vfs.readFile(filePath, "utf-8"),
        exists: true,
        modifiedAt: stats.mtime.getTime(),
      };
    } catch {
      return {
        filePath,
        content: "",
        exists: false,
        modifiedAt: Date.now(),
      };
    }
  }

  /**
   * Undo the last operation
   */
  async undo(): Promise<{ success: boolean; entry?: HistoryEntry; error?: string }> {
    if (this.currentPosition < 0) {
      return { success: false, error: "Nothing to undo" };
    }

    const entry = this.history[this.currentPosition];
    if (!entry.canUndo) {
      return { success: false, error: "Operation cannot be undone" };
    }

    try {
      // Restore files from rollback data
      for (const rollback of entry.rollbackData) {
        await this.restoreFromRollback(rollback);
      }

      this.currentPosition--;
      await this.save();

      return { success: true, entry };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /**
   * Redo the last undone operation
   */
  async redo(): Promise<{ success: boolean; entry?: HistoryEntry; error?: string }> {
    if (this.currentPosition >= this.history.length - 1) {
      return { success: false, error: "Nothing to redo" };
    }

    const entry = this.history[this.currentPosition + 1];

    try {
      // Re-execute operations
      for (const op of entry.operations) {
        await this.executeOperation(op);
      }

      this.currentPosition++;
      await this.save();

      return { success: true, entry };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /**
   * Jump to a specific history point
   */
  async goToHistoryPoint(
    targetIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    if (targetIndex < -1 || targetIndex >= this.history.length) {
      return { success: false, error: "Invalid history index" };
    }

    try {
      // Navigate to the target point
      while (this.currentPosition > targetIndex) {
        const result = await this.undo();
        if (!result.success) {
          return result;
        }
      }

      while (this.currentPosition < targetIndex) {
        const result = await this.redo();
        if (!result.success) {
          return result;
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /**
   * Get history entries
   */
  getHistory(limit?: number): HistoryEntry[] {
    const entries = [...this.history].reverse();
    return limit ? entries.slice(0, limit) : entries;
  }

  /**
   * Get entry at specific index
   */
  getEntry(index: number): HistoryEntry | undefined {
    return this.history[index];
  }

  /**
   * Get entry by ID
   */
  getEntryById(id: string): HistoryEntry | undefined {
    return this.history.find((e) => e.id === id);
  }

  /**
   * Get current position
   */
  getCurrentPosition(): number {
    return this.currentPosition;
  }

  /**
   * Check if can undo
   */
  canUndo(): boolean {
    return this.currentPosition >= 0;
  }

  /**
   * Check if can redo
   */
  canRedo(): boolean {
    return this.currentPosition < this.history.length - 1;
  }

  /**
   * Clear all history
   */
  async clear(): Promise<void> {
    this.history = [];
    this.currentPosition = -1;
    await this.save();
  }

  /**
   * Restore file from rollback data
   */
  private async restoreFromRollback(rollback: RollbackData): Promise<void> {
    if (rollback.existed) {
      if (rollback.originalContent !== undefined) {
        // Ensure directory exists
        const dir = path.dirname(rollback.filePath);
        await this.vfs.ensureDir(dir);
        await this.vfs.writeFile(rollback.filePath, rollback.originalContent);
      }
    } else {
      // File didn't exist before, delete it
      if (await this.vfs.exists(rollback.filePath)) {
        await this.vfs.remove(rollback.filePath);
      }
    }

    // Handle renames
    if (rollback.originalPath && rollback.originalPath !== rollback.filePath) {
      if (await this.vfs.exists(rollback.filePath)) {
        await this.vfs.rename(rollback.filePath, rollback.originalPath);
      }
    }
  }

  /**
   * Execute an operation (for redo)
   */
  private async executeOperation(op: FileOperation): Promise<void> {
    switch (op.type) {
      case "create":
        const dir = path.dirname(op.filePath);
        await this.vfs.ensureDir(dir);
        await this.vfs.writeFile(op.filePath, op.content || "");
        break;

      case "edit":
        if (op.edits) {
          let content = await this.vfs.readFile(op.filePath, "utf-8");
          for (const edit of op.edits) {
            if (edit.type === "replace" && edit.oldText) {
              content = content.replace(edit.oldText, edit.newText);
            } else if (edit.type === "insert") {
              const lines = content.split("\n");
              lines.splice(edit.startLine - 1, 0, edit.newText);
              content = lines.join("\n");
            } else if (edit.type === "delete_lines" && edit.endLine) {
              const lines = content.split("\n");
              lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1);
              content = lines.join("\n");
            }
          }
          await this.vfs.writeFile(op.filePath, content);
        }
        break;

      case "delete":
        if (await this.vfs.exists(op.filePath)) {
          await this.vfs.remove(op.filePath);
        }
        break;

      case "rename":
      case "move":
        if (op.newPath) {
          const targetDir = path.dirname(op.newPath);
          await this.vfs.ensureDir(targetDir);
          await this.vfs.rename(op.filePath, op.newPath);
        }
        break;
    }
  }

  /**
   * Enforce maximum entries
   */
  private enforceMaxEntries(): void {
    if (this.history.length > this.config.maxEntries) {
      const removeCount = this.history.length - this.config.maxEntries;
      this.history = this.history.slice(removeCount);
      this.currentPosition = Math.max(-1, this.currentPosition - removeCount);
    }

    // Also enforce retention period
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const beforeCount = this.history.length;

    this.history = this.history.filter((e) => e.timestamp >= cutoff);

    const removed = beforeCount - this.history.length;
    if (removed > 0) {
      this.currentPosition = Math.max(-1, this.currentPosition - removed);
    }
  }

  /**
   * Save history to disk
   */
  private async save(): Promise<void> {
    try {
      const data = {
        version: 1,
        currentPosition: this.currentPosition,
        history: this.history,
      };
      await this.vfs.writeFile(this.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error("Failed to save operation history", { error });
    }
  }

  /**
   * Load history from disk
   */
  private async load(): Promise<void> {
    try {
      if (await this.vfs.exists(this.persistPath)) {
        const content = await this.vfs.readFile(this.persistPath, "utf-8");
        const data = JSON.parse(content);
        if (data.version === 1) {
          this.history = data.history || [];
          this.currentPosition = data.currentPosition ?? -1;

          // Enforce retention on load
          this.enforceMaxEntries();
        }
      }
    } catch (error) {
      logger.error("Failed to load operation history", { error });
      this.history = [];
      this.currentPosition = -1;
    }
  }

  /**
   * Format history for display
   */
  formatHistory(limit = 20): string {
    const lines: string[] = [];

    lines.push("═".repeat(60));
    lines.push("📜 OPERATION HISTORY");
    lines.push("═".repeat(60));
    lines.push("");

    const entries = this.getHistory(limit);
    const currentIdx = this.history.length - 1 - this.currentPosition;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isCurrent = i === currentIdx;
      const pointer = isCurrent ? "→" : " ";
      const date = new Date(entry.timestamp).toLocaleString();

      lines.push(
        `${pointer} ${i + 1}. [${entry.type}] ${entry.description}`
      );
      lines.push(`     ${date}`);
      lines.push(`     ${entry.operations.length} operation(s)`);
      lines.push("");
    }

    if (entries.length === 0) {
      lines.push("  No operations recorded");
      lines.push("");
    }

    lines.push("─".repeat(40));
    lines.push(`Position: ${this.currentPosition + 1}/${this.history.length}`);
    lines.push(`Can undo: ${this.canUndo() ? "Yes" : "No"}`);
    lines.push(`Can redo: ${this.canRedo() ? "Yes" : "No"}`);
    lines.push("");
    lines.push("═".repeat(60));

    return lines.join("\n");
  }

  /**
   * Create unique ID
   */
  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEntries: number;
    currentPosition: number;
    canUndo: boolean;
    canRedo: boolean;
    oldestEntry: Date | null;
    newestEntry: Date | null;
  } {
    return {
      totalEntries: this.history.length,
      currentPosition: this.currentPosition,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      oldestEntry: this.history.length > 0
        ? new Date(this.history[0].timestamp)
        : null,
      newestEntry: this.history.length > 0
        ? new Date(this.history[this.history.length - 1].timestamp)
        : null,
    };
  }
}

/**
 * Create an operation history manager
 */
export function createOperationHistory(
  config?: Partial<HistoryConfig>
): OperationHistory {
  return new OperationHistory(config);
}

// Singleton instance
let operationHistoryInstance: OperationHistory | null = null;

export function getOperationHistory(): OperationHistory {
  if (!operationHistoryInstance) {
    operationHistoryInstance = createOperationHistory();
  }
  return operationHistoryInstance;
}

export function resetOperationHistory(): void {
  operationHistoryInstance = null;
}
