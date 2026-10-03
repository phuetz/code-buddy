import { runHookCommandSync } from './hook-command-supervisor.js';
import type { HookExecutionSnapshot } from './hook-command-supervisor.js';

/** Trusted supervisor, executed separately because the compaction caller is synchronous. */

export function runSynchronousHookCommand(command: string, input: string, timeout: number, env: NodeJS.ProcessEnv, snapshot?: HookExecutionSnapshot): {
  status: number | null; stdout: string; stderr: string; error?: Error;
} {
  return runHookCommandSync(command, input, timeout, env, snapshot);
}
