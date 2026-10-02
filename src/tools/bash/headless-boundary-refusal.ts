import type { OSSandboxResult } from '../../sandbox/os-sandbox.js';
import { shellCapabilities } from '../../sandbox/shell-capabilities.js';
import { getPermissionModeManager } from '../../security/permission-modes.js';
import type { ToolResult } from '../../types/index.js';

/** Only called after an actual boundary failure of a sandbox-authorized command. */
export function headlessBoundaryRefusal(result: OSSandboxResult): ToolResult | undefined {
  if (!result.sandboxed || getPermissionModeManager().getMode() !== 'dontAsk'
    || shellCapabilities().size === 0) return undefined;
  return {
    success: false,
    error: `CAPABILITY_DENIED: Workspace sandbox refused this command. No unconfined retry was performed; protected paths and shared dependencies remain read-only. Use workspace file tools and foreground tests instead of changing trust or permissions.\n${(result.stderr || result.stdout).trim()}\n[sandbox:${result.backend}; exit code ${result.exitCode}]`,
    ...(result.stdout ? { output: result.stdout } : {}),
  };
}
