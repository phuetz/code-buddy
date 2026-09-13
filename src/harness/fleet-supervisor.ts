/** Fixed host operations exposed through Code Buddy's programmatic tool harness.
 * The manifest is an operator-owned permission boundary, never model-generated input.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ToolHarness } from './tool-harness.js';
import { runProc } from '../agent/self-improvement/evolution/variant-fitness.js';
import type { ToolResult } from '../types/index.js';

interface SupervisorOperation { command: string; args: string[]; timeoutMs: number; description: string }
export interface SupervisorManifest { workspace: string; operations: Map<string, SupervisorOperation> }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

export function parseSupervisorManifest(input: unknown, baseDir: string): SupervisorManifest {
  if (!record(input) || typeof input.workspace !== 'string') throw new Error('workspace is required');
  const workspace = path.resolve(baseDir, input.workspace);
  if (!record(input.operations)) throw new Error('operations must be an object');
  const operations = new Map<string, SupervisorOperation>();
  for (const [name, operation] of Object.entries(input.operations)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || ['tool_search', 'exec', 'code_exec'].includes(name)) throw new Error(`Invalid operation name: ${name}`);
    if (!record(operation) || typeof operation.command !== 'string' || !operation.command || operation.command.includes('\0')) throw new Error(`Invalid command: ${name}`);
    if (!Array.isArray(operation.args) || !operation.args.every(arg => typeof arg === 'string' && !arg.includes('\0'))) throw new Error(`Invalid arguments: ${name}`);
    const timeoutMs = operation.timeoutMs ?? 30000;
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 45000) throw new Error(`Invalid timeout: ${name}`);
    operations.set(name, { command: operation.command, args: [...operation.args], timeoutMs, description: typeof operation.description === 'string' ? operation.description : name });
  }
  if (!operations.size || operations.size > 64) throw new Error('Define between 1 and 64 fixed operations');
  return { workspace, operations };
}

export async function runSupervisor(manifestPath: string, action: string, options: { signal?: AbortSignal } = {}): Promise<ToolResult> {
  const resolved = path.resolve(manifestPath);
  const manifest = parseSupervisorManifest(JSON.parse(await fs.readFile(resolved, 'utf8')), path.dirname(resolved));
  if (!manifest.operations.has(action)) throw new Error(`Unknown operation: ${action}`);
  const harness = new ToolHarness({
    cwd: manifest.workspace,
    tools: [...manifest.operations].map(([name, operation]) => ({ type: 'function', function: {
      name, description: operation.description,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    } })),
    dispatch: async (name, args, signal) => {
      const operation = manifest.operations.get(name);
      if (!operation || Object.keys(args).length) return { success: false, error: 'Only fixed manifest operations are authorized' };
      if (signal?.aborted) return { success: false, error: 'Cancelled before dispatch' };
      const result = await runProc(operation.command, operation.args, {
        checkoutDir: manifest.workspace, timeoutMs: operation.timeoutMs, signal,
      });
      return { success: result.code === 0 && !result.timedOut, output: result.stdout,
        ...(result.code ? { error: result.stderr || `Operation exited with code ${result.code}` } : {}),
        data: { exitCode: result.code, timedOut: result.timedOut } };
    },
  });
  try {
    return await harness.exec(`const r=await tools.call(${JSON.stringify(action)},{}); text(r); if(!r.success) throw new Error(r.error);`, { timeoutMs: 60000, signal: options.signal });
  } finally { await harness.dispose(); }
}
