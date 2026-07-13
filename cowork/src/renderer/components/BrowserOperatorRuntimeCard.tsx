import React, { useMemo, useState } from 'react';
import {
  ExternalLink,
  LockKeyhole,
  ShieldCheck,
  StopCircle,
} from 'lucide-react';
import type {
  BrowserOperatorRuntimeEvent,
  BrowserOperatorRuntimeResult,
  BrowserOperatorRuntimeView,
  BrowserOperatorSessionDraftInput,
  BrowserOperatorStopResult,
} from '../../shared/browser-operator-runtime-types';

export interface BrowserOperatorRuntimeCardProps {
  runtime: BrowserOperatorRuntimeView;
  draft: BrowserOperatorSessionDraftInput;
  events?: BrowserOperatorRuntimeEvent[];
  defaultApprover?: string;
  onApprove: (input: {
    runtimeId: string;
    ownerSessionId: string;
    expectedDraftHash: string;
    approvedBy: string;
  }) => Promise<BrowserOperatorRuntimeResult>;
  onStop: (input: {
    runtimeId: string;
    ownerSessionId: string;
  }) => Promise<BrowserOperatorStopResult>;
  onRuntimeChange?: (runtime: BrowserOperatorRuntimeView) => void;
}

/**
 * Review gate for the exact immutable Browser Operator plan.
 *
 * It intentionally receives callbacks instead of reading window.electronAPI,
 * so the UI can land independently from the shared preload file. The later
 * preload wiring is a mechanical adapter only.
 */
export const BrowserOperatorRuntimeCard: React.FC<BrowserOperatorRuntimeCardProps> = ({
  runtime,
  draft,
  events = [],
  defaultApprover = 'Patrice',
  onApprove,
  onStop,
  onRuntimeChange,
}) => {
  const [reviewed, setReviewed] = useState(false);
  const [approvedBy, setApprovedBy] = useState(defaultApprover);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentActions = useMemo(() => {
    const latest = new Map(events.flatMap((event) => event.action ? [[event.action.id, event.action] as const] : []));
    return draft.actionLog.map((action) => latest.get(action.id) ?? action);
  }, [draft.actionLog, events]);
  const canApprove = runtime.state === 'prepared' && reviewed && approvedBy.trim().length > 0 && !busy;
  const canStop = runtime.state === 'running' || runtime.state === 'stopping';

  const approve = async () => {
    if (!canApprove) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onApprove({
        runtimeId: runtime.runtimeId,
        ownerSessionId: runtime.ownerSessionId,
        expectedDraftHash: runtime.draftHash,
        approvedBy: approvedBy.trim(),
      });
      if (!result.ok) {
        setError(result.error);
      } else {
        onRuntimeChange?.(result.runtime);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!canStop || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onStop({
        runtimeId: runtime.runtimeId,
        ownerSessionId: runtime.ownerSessionId,
      });
      if (!result.ok) {
        setError(result.error);
      } else {
        onRuntimeChange?.(result.runtime);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="browser-operator-runtime-card"
      className="rounded-2xl border border-border bg-background shadow-elevated overflow-hidden"
      aria-label="Browser Operator review"
    >
      <header className="flex items-start justify-between gap-4 border-b border-border-muted bg-surface/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-accent shrink-0" />
            <h3 className="text-sm font-semibold text-text-primary truncate">Browser Operator</h3>
            <StateBadge state={runtime.state} />
          </div>
          <p className="mt-1 text-xs text-text-muted line-clamp-2">{runtime.goal}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${runtime.interactionClass === 'interactive' ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500'}`}>
          {runtime.interactionClass === 'interactive' ? 'Interactif' : 'Lecture seule'}
        </span>
      </header>

      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-border-muted bg-surface/40 p-3 text-xs">
          <div className="flex items-center gap-2 text-text-primary">
            <ExternalLink size={13} className="text-accent" />
            <span className="font-medium truncate">{runtime.sourceUrl}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            {runtime.mode === 'local'
              ? 'Une fenêtre visible utilise le profil persistant dédié de Code Buddy : les connexions faites ici sont réutilisées, sans accéder aux onglets de votre navigateur personnel.'
              : 'La tâche s’exécute dans un navigateur isolé sans partager les cookies de votre navigateur personnel.'}
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Plan exact à autoriser</h4>
            <code className="rounded bg-surface px-1.5 py-0.5 text-[9px] text-text-muted" title={runtime.draftHash}>
              {runtime.draftHash.slice(0, 12)}
            </code>
          </div>
          <ol className="space-y-2">
            {currentActions.map((action) => (
              <li key={action.id} className="flex gap-3 rounded-lg border border-border-muted px-3 py-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                  {action.sequence}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-text-primary">{action.title}</span>
                    {action.requiresConsent && (
                      <LockKeyhole size={11} className="shrink-0 text-amber-500" aria-label="Confirmation requise" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    {action.action ?? action.tool} · {action.status}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {runtime.state === 'prepared' && (
          <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
                className="mt-0.5"
              />
              <span>J’ai relu cette URL, chaque action et l’empreinte du plan. Les actions interactives seront confirmées une seconde fois juste avant exécution.</span>
            </label>
            <label className="block text-[11px] text-text-muted">
              Opérateur qui autorise
              <input
                aria-label="Opérateur qui autorise"
                value={approvedBy}
                onChange={(event) => setApprovedBy(event.target.value)}
                maxLength={160}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              disabled={!canApprove}
              onClick={() => void approve()}
              className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Préparation…' : 'Autoriser ce plan exact'}
            </button>
          </div>
        )}

        {canStop && (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
          >
            <StopCircle size={14} />
            ARRÊTER LE NAVIGATEUR
          </button>
        )}

        {runtime.proofPath && (
          <p className="break-all rounded-lg bg-surface px-3 py-2 text-[10px] text-text-muted">
            Preuve privée : {runtime.proofPath}
          </p>
        )}
        {(error || runtime.error) && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error ?? runtime.error}
          </p>
        )}
      </div>
    </section>
  );
};

const StateBadge: React.FC<{ state: BrowserOperatorRuntimeView['state'] }> = ({ state }) => {
  const label: Record<BrowserOperatorRuntimeView['state'], string> = {
    prepared: 'À relire',
    running: 'En cours',
    stopping: 'Arrêt…',
    completed: 'Terminé',
    failed: 'Échec',
    stopped: 'Arrêté',
  };
  return (
    <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] font-medium text-text-muted">
      {label[state]}
    </span>
  );
};
