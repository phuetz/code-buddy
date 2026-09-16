/**
 * Sandbox scorer — behavioural scoring of an authored tool. Builds the tool and
 * RUNS it (sandboxed, via authored-tool-runtime: throwaway cwd, RPC off) on a set
 * of cases, asserting the output. The tool is NOT registered to score it, so a
 * rejected proposal leaves both registries untouched (no rollback needed).
 *
 * @module agent/self-improvement/sandbox-scorer
 */

import { buildAuthoredTool, type AuthoredToolSpec } from './authored-tool-runtime.js';
import type { ToolCase } from './tool-types.js';

export interface ToolScore {
  passed: number;
  total: number;
  failures: string[];
}

function normalizeToolOutput(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Run the authored tool over `cases`; a case passes only on normalized exact output. */
export async function scoreToolCases(spec: AuthoredToolSpec, cases: ToolCase[]): Promise<ToolScore> {
  const tool = buildAuthoredTool(spec);
  const failures: string[] = [];
  let passed = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    let output = '';
    let ok = true;
    try {
      const res = await tool.execute(c.input);
      output = `${res.output ?? ''}`;
      if (!res.success) {
        ok = false;
        failures.push(`case ${i}: tool errored (${(res.error ?? '').slice(0, 120)})`);
      }
    } catch (err) {
      ok = false;
      failures.push(`case ${i}: threw (${err instanceof Error ? err.message : String(err)})`);
    }
    if (ok) {
      const expected = normalizeToolOutput(c.expectedOutput);
      const actual = normalizeToolOutput(output);
      if (actual !== expected) {
        failures.push(
          `case ${i}: output mismatch (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual.slice(0, 80))})`,
        );
      } else {
        passed++;
      }
    }
  }

  return { passed, total: cases.length, failures };
}
