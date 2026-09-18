/**
 * OrchestratorLauncher — modal trigger for the multi-agent orchestrator.
 *
 * The Cowork backend (`cowork/src/main/agent/orchestrator-bridge.ts`) wraps
 * Code Buddy's MultiAgentSystem and exposes `orchestrator.run` over IPC.
 * It emits ServerEvents `subagent.spawned/status/output/completed` that
 * are consumed by the existing SubAgentPanel UI. Up until now, NOTHING
 * in the renderer triggered `orchestrator.run` — the multi-agent feature
 * was a ghost. This component is the trigger.
 *
 * UX:
 *   - Opens via the Sparkles button in the Titlebar or Ctrl+Shift+M.
 *   - Pre-fills the goal with the last user message of the active session
 *     (the "I just typed this; spawn a team to work on it" flow).
 *   - Persists the strategy + maxRounds choice across launches via
 *     localStorage (see store: lastOrchestratorOptions).
 *   - Submitting triggers the orchestrator and closes the dialog —
 *     progress is observable via SubAgentPanel which lives in
 *     ChatView (compact) and ContextPanel (agents tab).
 *
 * @module cowork/renderer/components/OrchestratorLauncher
 */

import { useEffect, useState } from 'react';
import { Sparkles, X, Loader2, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../store';
import {
  useActiveSessionId,
  useActiveSessionMessages,
} from '../store/selectors';
import type { Message } from '../types';
import { ScreenHelpButton } from './ScreenHelpButton';

type LaunchStatus = 'idle' | 'launching' | 'error';

const STRATEGIES: ReadonlyArray<{
  value: string;
  label: string;
  hint: string;
}> = [
  {
    value: 'parallel',
    label: 'Parallel',
    hint: 'All members work simultaneously, results aggregated at the end.',
  },
  {
    value: 'sequential',
    label: 'Sequential',
    hint: 'One member at a time, output of N feeds into N+1.',
  },
  {
    value: 'hierarchical',
    label: 'Hierarchical',
    hint: 'Orchestrator delegates sub-tasks; reviewers verify each step.',
  },
  {
    value: 'peer_review',
    label: 'Peer review',
    hint: 'Coder writes, reviewer audits, tester validates — explicit gates.',
  },
  {
    value: 'iterative',
    label: 'Iterative',
    hint: 'Same team loops until consensus or maxRounds reached.',
  },
];

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 10;

function lastUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = m.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

export function OrchestratorLauncher() {
  const showLauncher = useAppStore((s) => s.showOrchestratorLauncher);
  const setShowLauncher = useAppStore((s) => s.setShowOrchestratorLauncher);
  const lastOptions = useAppStore((s) => s.lastOrchestratorOptions);
  const setLastOptions = useAppStore((s) => s.setLastOrchestratorOptions);
  const activeSessionId = useActiveSessionId();
  const activeMessages = useActiveSessionMessages();

  const [goal, setGoal] = useState<string>('');
  const [strategy, setStrategy] = useState<string>(lastOptions.strategy);
  const [maxRounds, setMaxRounds] = useState<number>(lastOptions.maxRounds);
  const [status, setStatus] = useState<LaunchStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Each time the dialog opens, pre-fill the goal from the session's
  // last user message. The user can still edit before launching.
  useEffect(() => {
    if (!showLauncher) return;
    setGoal(lastUserMessage(activeMessages));
    setStrategy(lastOptions.strategy);
    setMaxRounds(lastOptions.maxRounds);
    setStatus('idle');
    setErrorMsg(null);
  }, [showLauncher, activeMessages, lastOptions.strategy, lastOptions.maxRounds]);

  if (!showLauncher) return null;

  const close = () => {
    setShowLauncher(false);
  };

  const canSubmit =
    goal.trim().length > 0 && !!activeSessionId && status !== 'launching';

  const handleSubmit = async () => {
    if (!canSubmit || !activeSessionId) return;
    setStatus('launching');
    setErrorMsg(null);
    setLastOptions({ strategy, maxRounds });
    try {
      await window.electronAPI?.orchestrator?.run(activeSessionId, goal.trim(), {
        strategy,
        maxRounds,
      });
      // Sub-agent events flow through useIPC into the store; SubAgentPanel
      // will pick them up. We just close the dialog — the user watches
      // progress in the right panel / chat.
      close();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const selectedStrategyHint =
    STRATEGIES.find((s) => s.value === strategy)?.hint ?? '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      data-testid="orchestrator-launcher"
    >
      <div className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Sparkles className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                Spawn a multi-agent team
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Decompose the goal into specialized sub-agents (orchestrator,
                coder, reviewer, tester, …) running concurrently.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
          <ScreenHelpButton screenId="orchestrator" />
          <button
            onClick={close}
            className="p-1 rounded hover:bg-surface text-text-secondary"
            title="Close"
            aria-label="Close orchestrator launcher"
          >
            <X className="w-4 h-4" />
          </button>
          </div>
        </div>

        {!activeSessionId && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs text-text-secondary">
              No active session. Open or create a session before spawning a team.
            </div>
          </div>
        )}

        <div className="space-y-4 mb-4">
          <div>
            <label
              htmlFor="orchestrator-goal"
              className="block text-sm font-medium text-text-primary mb-1.5"
            >
              Goal
            </label>
            <textarea
              id="orchestrator-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              data-testid="orchestrator-goal-input"
              placeholder="Describe what the team should achieve…"
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 resize-y"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Pre-filled from the last user message in this session. Edit freely.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="orchestrator-strategy"
                className="block text-sm font-medium text-text-primary mb-1.5"
              >
                Strategy
              </label>
              <select
                id="orchestrator-strategy"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                data-testid="orchestrator-strategy-select"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="orchestrator-rounds"
                className="block text-sm font-medium text-text-primary mb-1.5"
              >
                Max rounds
              </label>
              <input
                id="orchestrator-rounds"
                type="number"
                min={MIN_ROUNDS}
                max={MAX_ROUNDS}
                value={maxRounds}
                data-testid="orchestrator-rounds-input"
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) {
                    setMaxRounds(Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, n)));
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>

          <p className="text-[11px] text-text-secondary italic">
            {selectedStrategyHint}
          </p>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="text-xs text-red-500">{errorMsg}</div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={close}
            className="px-3 py-1.5 text-xs rounded-md text-text-secondary hover:bg-surface"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="orchestrator-spawn-button"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'launching' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Spawn team
          </button>
        </div>
      </div>
    </div>
  );
}
