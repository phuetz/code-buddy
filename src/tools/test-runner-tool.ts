import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolResult } from '../types/index.js';

export interface TestRunnerData {
  root: string;
  runner: 'vitest' | 'jest' | 'unknown';
  exitCode: number | null;
  passed: number;
  failed: number;
  durationMs: number;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error('root must be an absolute path');
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || ['/etc', '/dev', '/proc', '/sys', '/run'].includes(resolved)) throw new Error(`Refusing unsafe root: ${resolved}`);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory()) throw new Error(`root is not a directory: ${resolved}`);
  return resolved;
}

function tail(text: string, max = 4000): string {
  return text.length <= max ? text : text.slice(-max);
}

function runNpmTest(cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile('npm', ['run', 'test'], { cwd, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
      const timedOut = Boolean(error && 'killed' in error && error.killed);
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), exitCode: code, timedOut, durationMs: Date.now() - started });
    });
  });
}

function detectRunner(pkg: Record<string, unknown>): 'vitest' | 'jest' | 'unknown' {
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  const test = typeof scripts.test === 'string' ? scripts.test : '';
  if (/\bvitest\b/.test(test)) return 'vitest';
  if (/\bjest\b/.test(test)) return 'jest';
  return 'unknown';
}

function parseCounts(output: string): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const failedMatch = output.match(/(?:Tests?|Test Files)\s+([0-9]+)\s+failed/i) ?? output.match(/([0-9]+)\s+failed/i) ?? output.match(/([0-9]+)\s+failing/i);
  const passedMatch = output.match(/(?:Tests?|Test Files)\s+([0-9]+)\s+passed/i) ?? output.match(/([0-9]+)\s+passed/i) ?? output.match(/([0-9]+)\s+passing/i);
  if (failedMatch?.[1]) failed = Number(failedMatch[1]);
  if (passedMatch?.[1]) passed = Number(passedMatch[1]);
  return { passed, failed };
}

export class TestRunnerTool {
  readonly name = 'test_runner';
  readonly description = 'Detect vitest/jest from package.json scripts and run only the declared npm test script with a bounded timeout.';

  async execute(input: unknown): Promise<ToolResult> {
    try {
      if (!isRecord(input)) return { success: false, error: 'Input must be an object' };
      if (typeof input.root !== 'string' || input.root.trim() === '') return { success: false, error: 'root must be a non-empty absolute path' };
      const root = await safeRoot(input.root);
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as unknown;
      if (!isRecord(pkg) || !isRecord(pkg.scripts) || typeof pkg.scripts.test !== 'string') return { success: false, error: 'package.json must declare scripts.test' };
      const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
      const runner = detectRunner(pkg);
      const result = await runNpmTest(root, timeoutMs);
      const counts = parseCounts(`${result.stdout}\n${result.stderr}`);
      const data: TestRunnerData = { root, runner, exitCode: result.exitCode, passed: counts.passed, failed: counts.failed, durationMs: result.durationMs, timedOut: result.timedOut, stdoutTail: tail(result.stdout), stderrTail: tail(result.stderr) };
      return { success: !result.timedOut && result.exitCode === 0, output: `Tests (${runner}): ${counts.passed} passed, ${counts.failed} failed in ${result.durationMs}ms${result.timedOut ? ' (timed out)' : ''}`, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const TEST_RUNNER_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'test_runner',
    description: 'Run only the declared npm test script for a project and summarize passed/failed tests.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute project root containing package.json' },
        timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds, capped at 300000' },
      },
      required: ['root'],
    },
  },
};
