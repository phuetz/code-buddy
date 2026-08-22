import { Check, Circle, LoaderCircle, ListChecks } from 'lucide-react';
import type { DevPlan, PlanStepStatus } from './dev-plan.js';

function StepIcon({ status }: { status: PlanStepStatus }) {
  if (status === 'done') return <Check className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />;
  if (status === 'active') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
}

/**
 * The bolt.new "plan" card: the development plan derived from the app prompt,
 * shown above the iterate chat as an ordered, status-aware checklist.
 */
export function DevPlanCard({ plan }: { plan: DevPlan }) {
  const done = plan.steps.filter((s) => s.status === 'done').length;
  return (
    <section
      className="shrink-0 border-b border-border bg-background/60 p-3"
      aria-label="Development plan"
      data-testid="dev-plan-card"
    >
      <header className="mb-2 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground" title={plan.title}>
          Plan · {plan.title}
        </h3>
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-muted-foreground">
          {plan.stack}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {done}/{plan.steps.length}
        </span>
      </header>
      <ol className="space-y-1.5">
        {plan.steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              <StepIcon status={step.status} />
            </span>
            <span className="min-w-0">
              <span
                className={`block text-xs ${step.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}
              >
                {step.title}
              </span>
              {step.detail ? <span className="block text-[11px] text-muted-foreground">{step.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
