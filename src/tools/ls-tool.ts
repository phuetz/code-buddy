/**
 * Dedicated directory listing tool.
 * Auto-approved (read-only operation, no bash needed).
 *
 * Provides a cross-platform directory listing without spawning a shell process.
 * Returns formatted output with name, type, size, and modification time.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import type { ToolResult } from '../types/index.js';

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
 * Dedicated LS tool that lists directory contents without requiring bash.
 */
export class LsTool {
  /**
   * List files and directories at the given path.
   *
   * @param directory - Directory path to list (default: current working directory)
   * @returns ToolResult with formatted directory listing
   */
  async execute(directory: string = '.'): Promise<ToolResult> {
    try {
      // Resolve to absolute path
      const resolvedPath = path.resolve(directory);

      // Check existence
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          error: `Path does not exist: ${resolvedPath}`,
        };
      }

      // Check that it is a directory
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: `Path is not a directory: ${resolvedPath}`,
        };
      }

      // Read directory entries
      const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });

      // Collect entry details
      const entries: DirEntry[] = [];
      for (const dirent of dirents) {
        const entryPath = path.join(resolvedPath, dirent.name);
        try {
          const entryStat = await fs.stat(entryPath);
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
