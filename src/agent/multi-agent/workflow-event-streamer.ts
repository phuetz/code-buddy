/**
 * MultiAgentSystem live event streamer (Phase D of multi-agent integration).
 *
 * Forwards MAS workflow events to `process.stdout.write` so the user
 * sees /agents run progress in real time without waiting for the whole
 * workflow to complete (which can take minutes).
 *
 * Pattern borrowed from /docs (src/commands/enhanced-command-handler.ts
 * L228) which uses the same approach for its onProgress callback.
 *
 * Why not async dispatcher refacto:
 * CommandHandlerResult is sync-only (`entry?: ChatEntry`). Streaming
 * would require extending the type + dispatcher + ChatInterface — risk
 * of regression on 30+ existing handlers. The process.stdout.write
 * pattern lets us stream without that refacto. Full streaming via
 * AsyncGenerator stays V0.2+.
 *
 * UI Ink interaction:
 * Direct stdout writes can interleave with Ink's React render. The
 * /docs handler uses this pattern in production successfully — same
 * for us. If glitches surface, fallback = remove streaming and rely on
 * logger.info (visible in ~/.codebuddy/logs/).
 */

import type { WorkflowEvent } from './types.js';

/** Minimal subset of EventEmitter we need — keeps the interface portable
 *  for tests (real EventEmitter, plain objects with these 2 methods). */
interface MasLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface StreamerHandle {
  detach: () => void;
}

interface AgentEventData { role?: string; task?: { title?: string; description?: string }; duration?: number; result?: { success?: boolean; duration?: number } }

function fmtRole(r: unknown): string {
  return typeof r === 'string' ? r : 'agent';
}

/**
 * Attach event listeners to a MAS instance. Returns a handle whose
 * `detach()` cleans up the listeners — call it on workflow completion
 * (success or error) to avoid leaks across runs.
 *
 * Output goes to stdout via a small writer arg (defaults to
 * process.stdout.write). Tests inject a spy.
 */
export function attachStreamer(
  system: MasLike,
  writer: (chunk: string) => void = (s) => { process.stdout.write(s); }
): StreamerHandle {
  const onWorkflowStart = (data: unknown) => {
    const goal = (data as { plan?: { goal?: string } })?.plan?.goal ?? '<unknown>';
    writer(`  [workflow] started: ${goal}\n`);
  };
  const onWorkflowComplete = (data: unknown) => {
    const result = (data as { result?: { success?: boolean; summary?: string; totalDuration?: number } })?.result;
    if (result) {
      const sec = Math.round((result.totalDuration ?? 0) / 1000);
      writer(`  [workflow] completed in ${sec}s: ${result.summary ?? '(no summary)'}\n`);
    } else {
      writer(`  [workflow] completed\n`);
    }
  };
  const onWorkflowError = (data: unknown) => {
    const err = (data as { error?: { message?: string } })?.error;
    writer(`  [workflow] error: ${err?.message ?? (err ? String(err) : 'unknown')}\n`);
  };
  const onWorkflowStopped = () => {
    writer(`  [workflow] stopped by user\n`);
  };
  const onAgentStart = (data: unknown) => {
    const d = data as AgentEventData;
    const taskTitle = d.task?.title ?? d.task?.description ?? '';
    writer(`  [agent:${fmtRole(d.role)}] start${taskTitle ? `: ${taskTitle.slice(0, 80)}` : ''}\n`);
  };
  const onAgentComplete = (data: unknown) => {
    const d = data as AgentEventData;
    const sec = d.result?.duration !== undefined ? Math.round(d.result.duration / 1000) : '?';
    const ok = d.result?.success === false ? 'failed' : 'done';
    writer(`  [agent:${fmtRole(d.role)}] ${ok} in ${sec}s\n`);
  };
  const onAgentTool = (data: unknown) => {
    const d = data as AgentEventData & { name?: string; tool?: string };
    const tool = d.name ?? d.tool ?? '<tool>';
    writer(`  [agent:${fmtRole(d.role)}] tool: ${tool}\n`);
  };
  const onTimelineEvent = (event: WorkflowEvent) => {
    // Skip events already covered by other listeners to avoid duplication.
    if (event.type === 'task_started' || event.type === 'task_completed' || event.type === 'task_failed') {
      return;
    }
    // Phase H — format conflict_detected with severity prefix
    if (event.type === 'conflict_detected') {
      const conflict = (event.data as { conflict?: { severity?: string; type?: string } } | undefined)?.conflict;
      const sev = conflict?.severity ?? '?';
      const typ = conflict?.type ?? 'unknown';
      writer(`  [conflict:${sev}] ${typ} — ${event.message}\n`);
      return;
    }
    writer(`  [event] ${event.message}\n`);
  };

  system.on('workflow:start', onWorkflowStart);
  system.on('workflow:complete', onWorkflowComplete);
  system.on('workflow:error', onWorkflowError);
  system.on('workflow:stopped', onWorkflowStopped);
  system.on('agent:start', onAgentStart);
  system.on('agent:complete', onAgentComplete);
  system.on('agent:tool', onAgentTool);
  system.on('workflow:event', onTimelineEvent as (...args: unknown[]) => void);

  return {
    detach: () => {
      system.removeListener('workflow:start', onWorkflowStart);
      system.removeListener('workflow:complete', onWorkflowComplete);
      system.removeListener('workflow:error', onWorkflowError);
      system.removeListener('workflow:stopped', onWorkflowStopped);
      system.removeListener('agent:start', onAgentStart);
      system.removeListener('agent:complete', onAgentComplete);
      system.removeListener('agent:tool', onAgentTool);
      system.removeListener('workflow:event', onTimelineEvent as (...args: unknown[]) => void);
    },
  };
}
