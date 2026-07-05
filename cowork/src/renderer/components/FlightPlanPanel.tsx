/**
 * FlightPlanPanel — the live "plan de vol" surface, mounted to the RIGHT of the chat.
 *
 * A real-time vertical step timeline (Manus / bolt.new style) of the active session's work: it
 * branches the already-live `traceSteps` (fed by the trace.step / trace.update IPC) into the
 * ready-made `MissionTimeline` renderer. No new IPC — pure projection of existing store state.
 *
 * Kept deliberately thin: the TraceStep → line mapping is delegated to the shared, unit-tested
 * `activity-pane-helpers` (same source of truth as the ActivityPane), and the visuals to
 * `MissionTimeline`.
 */
import { PanelRightClose, ListTree } from 'lucide-react';
import { useAppStore } from '../store';
import type { TraceStep } from '../types';
import { traceStepToLine, activityStatus } from './activity-pane-helpers';
import { MissionTimeline, type MissionStep } from './MissionTimeline';

const EMPTY_STEPS: TraceStep[] = [];

/** Map a live TraceStep status onto the timeline's status vocabulary. */
function toMissionStatus(step: TraceStep, activeStepId: string | null): MissionStep['status'] {
  // The step the engine is currently executing reads as running even before its
  // own status flips (activeTurn.stepId is the freshest signal).
  if (activeStepId && step.id === activeStepId) return 'running';
  switch (step.status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'error':
      return 'error';
    case 'pending':
    default:
      return 'pending';
  }
}

/** Project the session's trace into flight-plan steps (drop empty `text` narration noise). */
function toMissionSteps(steps: readonly TraceStep[], activeStepId: string | null): MissionStep[] {
  return steps
    .filter((step) => step.type !== 'text' || (step.content ?? '').trim().length > 0)
    .map((step) => {
      const line = traceStepToLine(step);
      return {
        id: step.id,
        label: line.label,
        detail: line.detail,
        tool: step.toolName,
        status: toMissionStatus(step, activeStepId),
      };
    });
}

export function FlightPlanPanel() {
  // Copy ActivityPane's scoped selectors so this panel only re-renders on its own slice.
  const traceSteps = useAppStore(
    (s) => (s.activeSessionId ? s.sessionStates[s.activeSessionId]?.traceSteps : undefined) ?? EMPTY_STEPS,
  );
  const activeTurn = useAppStore(
    (s) => (s.activeSessionId ? s.sessionStates[s.activeSessionId]?.activeTurn ?? null : null),
  );
  const setShowFlightPlan = useAppStore((s) => s.setShowFlightPlan);

  const status = activityStatus(traceSteps, activeTurn);
  const steps = toMissionSteps(traceSteps, activeTurn?.stepId ?? null);

  return (
    <aside
      data-testid="flight-plan-panel"
      className="flex w-[340px] shrink-0 flex-col min-h-0 border-l border-border bg-surface"
    >
      {/* Header: title + live status + collapse */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <ListTree size={15} className="shrink-0 text-accent" aria-hidden />
        <span className="text-sm font-semibold text-text-primary">Plan de vol</span>
        <span
          className={`ml-1 text-[11px] px-2 py-0.5 rounded-full ${
            status.busy ? 'bg-accent text-text-primary' : 'bg-surface-muted text-text-muted'
          }`}
        >
          {status.busy && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse" />
          )}
          {status.text}
        </span>
        <button
          type="button"
          onClick={() => setShowFlightPlan(false)}
          title="Masquer le plan de vol"
          aria-label="Masquer le plan de vol"
          className="ml-auto shrink-0 rounded p-1 text-text-muted hover:bg-accent/50 hover:text-text-primary transition-colors"
        >
          <PanelRightClose size={15} aria-hidden />
        </button>
      </div>

      {/* Live step timeline */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {steps.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-xs text-text-muted px-2">
            Les étapes du travail de l’agent s’afficheront ici.
          </div>
        ) : (
          <MissionTimeline steps={steps} className="ml-1" />
        )}
      </div>
    </aside>
  );
}

export default FlightPlanPanel;
