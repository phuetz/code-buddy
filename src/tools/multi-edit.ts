/**
 * MultiEdit Tool -- Apply multiple edits to a single file atomically.
 *
 * Like Claude Code's MultiEdit: takes a file path and an array of
 * {old_string, new_string} pairs, applies them all in sequence.
 * If any edit fails to find its old_string, the entire operation is
 * rolled back (atomic).
 */

import * as path from 'path';
import { ToolResult } from '../types/index.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { getCheckpointManager } from '../checkpoints/checkpoint-manager.js';
import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import { generateDiff as sharedGenerateDiff } from '../utils/diff-generator.js';
import { logger } from '../utils/logger.js';

/**
 * A single edit operation: find old_string and replace with new_string.
 */
export interface SingleFileEdit {
  old_string: string;
  new_string: string;
}

/**
 * MultiEditTool applies multiple string replacements to a single file
 * in one atomic operation. All edits succeed or none are applied.
 */
export class MultiEditTool {
  private confirmationService = ConfirmationService.getInstance();
  private checkpointManager = getCheckpointManager();
  private vfs = UnifiedVfsRouter.Instance;
  private baseDirectory: string = process.cwd();

  /**
   * Set the base directory for path resolution.
   */
  setBaseDirectory(dir: string): void {
    this.baseDirectory = path.resolve(dir);
  }

  /**
   * Execute multiple edits on a single file atomically.
   *
   * @param filePath - Path to the file to edit
   * @param edits - Array of {old_string, new_string} pairs to apply in order
   * @returns ToolResult with diff output on success, or error details on failure
   */
  async execute(filePath: string, edits: SingleFileEdit[]): Promise<ToolResult> {
    // ── Validate inputs ───────────────────────────────────────────
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'file_path is required and must be a string' };
    }

    if (!Array.isArray(edits) || edits.length === 0) {
      return { success: false, error: 'edits must be a non-empty array of {old_string, new_string} pairs' };
    }

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (typeof edit.old_string !== 'string') {
        return { success: false, error: `Edit #${i + 1}: old_string must be a string` };
      }
      if (typeof edit.new_string !== 'string') {
        return { success: false, error: `Edit #${i + 1}: new_string must be a string` };
      }
    }

    // ── Resolve and validate path ─────────────────────────────────
    const pathValidation = this.vfs.resolvePath(filePath, this.baseDirectory);
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error };
    }
    const resolvedPath = pathValidation.resolved;

    if (!(await this.vfs.exists(resolvedPath))) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    // ── Read original content ─────────────────────────────────────
    let originalContent: string;
    try {
      originalContent = await this.vfs.readFile(resolvedPath, 'utf-8');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to read file: ${msg}` };
    }

    // ── Dry-run: apply all edits in memory, checking each ─────────
    let content = originalContent;

    for (let i = 0; i < edits.length; i++) {
      const { old_string, new_string } = edits[i];

      if (!content.includes(old_string)) {
        return {
          success: false,
          error: `Edit #${i + 1} failed: old_string not found in file.\n` +
            `  old_string: "${old_string.length > 80 ? old_string.slice(0, 80) + '...' : old_string}"\n` +
            `  file: ${filePath}\n` +
            `No changes were applied (atomic rollback).`,
        };
      }

      // Replace only the first occurrence (like Claude Code's Edit tool)
      content = content.replace(old_string, new_string);
    }

    // ── If content unchanged, skip write ──────────────────────────
    if (content === originalContent) {
      return {
        success: true,
        output: `No changes needed -- all edits resulted in identical content.`,
      };
    }

    // ── Generate diff for confirmation preview ────────────────────
    const oldLines = originalContent.split('\n');
    const newLines = content.split('\n');
    const diffResult = sharedGenerateDiff(oldLines, newLines, filePath);

    // ── Request confirmation if needed ────────────────────────────
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: `Multi-edit (${edits.length} edits)`,
          filename: filePath,
          showVSCodeOpen: false,
          content: diffResult.diff,
        },
        'file'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Multi-edit cancelled by user',
        };
      }
    }

    // ── Create checkpoint before writing ──────────────────────────
    try {
      this.checkpointManager.checkpointBeforeEdit(filePath);
    } catch (err) {
      logger.warn('Failed to create checkpoint for multi-edit', {
        file: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Write the final content ───────────────────────────────────
    try {
      await this.vfs.writeFile(resolvedPath, content, 'utf-8');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to write file: ${msg}` };
    }

    // ── Build summary ─────────────────────────────────────────────
    const lineDiff = newLines.length - oldLines.length;
    const lineDiffStr = lineDiff === 0
      ? 'same line count'
      : `${lineDiff > 0 ? '+' : ''}${lineDiff} lines`;

    const summary = [
      `Applied ${edits.length} edit${edits.length > 1 ? 's' : ''} to ${filePath} (${lineDiffStr})`,
      '',
      diffResult.diff,
    ].join('\n');

    return {
      success: true,
      output: summary,
    };
  }
}

// ── Singleton accessor ──────────────────────────────────────────────
let multiEditToolInstance: MultiEditTool | null = null;

export function getMultiEditTool(): MultiEditTool {
  if (!multiEditToolInstance) {
    multiEditToolInstance = new MultiEditTool();
  }
  return multiEditToolInstance;
}

export function resetMultiEditTool(): void {
  multiEditToolInstance = null;
}
