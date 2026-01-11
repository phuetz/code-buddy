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
        const displayLines = totalLines > 10 ? lines.slice(0, 10) : lines;
        const numberedLines = displayLines
          .map((line, idx) => `${idx + 1}: ${line}`)
          .join("\n");
        const additionalLinesMessage =
          totalLines > 10 ? `\n... +${totalLines - 10} lines` : "";

        return {
          success: true,
          output: `Contents of ${filePath}:\n${numberedLines}${additionalLinesMessage}`,
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

  private generateDiff(
    oldLines: string[],
    newLines: string[],
    filePath: string
  ): string {
    const CONTEXT_LINES = 3;
    
    const changes: Array<{
      oldStart: number;
      oldEnd: number;
      newStart: number;
      newEnd: number;
    }> = [];
    
    let i = 0, j = 0;
    
    while (i < oldLines.length || j < newLines.length) {
      while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        i++;
        j++;
      }
      
      if (i < oldLines.length || j < newLines.length) {
        const changeStart = { old: i, new: j };
        
        let oldEnd = i;
        let newEnd = j;
        
        while (oldEnd < oldLines.length || newEnd < newLines.length) {
          let matchFound = false;
          let matchLength = 0;
          
          for (let k = 0; k < Math.min(2, oldLines.length - oldEnd, newLines.length - newEnd); k++) {
            if (oldEnd + k < oldLines.length && 
                newEnd + k < newLines.length && 
                oldLines[oldEnd + k] === newLines[newEnd + k]) {
              matchLength++;
            } else {
              break;
            }
          }
          
          if (matchLength >= 2 || (oldEnd >= oldLines.length && newEnd >= newLines.length)) {
            matchFound = true;
          }
          
          if (matchFound) {
            break;
          }
          
          if (oldEnd < oldLines.length) oldEnd++;
          if (newEnd < newLines.length) newEnd++;
        }
        
        changes.push({
          oldStart: changeStart.old,
          oldEnd: oldEnd,
          newStart: changeStart.new,
          newEnd: newEnd
        });
        
        i = oldEnd;
        j = newEnd;
      }
    }
    
    const hunks: Array<{
      oldStart: number;
      oldCount: number;
      newStart: number;
      newCount: number;
      lines: Array<{ type: '+' | '-' | ' '; content: string }>;
    }> = [];
    
    let accumulatedOffset = 0;
    
    for (let changeIdx = 0; changeIdx < changes.length; changeIdx++) {
      const change = changes[changeIdx];
      
      let contextStart = Math.max(0, change.oldStart - CONTEXT_LINES);
      let contextEnd = Math.min(oldLines.length, change.oldEnd + CONTEXT_LINES);
      
      if (hunks.length > 0) {
        const lastHunk = hunks[hunks.length - 1];
        const lastHunkEnd = lastHunk.oldStart + lastHunk.oldCount;
        
        if (lastHunkEnd >= contextStart) {
          const oldHunkEnd = lastHunk.oldStart + lastHunk.oldCount;
          const newContextEnd = Math.min(oldLines.length, change.oldEnd + CONTEXT_LINES);
          
          for (let idx = oldHunkEnd; idx < change.oldStart; idx++) {
            lastHunk.lines.push({ type: ' ', content: oldLines[idx] });
          }
          
          for (let idx = change.oldStart; idx < change.oldEnd; idx++) {
            lastHunk.lines.push({ type: '-', content: oldLines[idx] });
          }
          for (let idx = change.newStart; idx < change.newEnd; idx++) {
            lastHunk.lines.push({ type: '+', content: newLines[idx] });
          }
          
          for (let idx = change.oldEnd; idx < newContextEnd && idx < oldLines.length; idx++) {
            lastHunk.lines.push({ type: ' ', content: oldLines[idx] });
          }
          
          lastHunk.oldCount = newContextEnd - lastHunk.oldStart;
          lastHunk.newCount = lastHunk.oldCount + (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart);
          
          continue;
        }
      }
      
      const hunk: typeof hunks[0] = {
        oldStart: contextStart + 1,
        oldCount: contextEnd - contextStart,
        newStart: contextStart + 1 + accumulatedOffset,
        newCount: contextEnd - contextStart + (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart),
        lines: []
      };
      
      for (let idx = contextStart; idx < change.oldStart; idx++) {
        hunk.lines.push({ type: ' ', content: oldLines[idx] });
      }
      
      for (let idx = change.oldStart; idx < change.oldEnd; idx++) {
        hunk.lines.push({ type: '-', content: oldLines[idx] });
      }
      
      for (let idx = change.newStart; idx < change.newEnd; idx++) {
        hunk.lines.push({ type: '+', content: newLines[idx] });
      }
      
      for (let idx = change.oldEnd; idx < contextEnd && idx < oldLines.length; idx++) {
        hunk.lines.push({ type: ' ', content: oldLines[idx] });
      }
      
      hunks.push(hunk);
      
      accumulatedOffset += (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart);
    }
    
    let addedLines = 0;
    let removedLines = 0;
    
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === '+') addedLines++;
        if (line.type === '-') removedLines++;
      }
    }
    
    let summary = `Updated ${filePath}`;
    if (addedLines > 0 && removedLines > 0) {
      summary += ` with ${addedLines} addition${
        addedLines !== 1 ? "s" : ""
      } and ${removedLines} removal${removedLines !== 1 ? "s" : ""}`;
    } else if (addedLines > 0) {
      summary += ` with ${addedLines} addition${addedLines !== 1 ? "s" : ""}`;
    } else if (removedLines > 0) {
      summary += ` with ${removedLines} removal${
        removedLines !== 1 ? "s" : ""
      }`;
    } else if (changes.length === 0) {
      return `No changes in ${filePath}`;
    }
    
    let diff = summary + "\n";
    diff += `--- a/${filePath}\n`;
    diff += `+++ b/${filePath}\n`;
    
    for (const hunk of hunks) {
      diff += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n`;
      
      for (const line of hunk.lines) {
        diff += `${line.type}${line.content}\n`;
      }
    }
    
    return diff.trim();
  }

  getEditHistory(): EditorCommand[] {
    return [...this.editHistory];
  }
}
