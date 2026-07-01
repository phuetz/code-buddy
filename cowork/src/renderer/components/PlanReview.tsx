/**
 * PlanReview — the approvable/editable plan step list (new shell, cowork/REDESIGN.md slice 2b).
 *
 * Pure + props-driven: the parent (PlanPanel) owns the steps and the plan/act orchestration; this
 * just renders the "plan-then-act" affordance — edit a step, remove one, add one, then Approve to
 * execute or Cancel. Making autonomy feel safe = you see (and can edit) the plan before it runs.
 */
interface PlanReviewProps {
  task: string;
  steps: string[];
  busy?: boolean;
  onStepsChange: (steps: string[]) => void;
  onApprove: () => void;
  onCancel: () => void;
}

export function PlanReview({ task, steps, busy, onStepsChange, onApprove, onCancel }: PlanReviewProps) {
  const editAt = (i: number, value: string) => onStepsChange(steps.map((s, idx) => (idx === i ? value : s)));
  const removeAt = (i: number) => onStepsChange(steps.filter((_, idx) => idx !== i));
  const add = () => onStepsChange([...steps, '']);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="plan-review">
      <div className="px-1 pb-2">
        <div className="text-sm text-muted-foreground">Plan proposé pour</div>
        <div className="font-medium">{task}</div>
        <div className="text-xs text-muted-foreground mt-1">
          Relis, ajuste si besoin, puis approuve pour que Code Buddy l’exécute.
        </div>
      </div>

      <ol className="flex-1 min-h-0 overflow-auto space-y-1.5 pr-1">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-2 text-xs text-muted-foreground tabular-nums w-5 text-right shrink-0">{i + 1}.</span>
            <textarea
              value={step}
              onChange={(e) => editAt(i, e.target.value)}
              rows={1}
              className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm min-h-0"
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="mt-1 text-muted-foreground hover:text-red-500 text-sm px-1"
              title="Retirer cette étape"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-2 pt-2 border-t border-border mt-2">
        <button
          type="button"
          onClick={add}
          className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent"
        >
          + Étape
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent">
            Annuler
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy || steps.filter((s) => s.trim()).length === 0}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Lancement…' : '▶ Approuver & exécuter'}
          </button>
        </div>
      </div>
    </div>
  );
}
