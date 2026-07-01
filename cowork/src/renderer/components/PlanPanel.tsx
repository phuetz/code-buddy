/**
 * PlanPanel — plan-then-act orchestration for the new shell (cowork/REDESIGN.md slice 2b).
 *
 * State machine: idle → planning → review → executing. Drives everything through the PROVEN submit
 * path (useIPC.startSession / continueSession) — a planning-framed turn produces a plan, its reply is
 * parsed into an editable step list (PlanReview), and on approval an "execute this plan" turn runs it.
 * No new IPC, no out-of-session client, no core-loop pause. Behind COWORK_NEW_SHELL.
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import type { Message } from '../types';
import { PlanReview } from './PlanReview';
import { planRequestPrompt, buildExecutionPrompt, parsePlanSteps } from './plan-parser';

const EMPTY_MESSAGES: Message[] = [];

function messageText(m: Message): string {
  return (m.content || [])
    .map((b) => (b && b.type === 'text' && 'text' in b ? (b as { text: string }).text : ''))
    .join('\n')
    .trim();
}

type Phase = 'idle' | 'planning' | 'review' | 'executing';

export function PlanPanel() {
  const { startSession, continueSession } = useIPC();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const messages = useAppStore(
    (s) => (s.activeSessionId ? s.sessionStates[s.activeSessionId]?.messages : undefined) ?? EMPTY_MESSAGES,
  );
  const activeTurn = useAppStore(
    (s) => (s.activeSessionId ? s.sessionStates[s.activeSessionId]?.activeTurn ?? null : null),
  );

  const [phase, setPhase] = useState<Phase>('idle');
  const [taskInput, setTaskInput] = useState('');
  const [planTask, setPlanTask] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const baselineRef = useRef(0);

  const assistantCount = messages.filter((m) => m.role === 'assistant').length;

  // Watch for the plan reply: the turn finished (activeTurn null) and a new assistant message landed.
  useEffect(() => {
    if (phase !== 'planning' || activeTurn != null || assistantCount <= baselineRef.current) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const parsed = lastAssistant ? parsePlanSteps(messageText(lastAssistant)) : [];
    if (parsed.length > 0) {
      setSteps(parsed);
      setPhase('review');
    } else {
      setError('Aucun plan détecté dans la réponse — reformule et réessaie.');
      setPhase('idle');
    }
  }, [phase, activeTurn, assistantCount, messages]);

  const propose = async () => {
    const task = taskInput.trim();
    if (!task || phase === 'planning' || phase === 'executing') return;
    setError(null);
    setPlanTask(task);
    baselineRef.current = assistantCount;
    setPhase('planning');
    try {
      if (activeSessionId) {
        await continueSession(activeSessionId, [{ type: 'text', text: planRequestPrompt(task) }]);
      } else {
        await startSession(task.slice(0, 60), planRequestPrompt(task));
        baselineRef.current = 0; // fresh session — the first assistant reply is the plan
      }
    } catch {
      setError('Impossible de demander un plan.');
      setPhase('idle');
    }
  };

  const approve = async () => {
    const clean = steps.map((s) => s.trim()).filter(Boolean);
    if (!activeSessionId || clean.length === 0) return;
    setPhase('executing');
    try {
      await continueSession(activeSessionId, [{ type: 'text', text: buildExecutionPrompt(planTask, clean) }]);
      useAppStore.getState().setPrimaryView('activity'); // follow the run in the Activity pane
    } catch {
      setError('Lancement impossible.');
    }
    setPhase('idle');
    setSteps([]);
    setTaskInput('');
  };

  const cancel = () => {
    setPhase('idle');
    setSteps([]);
    setError(null);
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-background p-4" data-testid="plan-panel">
      <div className="mb-2">
        <h2 className="font-semibold">Planifier puis agir</h2>
        <p className="text-sm text-muted-foreground">
          Décris une tâche : Code Buddy propose un plan que tu approuves (et ajustes) avant qu’il agisse.
        </p>
      </div>

      {error && (
        <div className="mb-2 text-xs text-red-500 border border-red-500/30 rounded-md px-2 py-1">{error}</div>
      )}

      {phase === 'review' ? (
        <div className="flex-1 min-h-0">
          <PlanReview
            task={planTask}
            steps={steps}
            onStepsChange={setSteps}
            onApprove={approve}
            onCancel={cancel}
          />
        </div>
      ) : phase === 'planning' ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse mr-2" />
          Code Buddy prépare un plan…
        </div>
      ) : phase === 'executing' ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Lancement du plan…</div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void propose();
            }}
            placeholder="Ex : ajoute un mode sombre au panneau de réglages"
            rows={3}
            className="resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void propose()}
            disabled={!taskInput.trim()}
            className="self-start text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Proposer un plan
          </button>
        </div>
      )}
    </div>
  );
}
