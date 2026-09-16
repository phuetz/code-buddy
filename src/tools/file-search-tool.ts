import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolResult } from '../types/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Launch-folder default: session cwd if the registry passed one, else process.cwd(). */
export function defaultFileSearchCwd(cwd?: string): string {
  const given = typeof cwd === 'string' ? cwd.trim() : '';
  return path.resolve(given || process.cwd());
}

/**
 * Resolve the search root. Omitted / "" / "." → the launch folder.
 * Relative paths resolve against that folder. Never walks up to a git toplevel.
 */
export async function resolveFileSearchRoot(raw: unknown, cwd?: string): Promise<string> {
  const base = defaultFileSearchCwd(cwd);
  const given = typeof raw === 'string' ? raw.trim() : '';
  const candidate = !given || given === '.'
    ? base
    : path.isAbsolute(given)
      ? given
      : path.resolve(base, given);
  const resolved = path.resolve(candidate);
  if (!(await fs.lstat(resolved)).isDirectory()) {
    throw new Error('root is not a directory');
  }
  return resolved;
}

function binary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

async function walk(
  dir: string,
  root: string,
  regex: RegExp,
  max: number,
  out: Array<{ file: string; line: number; excerpt: string }>,
): Promise<void> {
  if (out.length >= max) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (out.length >= max) return;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, root, regex, max, out);
    else if (entry.isFile()) {
      const buf = await fs.readFile(full);
      if (binary(buf)) continue;
      const lines = buf.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && out.length < max; i++) {
        const line = lines[i] ?? '';
        if (regex.test(line)) {
          out.push({ file: path.relative(root, full), line: i + 1, excerpt: line.slice(0, 240) });
        }
      }
    }
  }
}

export class FileSearchTool {
  readonly name = 'file_search';
  readonly description =
    'Search a regex pattern in text files under a root, ignoring node_modules, .git and binary files. Defaults to the current working directory (the folder the process was launched from).';

  async execute(
    input: unknown,
    context?: { cwd?: string },
  ): Promise<ToolResult> {
    try {
      if (!isRecord(input)) return { success: false, error: 'Input must be an object' };
      const root = await resolveFileSearchRoot(input.root, context?.cwd);
      const pattern = String(input.pattern ?? '');
      if (!pattern) return { success: false, error: 'pattern is required' };
      const regex = new RegExp(pattern, typeof input.flags === 'string' ? input.flags : '');
      const maxResults = Math.min(Math.max(Number(input.maxResults) || 50, 1), 500);
      const matches: Array<{ file: string; line: number; excerpt: string }> = [];
      await walk(root, root, regex, maxResults, matches);
      return { success: true, output: `Found ${matches.length} match(es)`, data: { root, pattern, matches } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const FILE_SEARCH_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'file_search',
    description:
      'Regex search in files under a bounded root. If root is omitted, searches process.cwd() (the launch folder), not the git toplevel.',
    parameters: {
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description:
            'Directory to search. Optional; defaults to the current working directory (the folder the process was launched from). Relative paths resolve against that folder.',
        },
        pattern: { type: 'string' },
        flags: { type: 'string' },
        maxResults: { type: 'number' },
      },
      required: ['pattern'],
    },
  },
};
