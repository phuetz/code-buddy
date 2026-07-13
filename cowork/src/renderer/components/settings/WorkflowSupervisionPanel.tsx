import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitCompare,
  Loader2,
  RefreshCw,
  RotateCcw,
  Route,
  X,
} from 'lucide-react';
import type {
  WorkflowDryRunResult,
  WorkflowRunComparison,
  WorkflowRunRecord,
} from '../../../shared/workflow-supervision';

export function WorkflowSupervisionPanel({
  workflowId,
  onClose,
}: {
  workflowId: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<WorkflowDryRunResult | null>(null);
  const [history, setHistory] = useState<WorkflowRunRecord[]>([]);
  const [comparison, setComparison] = useState<WorkflowRunComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [replaying, setReplaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextPreview, nextHistory] = await Promise.all([
        window.electronAPI.workflow.preview(workflowId),
        window.electronAPI.workflow.history(workflowId, 20),
      ]);
      setPreview(nextPreview);
      setHistory(nextHistory);
      setComparison(null);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  const replay = useCallback(async (runId: string) => {
    setReplaying(runId);
    try {
      await window.electronAPI.workflow.replay(runId);
      await load();
    } finally {
      setReplaying(null);
    }
  }, [load]);

  const compareLatest = useCallback(async () => {
    if (history.length < 2) return;
    const result = await window.electronAPI.workflow.compare(history[1].id, history[0].id);
    setComparison(result);
  }, [history]);

  return (
    <section
      className="mt-4 rounded-xl border border-accent/30 bg-accent/5 overflow-hidden"
      data-testid="workflow-supervision-panel"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <div className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Route size={15} className="text-accent" /> Supervision du workflow
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            Simulation par le compilateur de production, historique persistant et replay contrôlé.
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void load()} className="p-2 text-text-muted hover:text-accent" aria-label="Actualiser la supervision">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button type="button" onClick={onClose} className="p-2 text-text-muted hover:text-text-primary" aria-label="Fermer la supervision">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Dry-run fidèle</h3>
          {preview ? (
            <div className="rounded-lg border border-border bg-surface p-3" data-testid="workflow-dry-run-result">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                {preview.valid ? <CheckCircle2 size={15} className="text-success" /> : <AlertTriangle size={15} className="text-error" />}
                {preview.valid ? 'Compilation valide' : 'Compilation impossible'}
              </div>
              {preview.valid ? (
                <>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                    <Metric label="Actions" value={preview.totalExecutableSteps} />
                    <Metric label="Approbations" value={preview.approvalSteps} />
                    <Metric label="Externes" value={preview.externalToolSteps} />
                  </div>
                  <div className="mt-3 max-h-44 overflow-y-auto space-y-1">
                    {preview.steps.map((step) => (
                      <div key={`${step.id}-${step.depth}`} className="text-[11px] text-text-secondary" style={{ paddingLeft: `${step.depth * 12}px` }}>
                        <span className="text-text-muted">{step.kind}</span> · {step.label}
                        {step.toolName ? <span className="font-mono"> · {step.toolName}</span> : null}
                      </div>
                    ))}
                  </div>
                  {preview.warnings.map((warning) => <div key={warning} className="mt-2 text-[11px] text-warning">{warning}</div>)}
                </>
              ) : <div className="mt-2 text-xs text-error">{preview.error}</div>}
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Historique</h3>
            <button
              type="button"
              onClick={() => void compareLatest()}
              disabled={history.length < 2}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-border text-text-secondary disabled:opacity-40"
            >
              <GitCompare size={12} /> Comparer les 2 derniers
            </button>
          </div>
          {comparison ? (
            <div className="rounded-lg border border-border bg-surface p-3 text-[11px] text-text-secondary" data-testid="workflow-run-comparison">
              {comparison.summary.map((line) => <div key={line}>{line}</div>)}
            </div>
          ) : null}
          <div className="space-y-2 max-h-80 overflow-y-auto" data-testid="workflow-run-history">
            {history.length === 0 ? <div className="text-xs text-text-muted">Aucune exécution enregistrée.</div> : history.map((run) => (
              <article key={run.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`text-xs font-medium ${run.result.success ? 'text-success' : 'text-error'}`}>
                      {run.result.status} · {run.result.completedSteps}/{run.result.totalSteps}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {new Date(run.startedAt).toLocaleString()} · {run.result.duration} ms · {run.source}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void replay(run.id)}
                    disabled={replaying === run.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] text-text-secondary hover:text-accent disabled:opacity-50"
                    title="Rejouer la définition et le contexte enregistrés"
                  >
                    {replaying === run.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Rejouer
                  </button>
                </div>
                {run.diagnostic ? (
                  <div className="mt-2 rounded bg-error/5 border border-error/20 p-2">
                    <div className="text-[11px] font-medium text-error">{run.diagnostic.title}</div>
                    <div className="text-[10px] text-text-muted mt-1">{run.diagnostic.explanation}</div>
                    {run.diagnostic.suggestedActions.map((action) => (
                      <div key={action.id} className="mt-1 text-[10px] text-text-secondary">
                        Conseil : {action.label} — {action.description}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-surface-muted px-2 py-1.5">
      <div className="text-sm font-semibold text-text-primary">{value}</div>
      <div className="text-[9px] uppercase text-text-muted">{label}</div>
    </div>
  );
}
