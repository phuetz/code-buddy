import { diff_match_patch } from 'diff-match-patch';

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
  // Compare line identities instead of advancing both cursors together:
  // inserting one line must not turn the unchanged suffix into a replacement.
  const differ = new diff_match_patch();
  const encoded = differ.diff_linesToChars_(
    oldLines.map(line => line + '\n').join(''),
    newLines.map(line => line + '\n').join(''),
  );
  const differences = differ.diff_main(encoded.chars1, encoded.chars2, false);
  differ.diff_charsToLines_(differences, encoded.lineArray);
  const changes: DiffChange[] = [];
  let oldPosition = 0;
  let newPosition = 0;
  let pending: DiffChange | undefined;
  for (const [operation, text] of differences) {
    const count = text.split('\n').length - 1;
    if (operation === 0) {
      if (pending) changes.push(pending);
      pending = undefined;
      oldPosition += count;
      newPosition += count;
      continue;
    }
    pending ??= { oldStart: oldPosition, oldEnd: oldPosition, newStart: newPosition, newEnd: newPosition };
    if (operation === -1) oldPosition += count;
    else newPosition += count;
    pending.oldEnd = oldPosition;
    pending.newEnd = newPosition;
  }
  if (pending) changes.push(pending);
  return changes;
}

/** Build non-overlapping hunks, counting every context line exactly once. */
function buildHunks(
  oldLines: string[],
  newLines: string[],
  changes: DiffChange[],
  contextLines: number
): DiffHunk[] {
  const context = Math.max(0, Math.floor(contextLines));
  const groups: DiffChange[][] = [];
  for (const change of changes) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous && change.oldStart - previous.oldEnd <= context * 2) group.push(change);
    else groups.push([change]);
  }
  return groups.map(group => {
    const first = group[0]!;
    const last = group.at(-1)!;
    const oldStart = Math.max(0, first.oldStart - context);
    const oldEnd = Math.min(oldLines.length, last.oldEnd + context);
    const newStart = first.newStart - (first.oldStart - oldStart);
    const newEnd = last.newEnd + (oldEnd - last.oldEnd);
    const lines: DiffHunk['lines'] = [];
    let cursor = oldStart;
    for (const change of group) {
      for (const content of oldLines.slice(cursor, change.oldStart)) lines.push({ type: ' ', content });
      for (const content of oldLines.slice(change.oldStart, change.oldEnd)) lines.push({ type: '-', content });
      for (const content of newLines.slice(change.newStart, change.newEnd)) lines.push({ type: '+', content });
      cursor = change.oldEnd;
    }
    for (const content of oldLines.slice(cursor, oldEnd)) lines.push({ type: ' ', content });
    return {
      oldStart: oldStart + (oldEnd > oldStart ? 1 : 0), oldCount: oldEnd - oldStart,
      newStart: newStart + (newEnd > newStart ? 1 : 0), newCount: newEnd - newStart,
      lines,
    };
  });
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

  // A final blank context line still needs its leading space. trim() would
  // remove that line's patch prefix and make the hunk counts invalid.
  return diff;
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
