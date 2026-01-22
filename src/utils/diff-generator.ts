/**
 * Shared diff generation utility
 *
 * This module provides a unified diff generation algorithm used across
 * multiple editor tools (text-editor, morph-editor, unified-diff-editor).
 *
 * The algorithm produces unified diff format with context lines,
 * suitable for display and review.
 */

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: Array<{ type: '+' | '-' | ' '; content: string }>;
}

export interface DiffChange {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

export interface DiffResult {
  summary: string;
  diff: string;
  addedLines: number;
  removedLines: number;
  hunks: DiffHunk[];
}

export interface DiffOptions {
  /** Number of context lines around changes (default: 3) */
  contextLines?: number;
  /** Custom summary prefix (default: "Updated") */
  summaryPrefix?: string;
  /** Include file path in summary (default: true) */
  includeFilePath?: boolean;
}

const DEFAULT_OPTIONS: Required<DiffOptions> = {
  contextLines: 3,
  summaryPrefix: 'Updated',
  includeFilePath: true,
};

/**
 * Find all change regions between old and new content
 */
function findChanges(oldLines: string[], newLines: string[]): DiffChange[] {
  const changes: DiffChange[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // Skip matching lines
    while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    }

    if (i < oldLines.length || j < newLines.length) {
      const changeStart = { old: i, new: j };

      let oldEnd = i;
      let newEnd = j;

      // Find the end of this change block
      while (oldEnd < oldLines.length || newEnd < newLines.length) {
        let matchFound = false;
        let matchLength = 0;

        // Look for matching lines to end the change block
        for (let k = 0; k < Math.min(2, oldLines.length - oldEnd, newLines.length - newEnd); k++) {
          if (
            oldEnd + k < oldLines.length &&
            newEnd + k < newLines.length &&
            oldLines[oldEnd + k] === newLines[newEnd + k]
          ) {
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
        newEnd: newEnd,
      });

      i = oldEnd;
      j = newEnd;
    }
  }

  return changes;
}

/**
 * Build hunks from changes with context
 */
function buildHunks(
  oldLines: string[],
  newLines: string[],
  changes: DiffChange[],
  contextLines: number
): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let accumulatedOffset = 0;

  for (const change of changes) {
    const contextStart = Math.max(0, change.oldStart - contextLines);
    const contextEnd = Math.min(oldLines.length, change.oldEnd + contextLines);

    // Try to merge with previous hunk if they overlap
    if (hunks.length > 0) {
      const lastHunk = hunks[hunks.length - 1];
      const lastHunkEnd = lastHunk.oldStart + lastHunk.oldCount;

      if (lastHunkEnd >= contextStart) {
        // Merge with previous hunk
        const oldHunkEnd = lastHunk.oldStart + lastHunk.oldCount;
        const newContextEnd = Math.min(oldLines.length, change.oldEnd + contextLines);

        // Add context between previous change and current
        for (let idx = oldHunkEnd; idx < change.oldStart; idx++) {
          lastHunk.lines.push({ type: ' ', content: oldLines[idx] });
        }

        // Add removed lines
        for (let idx = change.oldStart; idx < change.oldEnd; idx++) {
          lastHunk.lines.push({ type: '-', content: oldLines[idx] });
        }

        // Add added lines
        for (let idx = change.newStart; idx < change.newEnd; idx++) {
          lastHunk.lines.push({ type: '+', content: newLines[idx] });
        }

        // Add trailing context
        for (let idx = change.oldEnd; idx < newContextEnd && idx < oldLines.length; idx++) {
          lastHunk.lines.push({ type: ' ', content: oldLines[idx] });
        }

        lastHunk.oldCount = newContextEnd - lastHunk.oldStart;
        lastHunk.newCount =
          lastHunk.oldCount + (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart);

        continue;
      }
    }

    // Create new hunk
    const hunk: DiffHunk = {
      oldStart: contextStart + 1,
      oldCount: contextEnd - contextStart,
      newStart: contextStart + 1 + accumulatedOffset,
      newCount:
        contextEnd - contextStart + (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart),
      lines: [],
    };

    // Add leading context
    for (let idx = contextStart; idx < change.oldStart; idx++) {
      hunk.lines.push({ type: ' ', content: oldLines[idx] });
    }

    // Add removed lines
    for (let idx = change.oldStart; idx < change.oldEnd; idx++) {
      hunk.lines.push({ type: '-', content: oldLines[idx] });
    }

    // Add added lines
    for (let idx = change.newStart; idx < change.newEnd; idx++) {
      hunk.lines.push({ type: '+', content: newLines[idx] });
    }

    // Add trailing context
    for (let idx = change.oldEnd; idx < contextEnd && idx < oldLines.length; idx++) {
      hunk.lines.push({ type: ' ', content: oldLines[idx] });
    }

    hunks.push(hunk);
    accumulatedOffset += (change.newEnd - change.newStart) - (change.oldEnd - change.oldStart);
  }

  return hunks;
}

/**
 * Count added and removed lines from hunks
 */
function countChanges(hunks: DiffHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === '+') added++;
      if (line.type === '-') removed++;
    }
  }

  return { added, removed };
}

/**
 * Format the summary line
 */
function formatSummary(
  filePath: string,
  addedLines: number,
  removedLines: number,
  options: Required<DiffOptions>
): string {
  let summary = options.includeFilePath
    ? `${options.summaryPrefix} ${filePath}`
    : options.summaryPrefix;

  if (addedLines > 0 && removedLines > 0) {
    summary += ` with ${addedLines} addition${addedLines !== 1 ? 's' : ''} and ${removedLines} removal${removedLines !== 1 ? 's' : ''}`;
  } else if (addedLines > 0) {
    summary += ` with ${addedLines} addition${addedLines !== 1 ? 's' : ''}`;
  } else if (removedLines > 0) {
    summary += ` with ${removedLines} removal${removedLines !== 1 ? 's' : ''}`;
  }

  return summary;
}

/**
 * Format hunks into unified diff format
 */
function formatDiff(hunks: DiffHunk[], filePath: string, summary: string): string {
  let diff = summary + '\n';
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

/**
 * Generate a unified diff between old and new content
 *
 * @param oldLines - Array of lines from the original content
 * @param newLines - Array of lines from the new content
 * @param filePath - File path for the diff header
 * @param options - Optional configuration
 * @returns DiffResult with formatted diff and statistics
 *
 * @example
 * ```typescript
 * const oldContent = 'hello\nworld';
 * const newContent = 'hello\nnew world';
 * const result = generateDiff(
 *   oldContent.split('\n'),
 *   newContent.split('\n'),
 *   'example.txt'
 * );
 * console.log(result.diff);
 * ```
 */
export function generateDiff(
  oldLines: string[],
  newLines: string[],
  filePath: string,
  options: DiffOptions = {}
): DiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Find all changes
  const changes = findChanges(oldLines, newLines);

  // No changes
  if (changes.length === 0) {
    return {
      summary: `No changes in ${filePath}`,
      diff: `No changes in ${filePath}`,
      addedLines: 0,
      removedLines: 0,
      hunks: [],
    };
  }

  // Build hunks with context
  const hunks = buildHunks(oldLines, newLines, changes, opts.contextLines);

  // Count changes
  const { added: addedLines, removed: removedLines } = countChanges(hunks);

  // Format output
  const summary = formatSummary(filePath, addedLines, removedLines, opts);
  const diff = formatDiff(hunks, filePath, summary);

  return {
    summary,
    diff,
    addedLines,
    removedLines,
    hunks,
  };
}

/**
 * Generate diff from string content (convenience wrapper)
 *
 * @param oldContent - Original content as string
 * @param newContent - New content as string
 * @param filePath - File path for the diff header
 * @param options - Optional configuration
 * @returns Formatted diff string
 */
export function generateDiffFromStrings(
  oldContent: string,
  newContent: string,
  filePath: string,
  options: DiffOptions = {}
): string {
  const result = generateDiff(
    oldContent.split('\n'),
    newContent.split('\n'),
    filePath,
    options
  );
  return result.diff;
}

/**
 * Generate a creation diff (for new files)
 *
 * @param content - New file content
 * @param filePath - File path
 * @returns Formatted diff string
 */
export function generateCreationDiff(content: string, filePath: string): string {
  const lines = content.split('\n');
  const diffContent = [
    `Created ${filePath}`,
    `--- /dev/null`,
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join('\n');

  return diffContent;
}

/**
 * Generate a deletion diff (for removed files)
 *
 * @param content - Deleted file content
 * @param filePath - File path
 * @returns Formatted diff string
 */
export function generateDeletionDiff(content: string, filePath: string): string {
  const lines = content.split('\n');
  const diffContent = [
    `Deleted ${filePath}`,
    `--- a/${filePath}`,
    `+++ /dev/null`,
    `@@ -1,${lines.length} +0,0 @@`,
    ...lines.map((line) => `-${line}`),
  ].join('\n');

  return diffContent;
}
