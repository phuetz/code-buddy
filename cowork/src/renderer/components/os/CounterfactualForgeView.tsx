import { useState, type FormEvent } from 'react';
import { GitCompareArrows, Plus, Trophy } from 'lucide-react';
import type { OsForgeCreateInput, OsIntentProofPayload } from '../../../shared/intent-proof-types';

type Branch = OsIntentProofPayload['forgeBranches'][number];

interface CounterfactualForgeViewProps {
  payload: OsIntentProofPayload;
  focusedBranchId: string | null;
  pendingAction: string | null;
  actionError: string | null;
  onFocusBranch: (branchId: string) => void;
  onCreate: (input: Omit<OsForgeCreateInput, 'sessionId'>) => Promise<void>;
  onEvaluate: (branchId: string) => Promise<void>;
  onSelect: (branchId: string) => Promise<void>;
}

function score(branch: Branch): string {
  return branch.metrics ? `${Math.round(branch.metrics.score * 100)}%` : '—';
}

export function CounterfactualForgeView({
  payload,
  focusedBranchId,
  pendingAction,
  actionError,
  onFocusBranch,
  onCreate,
  onEvaluate,
  onSelect,
}: CounterfactualForgeViewProps) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [strategy, setStrategy] = useState('');
  const criteria = payload.progress?.criteria ?? [];
  const branches = [...payload.forgeBranches].sort(
    (left, right) => (right.metrics?.score ?? -1) - (left.metrics?.score ?? -1),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onCreate({ label, hypothesis, strategy });
    setLabel('');
    setHypothesis('');
    setStrategy('');
    setCreating(false);
  };

  return (
    <section className="min-w-0 rounded-xl border border-border bg-background" data-testid="counterfactual-forge">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <GitCompareArrows className="h-5 w-5 text-violet-500" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-foreground">Forge contrefactuelle</h2>
          <p className="text-xs text-muted-foreground">Comparer des stratégies alternatives sur le même contrat de preuve.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          aria-expanded={creating}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          data-testid="forge-create-toggle"
        >
          <Plus className="h-3.5 w-3.5" /> Nouvelle stratégie
        </button>
      </header>

      {creating ? (
        <form onSubmit={submit} className="grid gap-3 border-b border-border bg-muted/25 p-4 lg:grid-cols-3" data-testid="forge-create-form">
          <label className="text-xs text-muted-foreground">
            Nom
            <input required value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted-foreground">
            Hypothèse
            <input required value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted-foreground">
            Stratégie
            <div className="mt-1 flex gap-2">
              <input required value={strategy} onChange={(event) => setStrategy(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent" />
              <button disabled={pendingAction !== null} className="rounded-md bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50">Créer</button>
            </div>
          </label>
        </form>
      ) : null}

      {actionError ? <p className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">{actionError}</p> : null}

      <div className="overflow-x-auto p-4">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[170px_1fr_210px_72px_108px] gap-3 border-b border-border px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <span>Stratégie</span><span>Approche clé</span><span>Contrat</span><span>Score</span><span>Résultat</span>
          </div>
          {branches.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <GitCompareArrows className="mb-2 h-7 w-7 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">Aucune stratégie concurrente</p>
              <p className="mt-1 text-xs text-muted-foreground">Crée deux approches, exécute-les puis attache leurs preuves.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border" data-testid="forge-branch-list">
              {branches.map((branch, index) => {
                const selected = branch.status === 'selected';
                const focused = focusedBranchId === branch.id;
                return (
                  <li
                    key={branch.id}
                    className={`group grid grid-cols-[170px_1fr_210px_72px_108px] items-center gap-3 px-2 py-4 transition-colors ${focused ? 'bg-muted/50' : 'hover:bg-muted/30'}`}
                    data-testid={`forge-branch-${branch.id}`}
                  >
                    <button
                      type="button"
                      onClick={() => onFocusBranch(branch.id)}
                      className="col-span-4 grid min-w-0 grid-cols-[170px_1fr_210px_72px] items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                      aria-label={`Inspecter la stratégie ${branch.label}`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border font-semibold ${selected ? 'border-success text-success' : 'border-violet-300 text-violet-600'}`}>
                          {String.fromCharCode(65 + index)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">{branch.label}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">{branch.hypothesis}</span>
                        </span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground" title={branch.strategy}>{branch.strategy}</span>
                      <span className="flex items-center gap-2">
                        {criteria.slice(0, 6).map((criterion) => {
                          const passed = branch.criterionIds.includes(criterion.criterionId);
                          return <span key={criterion.criterionId} title={criterion.title} className={`h-4 w-4 rounded-full border ${passed ? 'border-success bg-success/15' : 'border-violet-300 bg-background'}`} />;
                        })}
                        <span className="text-[10px] text-muted-foreground">{branch.criterionIds.length}/{criteria.length}</span>
                      </span>
                      <strong className={selected ? 'text-success' : 'text-violet-600'}>{score(branch)}</strong>
                    </button>
                    <span>
                      {selected ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><Trophy className="h-4 w-4" /> Gagnant</span>
                      ) : branch.status === 'planned' ? (
                        <button type="button" disabled={pendingAction !== null} onClick={() => void onEvaluate(branch.id)} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">Évaluer</button>
                      ) : branch.metrics?.eligible ? (
                        <button type="button" disabled={pendingAction !== null} onClick={() => void onSelect(branch.id)} className="rounded border border-success/40 px-2 py-1 text-[11px] text-success hover:bg-success/10 disabled:opacity-50">Choisir</button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">preuves requises</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
