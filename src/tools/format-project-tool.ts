import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolResult } from '../types/index.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
async function safeRoot(root: string): Promise<string> { if (!path.isAbsolute(root)) throw new Error('root must be an absolute path'); const resolved = path.resolve(root); if (resolved === path.parse(resolved).root || ['/etc', '/dev', '/proc', '/sys', '/run'].includes(resolved)) throw new Error(`Refusing unsafe root: ${resolved}`); if (!(await fs.lstat(resolved)).isDirectory()) throw new Error(`root is not a directory: ${resolved}`); return resolved; }
async function exists(filePath: string): Promise<boolean> { try { await fs.access(filePath); return true; } catch { return false; } }
// npm's Windows shims under node_modules/.bin are `.cmd` batch files: they only run through cmd.exe (Node refuses to spawn them directly), and the path must be quoted so a workspace under "Program Files" still resolves. Args stay fixed (`--check`/`--write`, `.`).
function localBinary(file: string): { file: string; shell: boolean } { return process.platform === 'win32' ? { file: `"${file}"`, shell: true } : { file, shell: false }; }
function run(file: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean }> { const bin = localBinary(file); return new Promise((resolve) => execFile(bin.file, args, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, shell: bin.shell }, (error, stdout, stderr) => resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: error ? 1 : 0, timedOut: Boolean(error && 'killed' in error && error.killed) }))); }

export class FormatProjectTool {
  readonly name = 'format_project';
  readonly description = 'Run project-local Prettier in --check mode by default, or --write when explicitly requested.';
  async execute(input: unknown): Promise<ToolResult> {
    try {
      if (!isRecord(input)) return { success: false, error: 'Input must be an object' };
      const root = await safeRoot(String(input.root ?? ''));
      const prettierPath = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier');
      if (!(await exists(prettierPath))) return { success: true, output: 'Prettier not found at node_modules/.bin/prettier; no-op.', data: { root, missing: true, files: [] } };
      const write = input.write === true;
      const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
      const result = await run(prettierPath, [write ? '--write' : '--check', '.'], root, timeoutMs);
      const files = [...result.stdout.split(/\r?\n/), ...result.stderr.split(/\r?\n/)].map((line) => line.trim()).filter((line) => line && !line.startsWith('Checking formatting') && !line.startsWith('All matched') && !line.startsWith('[warn] Code style issues')).map((line) => line.replace(/^\[warn\]\s*/, ''));
      return { success: !result.timedOut && result.code === 0, output: `Prettier ${write ? 'write' : 'check'}: ${files.length} file(s) reported${result.timedOut ? ' (timed out)' : ''}`, data: { root, missing: false, write, files, timedOut: result.timedOut } };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}
export const FORMAT_PROJECT_TOOL_DEFINITION = { type: 'function' as const, function: { name: 'format_project', description: 'Run project-local Prettier --check or explicit --write.', parameters: { type: 'object', properties: { root: { type: 'string' }, write: { type: 'boolean' }, timeoutMs: { type: 'number' } }, required: ['root'] } } };
