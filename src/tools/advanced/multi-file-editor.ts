/**
 * Multi-File Atomic Editor
 *
 * Provides transactional file operations with rollback support.
 * Enables atomic multi-file edits that either all succeed or all fail.
 *
 * Inspired by hurry-mode's multi-file editing capabilities.
 */

import * as path from "path";
import { logger } from "../../utils/logger.js";
import { UnifiedVfsRouter } from "../../services/vfs/unified-vfs-router.js";
import {
  FileOperation,
  EditOperation,
  Transaction,
  TransactionResult,
  RollbackData,
  OperationError,
  ValidationResult,
  ChangePreview,
} from "./types.js";
import { getErrorMessage } from "../../types/index.js";

/**
 * Multi-File Editor
 */
export class MultiFileEditor {
  private transactions: Map<string, Transaction> = new Map();
  private activeTransaction: Transaction | null = null;
  private vfs = UnifiedVfsRouter.Instance;

  /**
   * Begin a new transaction
   */
  beginTransaction(description?: string): string {
    if (this.activeTransaction) {
      throw new Error("A transaction is already active. Commit or rollback first.");
    }

    const transaction: Transaction = {
      id: this.createId("txn"),
      operations: [],
      status: "pending",
      createdAt: Date.now(),
      rollbackData: [],
      description,
    };

    this.transactions.set(transaction.id, transaction);
    this.activeTransaction = transaction;

    return transaction.id;
  }

  /**
   * Add an operation to the active transaction
   */
  addOperation(operation: Omit<FileOperation, "id" | "timestamp">): string {
    if (!this.activeTransaction) {
      throw new Error("No active transaction. Call beginTransaction() first.");
    }

    const fullOperation: FileOperation = {
      ...operation,
      id: this.createId("op"),
      timestamp: Date.now(),
    };

    this.activeTransaction.operations.push(fullOperation);
    return fullOperation.id;
  }

  /**
   * Add a create file operation
   */
  addCreateFile(filePath: string, content: string): string {
    return this.addOperation({
      type: "create",
      filePath,
      content,
    });
  }

  /**
   * Add an edit file operation
   */
  addEditFile(filePath: string, edits: EditOperation[]): string {
    return this.addOperation({
      type: "edit",
      filePath,
      edits,
    });
  }

  /**
   * Add a replace operation (convenience method)
   */
  addReplace(filePath: string, oldText: string, newText: string): string {
    return this.addOperation({
      type: "edit",
      filePath,
      edits: [{ type: "replace", startLine: 0, oldText, newText }],
    });
  }

  /**
   * Add an insert operation
   */
  addInsert(filePath: string, line: number, text: string): string {
    return this.addOperation({
      type: "edit",
      filePath,
      edits: [{ type: "insert", startLine: line, newText: text }],
    });
  }

  /**
   * Add a delete lines operation
   */
  addDeleteLines(filePath: string, startLine: number, endLine: number): string {
    return this.addOperation({
      type: "edit",
      filePath,
      edits: [{ type: "delete_lines", startLine, endLine, newText: "" }],
    });
  }

  /**
   * Add a delete file operation
   */
  addDeleteFile(filePath: string): string {
    return this.addOperation({
      type: "delete",
      filePath,
    });
  }

  /**
   * Add a rename/move file operation
   */
  addRenameFile(oldPath: string, newPath: string): string {
    return this.addOperation({
      type: "rename",
      filePath: oldPath,
      newPath,
    });
  }

  /**
   * Preview all changes in the transaction (async)
   */
  async preview(): Promise<ChangePreview[]> {
    if (!this.activeTransaction) {
      return [];
    }

    const previews: ChangePreview[] = [];

    for (const op of this.activeTransaction.operations) {
      let linesAdded = 0;
      let linesRemoved = 0;
      let diff: string | undefined;

      switch (op.type) {
        case "create":
          linesAdded = (op.content?.split("\n").length || 0);
          diff = `+ ${op.filePath} (new file, ${linesAdded} lines)`;
          break;

        case "delete":
          try {
            const content = await this.vfs.readFile(op.filePath, "utf-8");
            linesRemoved = content.split("\n").length;
          } catch {
            linesRemoved = 0;
          }
          diff = `- ${op.filePath} (deleted, ${linesRemoved} lines)`;
          break;

        case "edit":
          if (op.edits) {
            for (const edit of op.edits) {
              const oldLines = edit.oldText?.split("\n").length || 0;
              const newLines = edit.newText.split("\n").length;
              linesAdded += Math.max(0, newLines - oldLines);
              linesRemoved += Math.max(0, oldLines - newLines);
            }
          }
          diff = `~ ${op.filePath} (+${linesAdded}, -${linesRemoved})`;
          break;

        case "rename":
        case "move":
          diff = `→ ${op.filePath} -> ${op.newPath}`;
          break;
      }

      previews.push({
        filePath: op.filePath,
        type: op.type,
        diff,
        linesAdded,
        linesRemoved,
      });
    }

    return previews;
  }

  /**
   * Validate all operations before commit
   */
  async validate(): Promise<ValidationResult> {
    if (!this.activeTransaction) {
      return { valid: false, errors: ["No active transaction"], warnings: [] };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const op of this.activeTransaction.operations) {
      switch (op.type) {
        case "create":
          if (await this.vfs.exists(op.filePath)) {
            warnings.push(`File already exists: ${op.filePath}`);
          }
          if (!op.content) {
            warnings.push(`Creating empty file: ${op.filePath}`);
          }
          break;

        case "edit":
          if (!(await this.vfs.exists(op.filePath))) {
            errors.push(`File does not exist: ${op.filePath}`);
          }
          if (!op.edits || op.edits.length === 0) {
            errors.push(`No edits specified for: ${op.filePath}`);
          }
          break;

        case "delete":
          if (!(await this.vfs.exists(op.filePath))) {
            warnings.push(`File does not exist: ${op.filePath}`);
          }
          break;

        case "rename":
        case "move":
          if (!(await this.vfs.exists(op.filePath))) {
            errors.push(`Source file does not exist: ${op.filePath}`);
          }
          if (!op.newPath) {
            errors.push(`No target path specified for rename: ${op.filePath}`);
          }
          if (op.newPath && (await this.vfs.exists(op.newPath))) {
            warnings.push(`Target already exists: ${op.newPath}`);
          }
          break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Commit the transaction
   */
  async commit(force = false): Promise<TransactionResult> {
    if (!this.activeTransaction) {
      throw new Error("No active transaction to commit.");
    }

    const startTime = Date.now();
    const transaction = this.activeTransaction;
    const errors: OperationError[] = [];
    let operationsExecuted = 0;

    // Validate first unless forced
    if (!force) {
      const validation = await this.validate();
      if (!validation.valid) {
        return {
          success: false,
          transactionId: transaction.id,
          operationsExecuted: 0,
          operationsFailed: transaction.operations.length,
          errors: validation.errors.map((e, i) => ({
            operationId: `validation-${i}`,
            filePath: "",
            message: e,
          })),
          duration: Date.now() - startTime,
        };
      }
    }

    try {
      // Execute each operation
      for (const op of transaction.operations) {
        try {
          // Capture rollback data before operation (async)
          const rollbackData = await this.captureRollbackData(op);
          transaction.rollbackData.push(rollbackData);

          // Execute operation
          await this.executeOperation(op);
          operationsExecuted++;
        } catch (error) {
          errors.push({
            operationId: op.id,
            filePath: op.filePath,
            message: getErrorMessage(error),
          });

          // Rollback on error
          await this.rollbackTransaction(transaction);

          return {
            success: false,
            transactionId: transaction.id,
            operationsExecuted,
            operationsFailed: transaction.operations.length - operationsExecuted,
            errors,
            duration: Date.now() - startTime,
          };
        }
      }

      // Mark as committed
      transaction.status = "committed";
      transaction.committedAt = Date.now();
      this.activeTransaction = null;

      return {
        success: true,
        transactionId: transaction.id,
        operationsExecuted,
        operationsFailed: 0,
        errors: [],
        duration: Date.now() - startTime,
      };
    } catch (error) {
      // Attempt rollback
      await this.rollbackTransaction(transaction);

      return {
        success: false,
        transactionId: transaction.id,
        operationsExecuted,
        operationsFailed: transaction.operations.length - operationsExecuted,
        errors: [{ operationId: "", filePath: "", message: getErrorMessage(error) }],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Rollback the active transaction
   */
  async rollback(): Promise<void> {
    if (!this.activeTransaction) {
      throw new Error("No active transaction to rollback.");
    }

    await this.rollbackTransaction(this.activeTransaction);
    this.activeTransaction.status = "rolled_back";
    this.activeTransaction = null;
  }

  /**
   * Execute a single file operation (async)
   */
  private async executeOperation(op: FileOperation): Promise<void> {
    switch (op.type) {
      case "create":
        // Ensure directory exists
        const dir = path.dirname(op.filePath);
        await this.vfs.ensureDir(dir);
        await this.vfs.writeFile(op.filePath, op.content || "");
        break;

      case "edit":
        if (!op.edits || op.edits.length === 0) {
          throw new Error("No edits specified");
        }

        let content = await this.vfs.readFile(op.filePath, "utf-8");

        // Apply edits in reverse order for line-based operations
        const sortedEdits = [...op.edits].sort(
          (a, b) => (b.startLine || 0) - (a.startLine || 0)
        );

        for (const edit of sortedEdits) {
          content = this.applyEdit(content, edit);
        }

        await this.vfs.writeFile(op.filePath, content);
        break;

      case "delete":
        if (await this.vfs.exists(op.filePath)) {
          await this.vfs.remove(op.filePath);
        }
        break;

      case "rename":
      case "move":
        if (!op.newPath) {
          throw new Error("No target path specified");
        }

        // Ensure target directory exists
        const targetDir = path.dirname(op.newPath);
        await this.vfs.ensureDir(targetDir);

        await this.vfs.rename(op.filePath, op.newPath);
        break;
    }
  }

  /**
   * Apply a single edit to content
   */
  private applyEdit(content: string, edit: EditOperation): string {
    const lines = content.split("\n");

    switch (edit.type) {
      case "replace":
        if (edit.oldText) {
          return content.replace(edit.oldText, edit.newText);
        }
        return content;

      case "insert":
        const insertIndex = Math.max(0, Math.min(edit.startLine - 1, lines.length));
        lines.splice(insertIndex, 0, edit.newText);
        return lines.join("\n");

      case "delete_lines":
        const startIdx = Math.max(0, edit.startLine - 1);
        const endIdx = edit.endLine ? Math.min(edit.endLine, lines.length) : startIdx + 1;
        lines.splice(startIdx, endIdx - startIdx);
        return lines.join("\n");

      default:
        return content;
    }
  }

  /**
   * Capture rollback data for an operation (async)
   */
  private async captureRollbackData(op: FileOperation): Promise<RollbackData> {
    const existed = await this.vfs.exists(op.filePath);
    let originalContent: string | undefined;

    if (existed && (op.type === "edit" || op.type === "delete")) {
      try {
        originalContent = await this.vfs.readFile(op.filePath, "utf-8");
      } catch {
        // Can't read file
      }
    }

    return {
      operationId: op.id,
      filePath: op.filePath,
      originalContent,
      originalPath: op.type === "rename" || op.type === "move" ? op.filePath : undefined,
      existed,
    };
  }

  /**
   * Rollback a transaction (async)
   */
  private async rollbackTransaction(transaction: Transaction): Promise<void> {
    // Rollback in reverse order
    const reversedRollback = [...transaction.rollbackData].reverse();

    for (const rollback of reversedRollback) {
      try {
        const op = transaction.operations.find((o) => o.id === rollback.operationId);
        if (!op) continue;

        switch (op.type) {
          case "create":
            // Delete created file
            if (await this.vfs.exists(op.filePath)) {
              await this.vfs.remove(op.filePath);
            }
            break;

          case "edit":
            // Restore original content
            if (rollback.originalContent !== undefined) {
              await this.vfs.writeFile(op.filePath, rollback.originalContent);
            }
            break;

          case "delete":
            // Restore deleted file
            if (rollback.originalContent !== undefined) {
              await this.vfs.writeFile(rollback.filePath, rollback.originalContent);
            }
            break;

          case "rename":
          case "move":
            // Move back to original location
            if (op.newPath && (await this.vfs.exists(op.newPath))) {
              await this.vfs.rename(op.newPath, rollback.filePath);
            }
            break;
        }
      } catch (error) {
        // Log but continue rollback
        logger.error(`Rollback error for ${rollback.filePath}`, { error });
      }
    }
  }

  /**
   * Execute a multi-file operation atomically
   */
  async executeMultiFileOperation(
    operations: Array<Omit<FileOperation, "id" | "timestamp">>,
    description?: string
  ): Promise<TransactionResult> {
    this.beginTransaction(description);

    for (const op of operations) {
      this.addOperation(op);
    }

    return this.commit();
  }

  /**
   * Get transaction by ID
   */
  getTransaction(transactionId: string): Transaction | undefined {
    return this.transactions.get(transactionId);
  }

  /**
   * Get all transactions
   */
  getAllTransactions(): Transaction[] {
    return Array.from(this.transactions.values());
  }

  /**
   * Check if there's an active transaction
   */
  hasActiveTransaction(): boolean {
    return this.activeTransaction !== null;
  }

  /**
   * Get active transaction ID
   */
  getActiveTransactionId(): string | null {
    return this.activeTransaction?.id || null;
  }

  /**
   * Clear transaction history
   */
  clearHistory(): void {
    this.transactions.clear();
  }

  /**
   * Create unique ID
   */
  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

/**
 * Create a multi-file editor
 */
export function createMultiFileEditor(): MultiFileEditor {
  return new MultiFileEditor();
}

// Singleton instance
let multiFileEditorInstance: MultiFileEditor | null = null;

export function getMultiFileEditor(): MultiFileEditor {
  if (!multiFileEditorInstance) {
    multiFileEditorInstance = createMultiFileEditor();
  }
  return multiFileEditorInstance;
}

export function resetMultiFileEditor(): void {
  multiFileEditorInstance = null;
}
