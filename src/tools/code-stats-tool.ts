import { resolveToolPath, getToolWorkingDirectory } from '../utils/tool-execution-context.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { checkSecretFileAccess } from '../security/secret-files.js';
import type { ToolResult } from '../types/index.js';

const IGNORE = new Set(['node_modules', '.git', 'dist']);
const LANGUAGE_BY_EXT: Record<string, string> = { '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.py': 'Python', '.md': 'Markdown', '.css': 'CSS', '.html': 'HTML', '.json': 'JSON' };
const COMMENT_PREFIXES: Record<string, string[]> = { '.ts': ['//'], '.tsx': ['//'], '.js': ['//'], '.jsx': ['//'], '.py': ['#'], '.css': ['/*', '*'], '.html': ['<!--'] };

export interface CodeStatsData { root: string; fileCount: number; totalLines: number; byLanguage: Record<string, { files: number; lines: number; commentLines: number }>; largestFiles: Array<{ file: string; lines: number }>; commentRatio: number; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
async function assertRoot(root: string): Promise<string> { if (!path.isAbsolute(root)) throw new Error('root must be an absolute path'); const resolved = path.resolve(getToolWorkingDirectory(), root); if ([path.parse(resolved).root, '/etc', '/dev', '/proc', '/sys', '/run'].includes(resolved)) throw new Error(`Refusing unsafe root: ${resolved}`); if (!(await fs.lstat(resolveToolPath(resolved))).isDirectory()) throw new Error(`root is not a directory: ${resolved}`); return resolved; }
function isBinary(buffer: Buffer): boolean { return buffer.subarray(0, 1024).includes(0); }
function normalizeExtensions(input: unknown): Set<string> | undefined { if (input === undefined) return undefined; if (!Array.isArray(input) || input.some((item) => typeof item !== 'string')) throw new Error('extensions must be an array of strings'); return new Set(input.map((item) => item.startsWith('.') ? item.toLowerCase() : `.${item.toLowerCase()}`)); }

export class CodeStatsTool {
  readonly name = 'code_stats';
  readonly description = 'Compute code line statistics, largest files, and a simple comment ratio for a project folder.';
  async execute(input: unknown): Promise<ToolResult> {
    try {
      if (!isRecord(input)) return { success: false, error: 'Input must be an object' };
      if (typeof input.root !== 'string' || input.root.trim() === '') return { success: false, error: 'root must be a non-empty absolute path' };
      const root = await assertRoot(input.root); const allowed = normalizeExtensions(input.extensions);
      const byLanguage: CodeStatsData['byLanguage'] = {}; const largestFiles: Array<{ file: string; lines: number }> = [];
      let fileCount = 0, totalLines = 0, totalCommentLines = 0;
      const walk = async (dir: string): Promise<void> => { for (const entry of await fs.readdir(resolveToolPath(dir), { withFileTypes: true })) { if (IGNORE.has(entry.name)) continue; const abs = path.join(dir, entry.name); if (entry.isDirectory()) { await walk(abs); continue; } if (!entry.isFile()) continue; const ext = path.extname(entry.name).toLowerCase(); if (allowed && !allowed.has(ext)) continue; if (checkSecretFileAccess(abs, 'read').secret) continue; const buf = await fs.readFile(resolveToolPath(abs)); if (isBinary(buf)) continue; const text = buf.toString('utf8'); const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length; const prefixes = COMMENT_PREFIXES[ext] ?? []; const commentLines = text.split(/\r?\n/).filter((line) => prefixes.some((prefix) => line.trimStart().startsWith(prefix))).length; const language = LANGUAGE_BY_EXT[ext] ?? 'Other'; byLanguage[language] ??= { files: 0, lines: 0, commentLines: 0 }; byLanguage[language].files += 1; byLanguage[language].lines += lines; byLanguage[language].commentLines += commentLines; fileCount += 1; totalLines += lines; totalCommentLines += commentLines; largestFiles.push({ file: path.relative(root, abs), lines }); } };
      await walk(root); largestFiles.sort((a, b) => b.lines - a.lines);
      const data: CodeStatsData = { root, fileCount, totalLines, byLanguage, largestFiles: largestFiles.slice(0, 10), commentRatio: totalLines === 0 ? 0 : totalCommentLines / totalLines };
      return { success: true, output: `Counted ${totalLines} lines across ${fileCount} files`, data };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}
export const CODE_STATS_TOOL_DEFINITION = { type: 'function' as const, function: { name: 'code_stats', description: 'Compute code statistics for a directory.', parameters: { type: 'object', properties: { root: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } } }, required: ['root'] } } };
