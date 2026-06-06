/**
 * Headless Tool Executor — Execute tools without a UI
 *
 * Used by CloudAgentRunner to execute tool calls in background mode.
 * Delegates to the existing tool registry but runs without confirmation
 * prompts (auto-approve in headless mode).
 */

import { logger } from '../utils/logger.js';

export interface HeadlessToolResult {
  success: boolean;
  output?: string;
  error?: string;
  filesChanged?: string[];
}

/**
 * In a fresh headless process (cloud task child, background review) the formal
 * tool registry singleton starts EMPTY — nothing has called the registrar yet —
 * so tools like `remember`/`skill_manage` resolve as "not found". Register the
 * built-in tools once, lazily. Idempotent: the registrar skips already-present
 * tools, and the flag avoids rebuilding factories on every call.
 */
let builtinsRegistered = false;
async function ensureBuiltinToolsRegistered(): Promise<void> {
  if (builtinsRegistered) return;
  try {
    const { getFormalToolRegistry, registerBuiltinTools } = await import('../tools/registry/index.js');
    registerBuiltinTools(getFormalToolRegistry());
    builtinsRegistered = true;
  } catch (err) {
    logger.debug('Failed to register builtin tools for headless execution', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Execute a tool call in headless mode (no UI confirmation prompts).
 */
export async function executeToolHeadless(
  toolName: string,
  argsJson: string | undefined,
  signal?: AbortSignal,
): Promise<HeadlessToolResult> {
  if (signal?.aborted) {
    return { success: false, error: 'Task was cancelled' };
  }

  let args: Record<string, unknown> = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      return { success: false, error: `Invalid JSON arguments: ${argsJson?.slice(0, 200)}` };
    }
  }

  try {
    // Ensure the registry is populated (no-op after the first call).
    await ensureBuiltinToolsRegistered();

    // Lazy-load the formal tool registry (has execute() method)
    const { getFormalToolRegistry } = await import('../tools/registry/index.js');
    const registry = getFormalToolRegistry();

    // Execute the tool via the formal registry
    const result = await registry.execute(toolName, args);
    const filesChanged: string[] = [];

    // Track file changes from file-modifying tools
    if (['write_file', 'edit_file', 'str_replace', 'apply_patch', 'create_file'].includes(toolName)) {
      const filePath = (args.path || args.file_path || args.filename) as string | undefined;
      if (filePath) {
        filesChanged.push(filePath);
      }
    }

    return {
      success: result.success !== false,
      output: typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? result),
      error: result.error,
      filesChanged: filesChanged.length > 0 ? filesChanged : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`Headless tool execution failed: ${toolName}`, { error: msg });
    return { success: false, error: msg };
  }
}
