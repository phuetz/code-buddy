import type { Session } from '../types';
import type { SessionState } from '../store';

export interface RunningTaskLine {
  id: string;
  label: string;
}

export function listRunningTasks(
  sessions: Session[],
  sessionStates: Record<string, SessionState>,
): RunningTaskLine[] {
  const lines: RunningTaskLine[] = [];
  for (const session of sessions) {
    const state = sessionStates[session.id];
    const running =
      session.status === 'running' ||
      Boolean(state?.activeTurn) ||
      Boolean(state?.partialMessage?.trim());
    if (!running) continue;
    const step = state?.activeTurn?.stepId;
    lines.push({
      id: session.id,
      label: step ? `${session.title || 'Session'} — ${step}` : session.title || 'Session',
    });
  }
  return lines;
}
