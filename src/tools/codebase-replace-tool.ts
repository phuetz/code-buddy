/**
 * Codebase-wide Find & Replace Tool
 *
 * Searches across files using ripgrep and applies replacements.
 * Supports text and regex patterns, dry-run preview, and safety limits.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { rgPath } from '@vscode/ripgrep';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

export interface CodebaseReplaceOptions {
  /** File pattern (glob), default all files */
  glob?: string;
  /** Treat searchPattern as regex */
  isRegex?: boolean;
  /** Preview only without modifying files */
  dryRun?: boolean;
  /** Maximum number of files to modify (safety limit), default 50 */
  maxFiles?: number;
}

export interface CodebaseReplaceResult {
  /** Number of files changed */
  filesChanged: number;
  /** Total replacements made */
  totalReplacements: number;
  /** Per-file breakdown */
  changes: { file: string; count: number }[];
  /** Preview text (for dryRun mode) */
  preview?: string;
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Perform a codebase-wide find & replace.
 *
 * @param searchPattern - Text or regex pattern to search for
 * @param replacement - Replacement string ($1, $2 etc. supported for regex)
 * @param options - Configuration options
 * @returns Result with files changed, total replacements, and per-file breakdown
 */
export async function codebaseReplace(
  searchPattern: string,
  replacement: string,
  options: CodebaseReplaceOptions = {}
): Promise<CodebaseReplaceResult> {
  const {
    glob = '**/*',
    isRegex = false,
    dryRun = false,
    maxFiles = 50,
  } = options;

  if (!searchPattern) {
    throw new Error('searchPattern is required');
  }

  // Build ripgrep args to find matching files. Use execFile so patterns,
  // globs, and replacements do not go through cmd.exe / sh quoting.
  const rgArgs: string[] = ['-l', '--no-messages'];

  if (!isRegex) {
    rgArgs.push('-F'); // Fixed string (literal)
  }

  // Add glob filter
  if (glob !== '**/*') {
    rgArgs.push('--glob', glob);
  }

  // Exclude common non-text directories
  rgArgs.push('--glob', '!node_modules');
  rgArgs.push('--glob', '!.git');
  rgArgs.push('--glob', '!dist');
  rgArgs.push('--glob', '!build');
  rgArgs.push('--glob', '!*.min.*');
  rgArgs.push('--glob', '!.codebuddy/screenshots');
  rgArgs.push('--glob', '!.codebuddy/tool-results');
  // Force a path argument so ripgrep searches the working directory instead
  // of waiting on stdin when the process is spawned without a TTY.
  rgArgs.push('--', searchPattern, '.');

  let matchingFiles: string[];
  try {
    const { stdout } = await execFileAsync(rgPath, rgArgs, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    matchingFiles = stdout.trim().split('\n').filter(Boolean);
  } catch (error: unknown) {
    // rg returns exit code 1 when no matches found
    const exitCode = (error as { code?: number }).code;
    if (exitCode === 1) {
      const result: CodebaseReplaceResult = { filesChanged: 0, totalReplacements: 0, changes: [] };
      if (dryRun) {
        result.preview = 'No matches found.';
      }
      return result;
    }
    throw error;
  }

  // Safety check: too many files
  if (matchingFiles.length > maxFiles) {
    throw new Error(
      `Too many files match (${matchingFiles.length} > maxFiles limit of ${maxFiles}). ` +
      `Narrow your search with the glob option or increase maxFiles.`
    );
  }

  const changes: { file: string; count: number }[] = [];
  let totalReplacements = 0;
  const previewLines: string[] = [];

  // Build the regex for replacement
  let regex: RegExp;
  if (isRegex) {
    try {
      regex = new RegExp(searchPattern, 'g');
    } catch (err) {
      throw new Error(`Invalid regex pattern: ${(err as Error).message}`);
    }
  } else {
    // Escape for literal replacement
    const escaped = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, 'g');
  }

  for (const file of matchingFiles) {
    const filePath = path.resolve(process.cwd(), file);

    // Skip binary files
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 5 * 1024 * 1024) {
        logger.debug(`Skipping large file: ${file} (${Math.round(stat.size / 1024)}KB)`);
        continue;
      }
    } catch {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue; // Skip files that can't be read (binary, permissions, etc.)
    }

    // Check if file is binary (contains null bytes)
    if (content.includes('\0')) {
      continue;
    }

    // Count matches
    const matches = content.match(regex);
    if (!matches || matches.length === 0) {
      continue;
    }

    const count = matches.length;

    if (dryRun) {
      // Show preview of changes
      const lines = content.split('\n');
      let previewCount = 0;
      for (let i = 0; i < lines.length && previewCount < 3; i++) {
        if (regex.test(lines[i])) {
          regex.lastIndex = 0; // Reset after test
          const before = lines[i].trim();
          const after = lines[i].replace(regex, replacement).trim();
          previewLines.push(`  ${file}:${i + 1}`);
          previewLines.push(`    - ${before}`);
          previewLines.push(`    + ${after}`);
          previewCount++;
        }
        regex.lastIndex = 0; // Reset for next iteration
      }
      if (count > 3) {
        previewLines.push(`    ... and ${count - 3} more replacements in this file`);
      }
    } else {
      // Actually perform replacement
      const newContent = content.replace(regex, replacement);
      fs.writeFileSync(filePath, newContent, 'utf-8');
    }

    changes.push({ file, count });
    totalReplacements += count;
  }

  const result: CodebaseReplaceResult = {
    filesChanged: changes.length,
    totalReplacements,
    changes,
  };

  if (dryRun) {
    result.preview = previewLines.length > 0
      ? `Dry run preview (${totalReplacements} replacements in ${changes.length} files):\n\n${previewLines.join('\n')}`
      : 'No matches found.';
  }

  logger.info(`Codebase replace: ${totalReplacements} replacements in ${changes.length} files${dryRun ? ' (dry run)' : ''}`, { source: 'CodebaseReplace' });

  return result;
}

/**
 * Format a CodebaseReplaceResult for display.
 */
export function formatReplaceResult(result: CodebaseReplaceResult): string {
  if (result.preview) {
    return result.preview;
  }

  if (result.filesChanged === 0) {
    return 'No matches found.';
  }

  const lines: string[] = [
    `Replaced ${result.totalReplacements} occurrence(s) in ${result.filesChanged} file(s):`,
    '',
  ];

  for (const change of result.changes) {
    lines.push(`  ${change.file}: ${change.count} replacement(s)`);
  }

  return lines.join('\n');
}
