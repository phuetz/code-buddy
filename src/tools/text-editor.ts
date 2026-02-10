import * as path from "path";
import { ToolResult, EditorCommand, getErrorMessage } from "../types/index.js";
import { ConfirmationService } from "../utils/confirmation-service.js";
import { Disposable, registerDisposable } from "../utils/disposable.js";
import { logger } from "../utils/logger.js";
import {
  findBestFuzzyMatch,
  generateFuzzyDiff,
  suggestWhitespaceFixes,
} from "../utils/fuzzy-match.js";
import { UnifiedVfsRouter } from "../services/vfs/unified-vfs-router.js";
import { generateDiff as sharedGenerateDiff } from "../utils/diff-generator.js";

/**
 * Text Editor Tool
 *
 * Provides safe file viewing and editing operations with:
 * - Path validation and resolution via VFS router
 * - User confirmation for write operations
 * - Fuzzy matching for string replacements (90% similarity threshold)
 * - Edit history with undo capability
 * - Unified diff output for all modifications
 *
 * All write operations (create, strReplace, insert, replaceLines) require
 * user confirmation unless session-level file operation approval is granted.
 */
export class TextEditorTool implements Disposable {
  private editHistory: EditorCommand[] = [];
  private confirmationService = ConfirmationService.getInstance();
  private baseDirectory: string = process.cwd();
  private vfs = UnifiedVfsRouter.Instance;

  constructor() {
    registerDisposable(this);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.editHistory = [];
  }

  /**
   * Set the base directory for path validation
   */
  setBaseDirectory(dir: string): void {
    this.baseDirectory = path.resolve(dir);
  }

  /**
   * View file contents or directory listing
   *
   * @param filePath - Absolute or relative path to file/directory
   * @param viewRange - Optional [startLine, endLine] tuple for partial view (1-indexed)
   * @returns File contents with line numbers, or directory listing, or error
   *
   * @example
   * // View entire file (up to 500 lines shown inline)
   * await editor.view('src/index.ts');
   *
   * // View specific line range
   * await editor.view('src/index.ts', [10, 25]);
   */
  async view(
    filePath: string,
    viewRange?: [number, number]
  ): Promise<ToolResult> {
    try {
      const pathValidation = this.vfs.resolvePath(filePath, this.baseDirectory);
      if (!pathValidation.valid) {
        return { success: false, error: pathValidation.error };
      }
      const resolvedPath = pathValidation.resolved;

      if (await this.vfs.exists(resolvedPath)) {
        const stats = await this.vfs.stat(resolvedPath);

        if (stats.isDirectory()) {
          const files = await this.vfs.readdir(resolvedPath);
          return {
            success: true,
            output: `Directory contents of ${filePath}:\n${files.join("\n")}`,
          };
        }

        const content = await this.vfs.readFile(resolvedPath, "utf-8");
        const lines = content.split("\n");

        if (viewRange) {
          const [start, end] = viewRange;
          const selectedLines = lines.slice(start - 1, end);
          const numberedLines = selectedLines
            .map((line, idx) => `${start + idx}: ${line}`)
            .join("\n");

          return {
            success: true,
            output: `Lines ${start}-${end} of ${filePath}:\n${numberedLines}`,
          };
        }

        const totalLines = lines.length;
        const maxFullDisplayLines = 500;
        const headDisplayLines = 400;
        const tailDisplayLines = 100;

        if (totalLines <= maxFullDisplayLines) {
          const numberedLines = lines
            .map((line, idx) => `${idx + 1}: ${line}`)
            .join("\n");
          return {
            success: true,
            output: `Contents of ${filePath}:\n${numberedLines}`,
          };
        }

        // For very large files, keep both start and end context.
        const headLines = lines.slice(0, headDisplayLines)
          .map((line, idx) => `${idx + 1}: ${line}`)
          .join("\n");
        const tailStartLine = totalLines - tailDisplayLines + 1;
        const tailLines = lines.slice(-tailDisplayLines)
          .map((line, idx) => `${tailStartLine + idx}: ${line}`)
          .join("\n");
        const omitted = totalLines - headDisplayLines - tailDisplayLines;
        const omittedStart = headDisplayLines + 1;
        const omittedEnd = totalLines - tailDisplayLines;

        return {
          success: true,
          output: `Contents of ${filePath} (${totalLines} lines):\n${headLines}\n\n... +${omitted} lines omitted (lines ${omittedStart}-${omittedEnd}; use start_line/end_line to view specific sections) ...\n\n${tailLines}`,
        };
      } else {
        return {
          success: false,
          error: `File or directory not found: ${filePath}`,
        };
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Error viewing ${filePath}: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Replace text in a file using exact or fuzzy matching
   *
   * Uses a 90% similarity threshold for fuzzy matching when exact match fails,
   * allowing tolerance for minor whitespace differences.
   *
   * @param filePath - Path to the file to edit
   * @param oldStr - Text to find and replace
   * @param newStr - Replacement text
   * @param replaceAll - If true, replaces all occurrences; otherwise only first
   * @returns Unified diff showing the changes, or error with suggestions
   *
   * @example
   * // Replace single occurrence
   * await editor.strReplace('file.ts', 'oldText', 'newText');
   *
   * // Replace all occurrences
   * await editor.strReplace('file.ts', 'oldText', 'newText', true);
   */
  async strReplace(
    filePath: string,
    oldStr: string,
    newStr: string,
    replaceAll: boolean = false
  ): Promise<ToolResult> {
    try {
      const pathValidation = this.vfs.resolvePath(filePath, this.baseDirectory);
      if (!pathValidation.valid) {
        return { success: false, error: pathValidation.error };
      }
      const resolvedPath = pathValidation.resolved;

      if (!(await this.vfs.exists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      const content = await this.vfs.readFile(resolvedPath, "utf-8");

      if (!content.includes(oldStr)) {
        // Try fuzzy matching with 90% similarity threshold (like mistral-vibe)
        const fuzzyResult = findBestFuzzyMatch(content, oldStr, 0.9);

        if (fuzzyResult) {
          // Found a fuzzy match - show diff and use it
          const fuzzyDiff = generateFuzzyDiff(oldStr, fuzzyResult.match, filePath, fuzzyResult);
          logger.debug("Fuzzy match applied", { diff: fuzzyDiff });

          // Use the actual match from the file
          oldStr = fuzzyResult.match;
        } else {
          // No match found - provide helpful error with suggestions
          const suggestions = suggestWhitespaceFixes(oldStr, content);
          let errorMessage = `String not found in file: "${oldStr.substring(0, 100)}${oldStr.length > 100 ? '...' : ''}"`;

          if (suggestions.length > 0) {
            errorMessage += '\n\n💡 Possible issues:\n' + suggestions.map(s => `  • ${s}`).join('\n');
          }

          if (oldStr.includes('\n')) {
            errorMessage += '\n\n💡 Tip: For multi-line replacements, ensure exact whitespace match or use line-based editing.';
          }

          return {
            success: false,
            error: errorMessage,
          };
        }
      }

      const occurrences = (content.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
        const previewContent = replaceAll 
          ? content.split(oldStr).join(newStr)
          : content.replace(oldStr, newStr);
        const oldLines = content.split("\n");
        const newLines = previewContent.split("\n");
        const diffContent = this.generateDiff(oldLines, newLines, filePath);

        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: `Edit file${replaceAll && occurrences > 1 ? ` (${occurrences} occurrences)` : ''}`,
              filename: filePath,
              showVSCodeOpen: false,
              content: diffContent,
            },
            "file"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback || "File edit cancelled by user",
          };
        }
      }

      const newContent = replaceAll
        ? content.split(oldStr).join(newStr)
        : content.replace(oldStr, newStr);
      await this.vfs.writeFile(resolvedPath, newContent, "utf-8");

      this.editHistory.push({
        command: "str_replace",
        path: filePath,
        old_str: oldStr,
        new_str: newStr,
      });

      const oldLines = content.split("\n");
      const newLines = newContent.split("\n");
      const diff = this.generateDiff(oldLines, newLines, filePath);

      return {
        success: true,
        output: diff,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Error replacing text in ${filePath}: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Create a new file with the specified content
   *
   * Will fail if the file already exists (use strReplace to modify existing files).
   * Creates parent directories if they don't exist.
   *
   * @param filePath - Path where the new file should be created
   * @param content - Content to write to the file
   * @returns Unified diff showing the file creation, or error
   */
  async create(filePath: string, content: string): Promise<ToolResult> {
    try {
      const pathValidation = this.vfs.resolvePath(filePath, this.baseDirectory);
      if (!pathValidation.valid) {
        return { success: false, error: pathValidation.error };
      }
      const resolvedPath = pathValidation.resolved;

      // Check if file already exists - prevent accidental overwrite
      if (await this.vfs.exists(resolvedPath)) {
        const stats = await this.vfs.stat(resolvedPath);
        if (stats.isFile()) {
          return {
            success: false,
            error: `File already exists: ${filePath}. Use str_replace_editor to modify existing files instead of create_file.`,
          };
        }
      }

      // Check if user has already accepted file operations for this session
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
        // Create a diff-style preview for file creation
        const contentLines = content.split("\n");
        const diffContent = [
          `Created ${filePath}`,
          `--- /dev/null`,
          `+++ b/${filePath}`,
          `@@ -0,0 +1,${contentLines.length} @@`,
          ...contentLines.map((line) => `+${line}`),
        ].join("\n");

        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: "Write",
              filename: filePath,
              showVSCodeOpen: false,
              content: diffContent,
            },
            "file"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error:
              confirmationResult.feedback || "File creation cancelled by user",
          };
        }
      }

      const dir = path.dirname(resolvedPath);
      await this.vfs.ensureDir(dir);
      await this.vfs.writeFile(resolvedPath, content, "utf-8");

      this.editHistory.push({
        command: "create",
        path: filePath,
        content,
      });

      // Generate diff output using the same method as str_replace
      const oldLines: string[] = []; // Empty for new files
      const newLines = content.split("\n");
      const diff = this.generateDiff(oldLines, newLines, filePath);

      return {
        success: true,
        output: diff,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Error creating ${filePath}: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Replace a range of lines in a file
   *
   * @param filePath - Path to the file to edit
   * @param startLine - First line to replace (1-indexed, inclusive)
   * @param endLine - Last line to replace (1-indexed, inclusive)
   * @param newContent - Content to insert (can be multiple lines)
   * @returns Unified diff showing the changes, or error
   */
  async replaceLines(
    filePath: string,
    startLine: number,
    endLine: number,
    newContent: string
  ): Promise<ToolResult> {
    try {
      const pathValidation = this.vfs.resolvePath(filePath, this.baseDirectory);
      if (!pathValidation.valid) {
        return { success: false, error: pathValidation.error };
      }
      const resolvedPath = pathValidation.resolved;

      if (!(await this.vfs.exists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      const fileContent = await this.vfs.readFile(resolvedPath, "utf-8");
      const lines = fileContent.split("\n");
      
      if (startLine < 1 || startLine > lines.length) {
        return {
          success: false,
          error: `Invalid start line: ${startLine}. File has ${lines.length} lines.`,
        };
      }
      
      if (endLine < startLine || endLine > lines.length) {
        return {
          success: false,
          error: `Invalid end line: ${endLine}. Must be between ${startLine} and ${lines.length}.`,
        };
      }

      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
        const newLines = [...lines];
        const replacementLines = newContent.split("\n");
        newLines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
        
        const diffContent = this.generateDiff(lines, newLines, filePath);

        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: `Replace lines ${startLine}-${endLine}`,
              filename: filePath,
              showVSCodeOpen: false,
              content: diffContent,
            },
            "file"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback || "Line replacement cancelled by user",
          };
        }
      }

      const replacementLines = newContent.split("\n");
      lines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
      const newFileContent = lines.join("\n");

      await this.vfs.writeFile(resolvedPath, newFileContent, "utf-8");

      this.editHistory.push({
        command: "str_replace",
        path: filePath,
        old_str: `lines ${startLine}-${endLine}`,
        new_str: newContent,
      });

      const oldLines = fileContent.split("\n");
      const diff = this.generateDiff(oldLines, lines, filePath);

      return {
        success: true,
        output: diff,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Error replacing lines in ${filePath}: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Insert content at a specific line in a file
   *
   * @param filePath - Path to the file to edit
   * @param insertLine - Line number where content will be inserted (1-indexed)
   * @param content - Content to insert (can be multiple lines)
   * @returns Success message or error
   */
  async insert(
    filePath: string,
    insertLine: number,
    content: string
  ): Promise<ToolResult> {
    try {
      const pathValidation = this.vfs.resolvePath(filePath, this.baseDirectory);
      if (!pathValidation.valid) {
        return { success: false, error: pathValidation.error };
      }
      const resolvedPath = pathValidation.resolved;

      if (!(await this.vfs.exists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      const fileContent = await this.vfs.readFile(resolvedPath, "utf-8");
      const lines = fileContent.split("\n");

      // Validate insert line
      if (insertLine < 1 || insertLine > lines.length + 1) {
        return {
          success: false,
          error: `Invalid insert line: ${insertLine}. Must be between 1 and ${lines.length + 1}.`,
        };
      }

      // Request confirmation for insert operation
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
        const previewLines = [...lines];
        previewLines.splice(insertLine - 1, 0, content);
        const diffContent = this.generateDiff(lines, previewLines, filePath);

        const confirmationResult =
          await this.confirmationService.requestConfirmation(
            {
              operation: `Insert at line ${insertLine}`,
              filename: filePath,
              showVSCodeOpen: false,
              content: diffContent,
            },
            "file"
          );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback || "Insert operation cancelled by user",
          };
        }
      }

      lines.splice(insertLine - 1, 0, content);
      const newContent = lines.join("\n");

      await this.vfs.writeFile(resolvedPath, newContent, "utf-8");

      this.editHistory.push({
        command: "insert",
        path: filePath,
        insert_line: insertLine,
        content,
      });

      return {
        success: true,
        output: `Successfully inserted content at line ${insertLine} in ${filePath}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Error inserting content in ${filePath}: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Undo the last edit operation
   *
   * Supports undoing: str_replace, create, and insert operations.
   * Note: Undo is best-effort and may fail if the file was modified externally.
   *
   * @returns Success message or error if no edits to undo
   */
  async undoEdit(): Promise<ToolResult> {
    if (this.editHistory.length === 0) {
      return {
        success: false,
        error: "No edits to undo",
      };
    }

    const lastEdit = this.editHistory.pop()!;

    try {
      switch (lastEdit.command) {
        case "str_replace":
          if (lastEdit.path && lastEdit.old_str && lastEdit.new_str) {
            const content = await this.vfs.readFile(lastEdit.path, "utf-8");
            // Use split/join to replace ALL occurrences (replaceAll equivalent)
            const revertedContent = content.split(lastEdit.new_str).join(lastEdit.old_str);
            await this.vfs.writeFile(lastEdit.path, revertedContent, "utf-8");
          }
          break;

        case "create":
          if (lastEdit.path) {
            await this.vfs.remove(lastEdit.path);
          }
          break;

        case "insert":
          if (lastEdit.path && lastEdit.insert_line) {
            const content = await this.vfs.readFile(lastEdit.path, "utf-8");
            const lines = content.split("\n");
            lines.splice(lastEdit.insert_line - 1, 1);
            await this.vfs.writeFile(lastEdit.path, lines.join("\n"), "utf-8");
          }
          break;
      }

      return {
        success: true,
        output: `Successfully undid ${lastEdit.command} operation`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Error undoing edit: ${getErrorMessage(error)}`,
      };
    }
  }

  // Note: Old findFuzzyMatch, normalizeForComparison, and isSimilarStructure
  // have been replaced by the improved fuzzy-match.ts utility which uses
  // LCS-based similarity matching like mistral-vibe's difflib.SequenceMatcher

  /**
   * Generate unified diff between old and new content
   * Uses shared diff-generator utility for consistent diff output across tools
   */
  private generateDiff(
    oldLines: string[],
    newLines: string[],
    filePath: string
  ): string {
    return sharedGenerateDiff(oldLines, newLines, filePath).diff;
  }

  getEditHistory(): EditorCommand[] {
    return [...this.editHistory];
  }
}
