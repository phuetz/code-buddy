import { resolveToolPath, getToolWorkingDirectory } from '../utils/tool-execution-context.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolResult } from '../types/index.js';

const DEFAULT_IGNORES = new Set(['node_modules', '.git', 'dist']);
const EXTENSION_LANGUAGES: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.py': 'Python',
  '.css': 'CSS',
  '.html': 'HTML',
};

export interface ProjectMapInput {
  root: string;
  maxDepth?: number;
}

export interface ProjectMapData {
  root: string;
  tree: string[];
  languages: Record<string, number>;
  entrypoints: string[];
  fileCount: number;
  directoryCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function assertSafeRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error('root must be an absolute path');
  const resolved = path.resolve(getToolWorkingDirectory(), root);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || ['/etc', '/dev', '/proc', '/sys', '/run'].includes(resolved)) {
    throw new Error(`Refusing to inspect unsafe root: ${resolved}`);
  }
  const stat = await fs.lstat(resolveToolPath(resolved));
  if (!stat.isDirectory()) throw new Error(`root is not a directory: ${resolved}`);
  return resolved;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(resolveToolPath(filePath));
    return true;
  } catch {
    return false;
  }
}

async function findEntrypoints(root: string): Promise<string[]> {
  const entrypoints: string[] = [];
  const packagePath = path.join(root, 'package.json');
  if (await exists(packagePath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(resolveToolPath(packagePath), 'utf8')) as { main?: unknown; bin?: unknown };
      if (typeof pkg.main === 'string') entrypoints.push(pkg.main);
      if (typeof pkg.bin === 'string') entrypoints.push(pkg.bin);
      if (isRecord(pkg.bin)) {
        for (const value of Object.values(pkg.bin)) if (typeof value === 'string') entrypoints.push(value);
      }
    } catch {
      // Ignore malformed package.json for map purposes.
    }
  }
  for (const candidate of ['src/index.ts', 'src/index.tsx', 'src/index.js', 'index.ts', 'index.js', 'main.ts', 'main.js']) {
    if (await exists(path.join(root, candidate))) entrypoints.push(candidate);
  }
  return Array.from(new Set(entrypoints)).sort();
}

export class ProjectMapTool {
  readonly name = 'project_map';
  readonly description = 'Summarize a project structure, detected languages, likely entrypoints, and file/directory counts.';

  async execute(input: unknown): Promise<ToolResult> {
    try {
      if (!isRecord(input)) return { success: false, error: 'Input must be an object' };
      if (typeof input.root !== 'string' || input.root.trim() === '') return { success: false, error: 'root must be a non-empty absolute path' };
      const maxDepth = input.maxDepth === undefined ? 3 : Number(input.maxDepth);
      if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 8) return { success: false, error: 'maxDepth must be an integer between 0 and 8' };

      const root = await assertSafeRoot(input.root);
      const tree: string[] = ['.'];
      const languages: Record<string, number> = {};
      let fileCount = 0;
      let directoryCount = 0;

      const walk = async (dir: string, depth: number, prefix: string): Promise<void> => {
        if (depth >= maxDepth) return;
        const entries = (await fs.readdir(resolveToolPath(dir), { withFileTypes: true }))
          .filter((entry) => !DEFAULT_IGNORES.has(entry.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          const relative = path.relative(root, path.join(dir, entry.name));
          const line = `${prefix}${entry.isDirectory() ? '📁' : '📄'} ${relative}`;
          tree.push(line);
          if (entry.isDirectory()) {
            directoryCount += 1;
            await walk(path.join(dir, entry.name), depth + 1, `${prefix}  `);
          } else if (entry.isFile()) {
            fileCount += 1;
            const language = EXTENSION_LANGUAGES[path.extname(entry.name).toLowerCase()] ?? 'Other';
            languages[language] = (languages[language] ?? 0) + 1;
          }
        }
      };

      await walk(root, 0, '');
      const data: ProjectMapData = { root, tree, languages, entrypoints: await findEntrypoints(root), fileCount, directoryCount };
      return { success: true, output: `Mapped ${fileCount} files and ${directoryCount} directories`, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const PROJECT_MAP_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'project_map',
    description: 'Summarize a project tree, languages, likely entrypoints, and file/directory counts.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute project root to inspect' },
        maxDepth: { type: 'number', description: 'Maximum tree depth, default 3, max 8' },
      },
      required: ['root'],
    },
  },
};
