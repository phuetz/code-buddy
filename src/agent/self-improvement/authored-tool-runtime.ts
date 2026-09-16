/**
 * Authored-tool runtime — shared by `register_tool` (the live capability) and the
 * self-improvement engine's sandbox scorer (the gate). One definition of "how an
 * authored tool runs" so the thing we GATE is exactly the thing we REGISTER.
 *
 * An authored tool runs its `code` SANDBOXED: a throwaway cwd, RPC off (no
 * callback into the tool system), an ISOLATED environment (no inherited
 * secrets, HOME redirected away from `~/.codebuddy`), and its call arguments
 * arrive as JSON in the CODEBUDDY_TOOL_INPUT env var; the script prints its
 * result to stdout.
 *
 * @module agent/self-improvement/authored-tool-runtime
 */

import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import fs from 'node:fs/promises';
import type { ITool, ToolSchema } from '../../tools/registry/types.js';
import type { ToolResult } from '../../types/index.js';
import { executeCode, type ExecuteCodeLanguage } from '../../tools/execute-code-runner.js';

export const AUTHORED_PREFIX = 'authored__';
export const AUTHORED_LANGUAGES: ExecuteCodeLanguage[] = ['javascript', 'typescript', 'python'];

export interface AuthoredToolSpec {
  /** Namespaced tool name (see toAuthoredName). */
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  language: ExecuteCodeLanguage;
  code: string;
}

/** Namespace + sanitize a raw tool name to `authored__<slug>` (never shadows a built-in). */
export function toAuthoredName(raw: string): string {
  const base = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base.startsWith(AUTHORED_PREFIX) ? base : `${AUTHORED_PREFIX}${base || 'tool'}`;
}

/** Build an ITool that runs the authored `code` sandboxed when invoked. */
export function buildAuthoredTool(spec: AuthoredToolSpec): ITool {
  const { name, description, parameters, language, code } = spec;
  return {
    name,
    description,
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const rootDir = path.join(os.tmpdir(), `cb-authored-${randomUUID()}`);
      try {
        await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
        const source = language === 'typescript'
          ? (await import('typescript')).transpileModule(code, { compilerOptions: { module: 99, target: 9 } }).outputText
          : code;
        const res = await executeCode(
          { code: source, language: language === 'typescript' ? 'javascript' : language, env: { CODEBUDDY_TOOL_INPUT: JSON.stringify(input ?? {}) } },
          // envMode 'isolate' → the sandbox (used for BOTH pre-accept scoring
          // and live calls) never inherits the host's secrets.
          { rootDir, rpcEnabled: false, envMode: 'isolate', confinement: 'compute' },
        );
        if (!res.ok) {
          return {
            success: false,
            error: `authored tool "${name}" failed (exit ${res.exitCode}): ${
              res.stderr.slice(0, 2000) || res.error || 'no output'
            }`,
          };
        }
        return { success: true, output: res.stdout.slice(0, 100_000) || '(no stdout)' };
      } catch (err) {
        return {
          success: false,
          error: `authored tool "${name}" error: ${err instanceof Error ? err.message : String(err)}`,
        };
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    },
    getSchema(): ToolSchema {
      return { name, description, parameters: parameters as unknown as ToolSchema['parameters'] };
    },
  };
}
