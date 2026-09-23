/**
 * MCP-only refusal of an unconfined shell escalation.
 *
 * The scope is an AsyncLocalStorage frame entered by the MCP server around
 * one tool call. It is not a process-wide flag: the agent loop and headless
 * mode never enter it, so their confirmation path is unchanged.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface UnconfinedEscalationScope {
  readonly refuse: true;
}

const storage = new AsyncLocalStorage<UnconfinedEscalationScope>();

export function runWithRefusedUnconfinedEscalation<T>(task: () => Promise<T>): Promise<T> {
  return storage.run({ refuse: true }, task);
}

export function unconfinedEscalationRefusedHere(): boolean {
  return storage.getStore()?.refuse === true;
}

export function refusedUnconfinedEscalationError(reason: string | undefined): string {
  const detail = (reason ?? '').trim();
  const unavailable = detail.length === 0
    || /unavailable|no native or docker workspace sandbox is available/i.test(detail);
  if (unavailable) {
    const suffix = detail.length > 0 ? ` ${detail}` : '';
    return `Workspace sandbox unavailable; unconfined escalation refused in MCP mode.${suffix}`;
  }
  return `Unconfined escalation refused in MCP mode. ${detail}`;
}

/**
 * Returns a refusal when this call would run on the host.
 * Both the sandbox fallback and a policy `ask` are host executions.
 * Outside the MCP server process the result is null and the old confirmation path stays.
 */
/** Set by the MCP server process only. The agent and headless processes never set it. */
export const MCP_UNCONFINED_SHELL_ENV = 'CODEBUDDY_MCP_REFUSE_UNCONFINED_SHELL';

export function mcpProcessRefusesUnconfinedShell(): boolean {
  return process.env[MCP_UNCONFINED_SHELL_ENV] === '1';
}

export function refusedUnconfinedEscalationResult(
  policyAction: string,
  requiresDirectApproval: boolean,
  reason: string | undefined,
  explicitRefusal = false,
): { success: false; error: string } | null {
  // `sandbox` is the fallback after a missing backend or a boundary denial.
  // `ask` skips the sandbox and would run on the host after approval.
  if (!requiresDirectApproval) return null;
  if (policyAction !== 'sandbox' && policyAction !== 'ask') return null;
  if (
    !explicitRefusal
    && !unconfinedEscalationRefusedHere()
    && !mcpProcessRefusesUnconfinedShell()
  ) {
    return null;
  }
  return { success: false, error: refusedUnconfinedEscalationError(reason) };
}
