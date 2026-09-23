/**
 * Tool Hooks — extracted user-hook + metric helpers around tool execution.
 *
 * Sequential and streaming paths run identical PreToolUse / PostToolUse
 * checks and per-tool metric recording around `executeTool`. This module
 * factors those side-effects out so both paths share one source of truth.
 *
 * UI surfacing of a PreToolUse block stays at the call site (sequential
 * mutates the entry history; streaming yields a content chunk).
 *
 * @module agent/execution/tool-hooks
 */

import type { CodeBuddyMessage } from '../../codebuddy/client.js';
import { getUserHooksManager } from '../../hooks/user-hooks.js';
// Phase (d).2 V0.4.1 — eager import so concurrent tool emits don't get
// serialized through dynamic-import promise chains (same fix as (d).3
// for workflow events). fleet-bridge stays lean; it lazy-imports its
// own deps so this doesn't bloat CLI-only startup.
// 
// UPDATE (2026-06): Replaced direct import of `fleet-bridge` with a callback
// registry to break the 7-module circular dependency. `fleet-bridge.js` now
// registers its broadcaster here at module load time.

export type FleetEventBroadcaster = (type: any, payload: any, agentId?: string) => void;
let _fleetBroadcaster: FleetEventBroadcaster | null = null;

/**
 * Register the fleet event broadcaster. Called by the server at boot
 * to wire up fleet events without introducing a circular dependency.
 */
export function registerFleetBroadcaster(broadcaster: FleetEventBroadcaster): void {
  _fleetBroadcaster = broadcaster;
}

function _broadcastFleetEvent(type: any, payload: any, agentId?: string): void {
  if (_fleetBroadcaster) {
    _fleetBroadcaster(type, payload, agentId);
  }
}

/**
 * Phase (d).2 V0.4.1 — fleet stream opt-in. When CODEBUDDY_FLEET_STREAM=1
 * (or =true), every tool execution emits a fleet:agent:tool_started /
 * tool_completed / tool_error event via broadcastFleetEvent so other
 * Claudes on the Tailscale fleet can observe live activity. Default off
 * to avoid noise on standalone installs.
 */
function isFleetStreamEnabled(): boolean {
  const v = process.env.CODEBUDDY_FLEET_STREAM;
  return v === '1' || v === 'true' || v === 'TRUE';
}

/**
 * Emit a fleet event for tool execution. Best-effort: never throws,
 * silently no-ops when fleet streaming is disabled or the WS server
 * isn't running.
 */
export function emitFleetToolStarted(
  toolCall: { id: string; function: { name: string } }
): void {
  if (!isFleetStreamEnabled()) return;
  try {
    _broadcastFleetEvent('fleet:agent:tool_started', {
      toolName: toolCall.function.name,
      toolCallId: toolCall.id,
    });
  } catch {
    /* fleet-bridge swallows internally; this catches surprises */
  }
}

export function emitFleetToolCompleted(
  toolCall: { id: string; function: { name: string } },
  result: { success: boolean; error?: string },
  durationMs: number
): void {
  if (!isFleetStreamEnabled()) return;
  const eventType = result.success
    ? 'fleet:agent:tool_completed'
    : 'fleet:agent:tool_error';
  try {
    _broadcastFleetEvent(eventType, {
      toolName: toolCall.function.name,
      toolCallId: toolCall.id,
      success: result.success,
      durationMs,
      error: result.error,
    });
  } catch {
    /* fleet-bridge swallows internally */
  }
}

export interface PreHookResult {
  /** True when the tool call is allowed to proceed. */
  allowed: boolean;
  /** Hook-supplied message when blocked (may be undefined). */
  feedback?: string;
}

/**
 * Run PreToolUse hooks for a tool call. Hook errors are swallowed
 * (non-critical) and treated as "allowed".
 */
export async function runPreToolUseHook(
  cwd: string,
  toolCall: { function: { name: string; arguments?: string } }
): Promise<PreHookResult> {
  try {
    const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
    const r = await getUserHooksManager(cwd).executeHooks('PreToolUse', {
      toolName: toolCall.function.name,
      toolInput: toolArgs,
    });
    return { allowed: r.allowed, feedback: r.feedback };
  } catch {
    return { allowed: true };
  }
}

/**
 * Append a "tool blocked by PreToolUse" message to the conversation.
 * Both paths use this shape; only the UI surfacing differs.
 */
export function pushBlockedToolMessage(
  messages: CodeBuddyMessage[],
  toolCall: { id: string },
  feedback: string | undefined
): void {
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: feedback ?? 'Action blocked by PreToolUse hook',
  } as CodeBuddyMessage);
}

/**
 * Run PostToolUse / PostToolUseFailure hooks based on tool result. Hook
 * errors are swallowed (non-critical).
 */
export async function runPostToolUseHook(
  cwd: string,
  toolCall: { function: { name: string } },
  result: { success: boolean; output?: string }
): Promise<void> {
  try {
    const event = result.success ? 'PostToolUse' : 'PostToolUseFailure';
    await getUserHooksManager(cwd).executeHooks(event, {
      toolName: toolCall.function.name,
      toolResult: { success: result.success, output: result.output },
    });
  } catch { /* user hooks are non-critical */ }
}

/**
 * Record a per-tool metric (success + duration). Errors are swallowed
 * (metrics are optional).
 *
 * Also feeds the session-metrics tracker so the session-end cron can
 * decide whether to distill an authored skill from a complex session.
 */
export async function recordToolMetric(
  toolName: string,
  success: boolean,
  durationMs: number
): Promise<void> {
  try {
    const { getToolMetricsTracker } = await import('../../observability/tool-metrics.js');
    getToolMetricsTracker().record(toolName, success, durationMs);
  } catch { /* metrics are optional */ }

  // Session-level counters for the skill generator (best-effort, never throws).
  try {
    const { recordToolCall, recordRecoveredError } = await import(
      '../../memory/session-metrics-tracker.js'
    );
    recordToolCall();
    if (!success) recordRecoveredError();
  } catch {
    /* tracker is optional; keep tool execution fast */
  }
}
