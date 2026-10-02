import { resolveToolPath, getToolWorkingDirectory } from '../utils/tool-execution-context.js';
/**
 * Dedicated directory listing tool.
 * Auto-approved (read-only operation, no bash needed).
 *
 * Provides a cross-platform directory listing without spawning a shell process.
 * Returns formatted output with name, type, size, and modification time.
 * Respects .gitignore patterns by default to reduce noise.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import type { ToolResult } from '../types/index.js';
import { matchGlob } from '../utils/glob-utils.js';

/**
 * Entry representing a single file or directory in the listing.
 */
interface DirEntry {
  name: string;
  type: 'file' | 'dir' | 'symlink';
  size: number;
  modified: Date;
}

/**
 * Format bytes into a human-readable string (e.g. 1.2 KB, 3.4 MB).
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[exponent]}`;
}

/**
 * Format a Date into a short ISO-like string: YYYY-MM-DD HH:MM.
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * Default patterns to always filter out, even without a .gitignore file.
 */
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  '__pycache__',
  '.next',
  '.cache',
  '.DS_Store',
  'Thumbs.db',
];

/**
 * Load .gitignore patterns from the closest .gitignore in or above the directory.
 * Returns an array of glob patterns. Empty array if no .gitignore found.
 */
export function loadGitignorePatterns(directory: string): string[] {
  const patterns: string[] = [];
  let current = path.resolve(getToolWorkingDirectory(), directory);

  // Walk up to find .gitignore files (closest first)
  for (let depth = 0; depth < 20; depth++) {
    const gitignorePath = path.join(current, '.gitignore');
    if (existsSync(resolveToolPath(gitignorePath))) {
      try {
        const content = readFileSync(resolveToolPath(gitignorePath), 'utf-8');
        const lines = content.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        patterns.push(...lines);
      } catch {
        // Ignore read errors
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  return patterns;
}

/**
 * Check if a file/directory name should be ignored based on gitignore patterns.
 */
export function shouldIgnoreEntry(
  name: string,
  isDirectory: boolean,
  patterns: string[],
  relativePath?: string,
): boolean {
  const testPath = relativePath ? `${relativePath}/${name}` : name;
  const testPathDir = isDirectory ? `${testPath}/` : testPath;

  for (const pattern of patterns) {
    // Handle negation patterns (skip them — they unignore)
    if (pattern.startsWith('!')) continue;

    // Strip trailing slash from pattern (indicates directory-only match)
    const cleanPattern = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
    const dirOnlyPattern = pattern.endsWith('/');

    // If pattern is directory-only but entry is a file, skip
    if (dirOnlyPattern && !isDirectory) continue;

    // Simple name match (no path separator in pattern)
    if (!cleanPattern.includes('/')) {
      if (matchGlob(name, cleanPattern)) return true;
      // Also try with directory marker
      if (isDirectory && matchGlob(name, cleanPattern)) return true;
    } else {
      // Path-based pattern
      if (matchGlob(testPath, cleanPattern)) return true;
      if (matchGlob(testPathDir, cleanPattern)) return true;
    }
  }

  return false;
}

/**
 * Dedicated LS tool that lists directory contents without requiring bash.
 */
export class LsTool {
  /**
   * List files and directories at the given path.
   *
   * @param directory - Directory path to list (default: current working directory)
   * @param options - Optional settings for filtering
   * @returns ToolResult with formatted directory listing
   */
  async execute(
    directory: string = '.',
    options?: { respectGitignore?: boolean },
  ): Promise<ToolResult> {
    const respectGitignore = options?.respectGitignore ?? true;

    try {
      // Resolve to absolute path
      const resolvedPath = path.resolve(getToolWorkingDirectory(), directory);

      // Check existence
      if (!existsSync(resolveToolPath(resolvedPath))) {
        return {
          success: false,
          error: `Path does not exist: ${resolvedPath}`,
        };
      }

      // Check that it is a directory
      const stat = await fs.stat(resolveToolPath(resolvedPath));
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: `Path is not a directory: ${resolvedPath}`,
        };
      }

      // Build ignore patterns
      let ignorePatterns: string[] = [];
      if (respectGitignore) {
        ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...loadGitignorePatterns(resolvedPath)];
      }

      // Read directory entries
      const dirents = await fs.readdir(resolveToolPath(resolvedPath), { withFileTypes: true });

      // Collect entry details
      const entries: DirEntry[] = [];
      for (const dirent of dirents) {
        // Filter out ignored entries
        if (respectGitignore) {
          const isDir = dirent.isDirectory();
          if (shouldIgnoreEntry(dirent.name, isDir, ignorePatterns)) {
            continue;
          }
        }

        const entryPath = path.join(resolvedPath, dirent.name);
        try {
          const entryStat = await fs.stat(resolveToolPath(entryPath));
          let type: DirEntry['type'] = 'file';
          if (dirent.isDirectory()) {
            type = 'dir';
          } else if (dirent.isSymbolicLink()) {
            type = 'symlink';
          }
          entries.push({
            name: dirent.name,
            type,
            size: entryStat.size,
            modified: entryStat.mtime,
          });
        } catch {
          // If stat fails (e.g. broken symlink), still include with defaults
          entries.push({
            name: dirent.name,
            type: dirent.isDirectory() ? 'dir' : dirent.isSymbolicLink() ? 'symlink' : 'file',
            size: 0,
            modified: new Date(0),
          });
        }
      }

      // Sort: directories first, then files, alphabetically within each group
      entries.sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });

      // Format as table
      if (entries.length === 0) {
        return {
          success: true,
          output: `Directory: ${resolvedPath}\n(empty)`,
        };
      }

      // Calculate column widths
      const typeCol = 7; // 'symlink' is longest
      const sizeCol = Math.max(4, ...entries.map(e => formatSize(e.size).length));
      const dateCol = 16; // 'YYYY-MM-DD HH:MM'

      const header = `${'Type'.padEnd(typeCol)}  ${'Size'.padStart(sizeCol)}  ${'Modified'.padEnd(dateCol)}  Name`;
      const separator = '-'.repeat(header.length);

      const rows = entries.map(e => {
        const typeStr = e.type === 'dir' ? 'dir/' : e.type === 'symlink' ? 'link@' : 'file';
        const sizeStr = e.type === 'dir' ? '-'.padStart(sizeCol) : formatSize(e.size).padStart(sizeCol);
        const dateStr = formatDate(e.modified);
        const nameStr = e.type === 'dir' ? `${e.name}/` : e.name;
        return `${typeStr.padEnd(typeCol)}  ${sizeStr}  ${dateStr}  ${nameStr}`;
      });

      const output = [
        `Directory: ${resolvedPath}`,
        `${entries.length} entries`,
        '',
        header,
        separator,
        ...rows,
      ].join('\n');

      return {
        success: true,
        output,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Provide user-friendly messages for common errors
      if (message.includes('EACCES') || message.includes('permission denied')) {
        return {
          success: false,
          error: `Permission denied: cannot read directory "${directory}"`,
        };
      }

      return {
        success: false,
        error: `Failed to list directory: ${message}`,
      };
    }
  }
}
