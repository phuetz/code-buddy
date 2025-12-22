/**
 * Unified Diff Editor - Aider-inspired code editing system
 *
 * Based on research from Aider's unified diff format:
 * - 3X better edit quality than search/replace
 * - NO line numbers (LLMs fail at them consistently)
 * - Treats each hunk as a search/replace operation
 * - Flexible matching with normalization
 *
 * Key insight from Aider: Line numbers are unreliable because:
 * 1. LLMs hallucinate line numbers
 * 2. Context shifts invalidate line numbers
 * 3. Users can't easily verify line numbers
 */

import { promises as fsPromises } from 'fs';
import * as path from 'path';

// Types for unified diff operations
export interface DiffHunk {
  searchText: string;      // Context to find (NO line numbers!)
  replaceText: string;     // Replacement content
  contextBefore?: string;  // Optional context before for disambiguation
  contextAfter?: string;   // Optional context after for disambiguation
}

export interface DiffOperation {
  filePath: string;
  hunks: DiffHunk[];
  createIfMissing?: boolean;
}

export interface DiffResult {
  success: boolean;
  filePath: string;
  hunksApplied: number;
  hunksFailed: number;
  errors: string[];
  diff?: string;
  backup?: string;
}

export interface MatchResult {
  found: boolean;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  confidence: number;
}

/**
 * Unified Diff Editor class
 * Applies edits using search/replace patterns without line numbers
 */
export class UnifiedDiffEditor {
  private backupDir: string;
  private enableBackups: boolean;
  private fuzzyMatchThreshold: number;

  constructor(options: {
    backupDir?: string;
    enableBackups?: boolean;
    fuzzyMatchThreshold?: number;
  } = {}) {
    this.backupDir = options.backupDir || '.codebuddy/backups';
    this.enableBackups = options.enableBackups ?? true;
    this.fuzzyMatchThreshold = options.fuzzyMatchThreshold ?? 0.8;
  }

  /**
   * Apply a diff operation to a file
   */
  async applyDiff(operation: DiffOperation): Promise<DiffResult> {
    const result: DiffResult = {
      success: false,
      filePath: operation.filePath,
      hunksApplied: 0,
      hunksFailed: 0,
      errors: [],
    };

    try {
      // Read or create file
      let content: string;
      const absolutePath = path.resolve(operation.filePath);

      const exists = await fsPromises.access(absolutePath).then(() => true).catch(() => false);
      if (exists) {
        content = await fsPromises.readFile(absolutePath, 'utf-8');
      } else if (operation.createIfMissing) {
        content = '';
      } else {
        result.errors.push(`File not found: ${operation.filePath}`);
        return result;
      }

      // Create backup if enabled
      if (this.enableBackups && content) {
        result.backup = await this.createBackup(absolutePath, content);
      }

      const originalContent = content;

      // Apply each hunk
      for (const hunk of operation.hunks) {
        const hunkResult = this.applyHunk(content, hunk);

        if (hunkResult.success) {
          content = hunkResult.newContent;
          result.hunksApplied++;
        } else {
          result.hunksFailed++;
          result.errors.push(hunkResult.error || 'Unknown error applying hunk');
        }
      }

      // Write the result
      if (result.hunksApplied > 0) {
        await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
        await fsPromises.writeFile(absolutePath, content, 'utf-8');
        result.success = true;

        // Generate diff for display
        result.diff = this.generateDiff(originalContent, content, operation.filePath);
      }

    } catch (error) {
      result.errors.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Apply a single hunk to content
   */
  private applyHunk(content: string, hunk: DiffHunk): {
    success: boolean;
    newContent: string;
    error?: string;
  } {
    // Try exact match first
    let match = this.findExactMatch(content, hunk);

    // If exact match fails, try fuzzy matching
    if (!match.found) {
      match = this.findFuzzyMatch(content, hunk);
    }

    // If still no match, try with normalization
    if (!match.found) {
      match = this.findNormalizedMatch(content, hunk);
    }

    if (!match.found) {
      return {
        success: false,
        newContent: content,
        error: `Could not find match for: "${this.truncate(hunk.searchText, 50)}"`,
      };
    }

    // Apply the replacement
    const before = content.substring(0, match.startIndex);
    const after = content.substring(match.endIndex);
    const newContent = before + hunk.replaceText + after;

    return {
      success: true,
      newContent,
    };
  }

  /**
   * Find exact match for search text
   */
  private findExactMatch(content: string, hunk: DiffHunk): MatchResult {
    const searchText = hunk.searchText;
    const index = content.indexOf(searchText);

    if (index === -1) {
      return { found: false, startIndex: -1, endIndex: -1, matchedText: '', confidence: 0 };
    }

    // Verify with context if provided
    if (hunk.contextBefore) {
      const beforeIndex = content.lastIndexOf(hunk.contextBefore, index);
      if (beforeIndex === -1 || index - beforeIndex > hunk.contextBefore.length + 100) {
        return { found: false, startIndex: -1, endIndex: -1, matchedText: '', confidence: 0 };
      }
    }

    if (hunk.contextAfter) {
      const afterEnd = index + searchText.length;
      const afterIndex = content.indexOf(hunk.contextAfter, afterEnd);
      if (afterIndex === -1 || afterIndex - afterEnd > 100) {
        return { found: false, startIndex: -1, endIndex: -1, matchedText: '', confidence: 0 };
      }
    }

    return {
      found: true,
      startIndex: index,
      endIndex: index + searchText.length,
      matchedText: searchText,
      confidence: 1.0,
    };
  }

  /**
   * Find fuzzy match using line-by-line comparison
   */
  private findFuzzyMatch(content: string, hunk: DiffHunk): MatchResult {
    const searchLines = hunk.searchText.split('\n');
    const contentLines = content.split('\n');

    // Try to find the first line
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      const similarity = this.calculateSimilarity(
        contentLines.slice(i, i + searchLines.length).join('\n'),
        hunk.searchText
      );

      if (similarity >= this.fuzzyMatchThreshold) {
        // Calculate character positions
        const startIndex = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        const matchedText = contentLines.slice(i, i + searchLines.length).join('\n');
        const endIndex = startIndex + matchedText.length;

        return {
          found: true,
          startIndex,
          endIndex,
          matchedText,
          confidence: similarity,
        };
      }
    }

    return { found: false, startIndex: -1, endIndex: -1, matchedText: '', confidence: 0 };
  }

  /**
   * Find match with whitespace normalization
   */
  private findNormalizedMatch(content: string, hunk: DiffHunk): MatchResult {
    const normalizedSearch = this.normalizeWhitespace(hunk.searchText);
    const normalizedContent = this.normalizeWhitespace(content);

    const index = normalizedContent.indexOf(normalizedSearch);
    if (index === -1) {
      return { found: false, startIndex: -1, endIndex: -1, matchedText: '', confidence: 0 };
    }

    // Map back to original positions
    const originalStart = this.mapNormalizedPosition(content, normalizedContent, index);
    const originalEnd = this.mapNormalizedPosition(
      content,
      normalizedContent,
      index + normalizedSearch.length
    );

    return {
      found: true,
      startIndex: originalStart,
      endIndex: originalEnd,
      matchedText: content.substring(originalStart, originalEnd),
      confidence: 0.9, // Slightly lower confidence for normalized matches
    };
  }

  /**
   * Normalize whitespace for matching
   */
  private normalizeWhitespace(text: string): string {
    return text
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      .replace(/\n+/g, '\n')
      .trim();
  }

  /**
   * Map position from normalized text back to original
   */
  private mapNormalizedPosition(original: string, normalized: string, normalizedPos: number): number {
    let origPos = 0;
    let normPos = 0;
    const normalizedChars = normalized.split('');

    while (normPos < normalizedPos && origPos < original.length) {
      const origChar = original[origPos];
      const normChar = normalizedChars[normPos];

      if (origChar === normChar) {
        origPos++;
        normPos++;
      } else if (/\s/.test(origChar)) {
        origPos++; // Skip whitespace in original
      } else {
        normPos++; // Skip in normalized
      }
    }

    return origPos;
  }

  /**
   * Calculate similarity between two strings (0-1)
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0;

    // Use Levenshtein-like approach but optimized for code
    const aLines = a.split('\n').map(l => l.trim());
    const bLines = b.split('\n').map(l => l.trim());

    let matches = 0;
    const used = new Set<number>();

    for (const aLine of aLines) {
      for (let i = 0; i < bLines.length; i++) {
        if (!used.has(i) && aLine === bLines[i]) {
          matches++;
          used.add(i);
          break;
        }
      }
    }

    return (matches * 2) / (aLines.length + bLines.length);
  }

  /**
   * Create a backup of the original file
   */
  private async createBackup(filePath: string, content: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = path.basename(filePath);
    const backupPath = path.join(this.backupDir, `${fileName}.${timestamp}.bak`);

    await fsPromises.mkdir(this.backupDir, { recursive: true });
    await fsPromises.writeFile(backupPath, content, 'utf-8');

    return backupPath;
  }

  /**
   * Generate unified diff for display
   */
  private generateDiff(oldContent: string, newContent: string, filePath: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let diff = `--- a/${filePath}\n+++ b/${filePath}\n`;

    // Simple diff implementation
    const maxLen = Math.max(oldLines.length, newLines.length);
    let hunks: string[] = [];
    let currentHunk: string[] = [];
    let hunkStart = -1;

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine !== newLine) {
        if (hunkStart === -1) {
          hunkStart = i;
          // Add context before
          for (let j = Math.max(0, i - 3); j < i; j++) {
            currentHunk.push(` ${oldLines[j] || ''}`);
          }
        }

        if (oldLine !== undefined) {
          currentHunk.push(`-${oldLine}`);
        }
        if (newLine !== undefined) {
          currentHunk.push(`+${newLine}`);
        }
      } else if (hunkStart !== -1) {
        // Add context after
        currentHunk.push(` ${oldLine || ''}`);

        if (currentHunk.filter(l => l.startsWith(' ')).length >= 3) {
          // Finish hunk
          hunks.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@\n${currentHunk.join('\n')}`);
          currentHunk = [];
          hunkStart = -1;
        }
      }
    }

    // Finish last hunk
    if (currentHunk.length > 0) {
      hunks.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@\n${currentHunk.join('\n')}`);
    }

    return diff + hunks.join('\n');
  }

  /**
   * Truncate string for display
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Parse a unified diff string into operations
   */
  static parseDiff(diffString: string): DiffOperation[] {
    const operations: DiffOperation[] = [];
    const fileRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
    const hunkRegex = /^@@[^@]+@@\n([\s\S]*?)(?=^@@|^diff|$)/gm;

    let match;
    while ((match = fileRegex.exec(diffString)) !== null) {
      const filePath = match[2];
      const hunks: DiffHunk[] = [];

      // Find hunks for this file
      const fileContent = diffString.substring(match.index);
      let hunkMatch;
      while ((hunkMatch = hunkRegex.exec(fileContent)) !== null) {
        const hunkContent = hunkMatch[1];
        const { searchText, replaceText } = this.parseHunkContent(hunkContent);

        if (searchText || replaceText) {
          hunks.push({ searchText, replaceText });
        }
      }

      if (hunks.length > 0) {
        operations.push({ filePath, hunks });
      }
    }

    return operations;
  }

  /**
   * Parse hunk content into search/replace texts
   */
  private static parseHunkContent(content: string): { searchText: string; replaceText: string } {
    const lines = content.split('\n');
    const searchLines: string[] = [];
    const replaceLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('-')) {
        searchLines.push(line.substring(1));
      } else if (line.startsWith('+')) {
        replaceLines.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Context line - add to both
        searchLines.push(line.substring(1));
        replaceLines.push(line.substring(1));
      }
    }

    return {
      searchText: searchLines.join('\n'),
      replaceText: replaceLines.join('\n'),
    };
  }

  /**
   * Restore from backup
   */
  async restoreBackup(backupPath: string, originalPath: string): Promise<boolean> {
    try {
      const exists = await fsPromises.access(backupPath).then(() => true).catch(() => false);
      if (!exists) {
        return false;
      }

      const content = await fsPromises.readFile(backupPath, 'utf-8');
      await fsPromises.writeFile(originalPath, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available backups for a file
   */
  async listBackups(filePath: string): Promise<string[]> {
    const fileName = path.basename(filePath);
    const pattern = new RegExp(`^${fileName}\\..*\\.bak$`);

    try {
      const exists = await fsPromises.access(this.backupDir).then(() => true).catch(() => false);
      if (!exists) {
        return [];
      }

      const files = await fsPromises.readdir(this.backupDir);
      return files
        .filter(f => pattern.test(f))
        .map(f => path.join(this.backupDir, f))
        .sort()
        .reverse(); // Most recent first
    } catch {
      return [];
    }
  }
}

// Singleton instance
let editorInstance: UnifiedDiffEditor | null = null;

export function getUnifiedDiffEditor(options?: {
  backupDir?: string;
  enableBackups?: boolean;
  fuzzyMatchThreshold?: number;
}): UnifiedDiffEditor {
  if (!editorInstance) {
    editorInstance = new UnifiedDiffEditor(options);
  }
  return editorInstance;
}

export function resetUnifiedDiffEditor(): void {
  editorInstance = null;
}
