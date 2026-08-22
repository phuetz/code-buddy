import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolResult } from '../types/index.js';

export interface LintProjectInput {
  root: string;
  timeoutMs?: number;
}

export interface LintProjectFileSummary {
  filePath: string;
  errors: number;
  warnings: number;
  messages: Array<{ ruleId?: string; severity: number; line?: number; column?: number; message: string }>;
}

export interface LintProjectData {
  root: string;
  eslintPath?: string;
  missing: boolean;
  errorCount: number;
  warningCount: number;
  files: LintProjectFileSummary[];
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeRoot(root: string): Promise<string> {
  if (root.includes('\0')) throw new Error('root must not contain null bytes');
  if (!path.isAbsolute(root)) throw new Error('root must be an absolute path');
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || ['/etc', '/dev', '/proc', '/sys', '/run'].includes(resolved)) throw new Error(`Refusing unsafe root: ${resolved}`);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory()) throw new Error(`root is not a directory: ${resolved}`);
  return resolved;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runLocalBinary(file: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const timedOut = Boolean(error && 'killed' in error && error.killed);
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), timedOut });
    });
  });
}

function parseJsonOutput(stdout: string): unknown[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

export class LintProjectTool {
  readonly name = 'lint_project';
  readonly description = 'Run the project-local ESLint binary on a root and summarize JSON errors/warnings by file.';

  async execute(input: unknown): Promise<ToolResult> {
    try {
      if (!isRecord(input)) return { success: false, error: 'Input must be an object' };
      if (typeof input.root !== 'string' || input.root.trim() === '') return { success: false, error: 'root must be a non-empty absolute path' };
      const root = await safeRoot(input.root);
      const eslintPath = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
      if (!(await exists(eslintPath))) {
        const data: LintProjectData = { root, missing: true, errorCount: 0, warningCount: 0, files: [], timedOut: false };
        return { success: true, output: 'ESLint not found at node_modules/.bin/eslint; no-op.', data };
      }

      const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
      const { stdout, stderr, timedOut } = await runLocalBinary(eslintPath, ['.', '--format', 'json'], root, timeoutMs);
      // ESLint reports absolute paths derived from its (canonical) cwd; when the
      // root was given lexically through a symlink (macOS /var → /private/var),
      // relativize against the canonical root too so summaries stay project-relative.
      const rootReal = await fs.realpath(root).catch(() => root);
      const relativize = (filePath: string): string => {
        const rel = path.relative(root, filePath);
        if (!rel) return filePath;
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          const relReal = path.relative(rootReal, filePath);
          if (relReal && !relReal.startsWith('..') && !path.isAbsolute(relReal)) return relReal;
        }
        return rel;
      };
      const reports = parseJsonOutput(stdout);
      const files: LintProjectFileSummary[] = reports.filter(isRecord).map((report) => {
        const messages = Array.isArray(report.messages) ? report.messages.filter(isRecord).map((message) => ({
          ruleId: typeof message.ruleId === 'string' ? message.ruleId : undefined,
          severity: typeof message.severity === 'number' ? message.severity : 0,
          line: typeof message.line === 'number' ? message.line : undefined,
          column: typeof message.column === 'number' ? message.column : undefined,
          message: typeof message.message === 'string' ? message.message : '',
        })) : [];
        return {
          filePath: typeof report.filePath === 'string' ? relativize(report.filePath) : 'unknown',
          errors: typeof report.errorCount === 'number' ? report.errorCount : messages.filter((m) => m.severity === 2).length,
          warnings: typeof report.warningCount === 'number' ? report.warningCount : messages.filter((m) => m.severity === 1).length,
          messages,
        };
      }).filter((file) => file.errors > 0 || file.warnings > 0);
      const errorCount = files.reduce((sum, file) => sum + file.errors, 0);
      const warningCount = files.reduce((sum, file) => sum + file.warnings, 0);
      const data: LintProjectData = { root, eslintPath, missing: false, errorCount, warningCount, files, timedOut };
      const suffix = timedOut ? ' (timed out)' : stderr.trim() ? ` (${stderr.trim().slice(0, 120)})` : '';
      return { success: !timedOut && errorCount === 0, output: `ESLint: ${errorCount} error(s), ${warningCount} warning(s) in ${files.length} file(s)${suffix}`, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const LINT_PROJECT_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'lint_project',
    description: 'Run project-local ESLint and summarize JSON errors/warnings by file. No-ops if ESLint is absent.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute project root to lint' },
        timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds, capped at 120000' },
      },
      required: ['root'],
    },
  },
};
