import { CheckCircle2, CircleDashed, FileKey2, RefreshCw, ShieldCheck, Target, XCircle } from 'lucide-react';
import type { OsIntentProofPayload } from '../../../shared/intent-proof-types';

interface IntentContractViewProps {
  payload: OsIntentProofPayload;
  loading: boolean;
  onRefresh: () => void;
}

type Criterion = NonNullable<OsIntentProofPayload['progress']>['criteria'][number];

function statusLabel(status: NonNullable<OsIntentProofPayload['state']>['status']): string {
  if (status === 'done') return 'Vérifiée';
  if (status === 'paused') return 'En pause';
  if (status === 'cleared') return 'Effacée';
  return 'Active';
}

function criterionLabel(status: Criterion['status']): string {
  if (status === 'passed') return 'prouvé';
  if (status === 'failed') return 'réfuté';
  if (status === 'unknown') return 'inconclusif';
  return 'à prouver';
}

function criterionWidth(status: Criterion['status']): number {
  if (status === 'passed') return 100;
  if (status === 'failed') return 35;
  if (status === 'unknown') return 15;
  return 0;
}

function CriterionGlyph({ status }: { status: Criterion['status'] }) {
  if (status === 'passed') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-warning" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

export function IntentContractView({ payload, loading, onRefresh }: IntentContractViewProps) {
  const state = payload.state!;
  const criteria = payload.progress?.criteria ?? [];
  const artifacts = new Map(
    payload.proofs.flatMap((proof) => proof.artifactRefs ?? []).map((artifact) => [artifact.sha256, artifact]),
  );

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background" data-testid="intent-contract-view">
      <div className="grid xl:grid-cols-[1.05fr_1.45fr]">
        <div className="relative border-b border-border p-5 xl:border-b-0 xl:border-r">
          <div className="absolute bottom-5 left-[29px] top-16 w-px bg-accent/35" aria-hidden="true" />
          <div className="flex items-center gap-3">
            <Target className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold text-foreground">Intention vérifiable</h2>
            <span className="rounded border border-accent/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">
              {statusLabel(state.status)}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              className="ml-auto rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Actualiser l’intention et les preuves"
              data-testid="intent-proof-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="relative mt-7 pl-8">
            <span className="absolute left-[1px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-accent bg-background" />
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Objectif</p>
            <h3 className="mt-1 text-base font-semibold leading-snug text-foreground" data-testid="intent-objective">
              {state.goal}
            </h3>
            {state.lastReason ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{state.lastReason}</p> : null}
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>{state.turnsUsed}/{state.maxTurns} tours</span>
              <span>{payload.proofs.length} preuves</span>
              <span>{payload.source === 'cowork-session' ? 'session Cowork' : 'dernière mission locale'}</span>
              {state.verifyGated ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <ShieldCheck className="h-3.5 w-3.5" /> gate indépendant
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid min-w-0 lg:grid-cols-[1fr_0.62fr]">
          <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground">Contrat de réussite</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Chaque ligne exige une preuve traçable.</p>
              </div>
              <span className="text-sm font-semibold text-foreground">
                {payload.progress?.passed ?? 0}/{payload.progress?.total ?? criteria.length}
              </span>
            </div>
            {criteria.length === 0 ? (
              <p className="border-l-2 border-muted px-3 py-2 text-sm text-muted-foreground">
                Aucun critère explicite. Ajoute-en avec <code>/subgoal</code>.
              </p>
            ) : (
              <ul className="space-y-3" data-testid="intent-criterion-list">
                {criteria.map((criterion, index) => (
                  <li key={criterion.criterionId} className="grid grid-cols-[1fr_88px_18px] items-center gap-3 text-xs">
                    <span className="min-w-0 truncate text-foreground" title={criterion.title}>
                      <span className="mr-2 font-mono text-[10px] text-muted-foreground">C{index + 1}</span>
                      {criterion.title}
                    </span>
                    <span>
                      <span className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>{criterionLabel(criterion.status)}</span>
                        <span>{criterion.assurance === 'none' ? '—' : criterion.assurance}</span>
                      </span>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className={`block h-full rounded-full ${criterion.status === 'failed' ? 'bg-warning' : 'bg-success'}`}
                          style={{ width: `${criterionWidth(criterion.status)}%` }}
                        />
                      </span>
                    </span>
                    <CriterionGlyph status={criterion.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <FileKey2 className="h-4 w-4 text-accent" />
              <h3 className="font-semibold text-foreground">Évidence de l’intention</h3>
            </div>
            <div className="relative space-y-3 pl-5 text-xs">
              <div className="absolute bottom-2 left-[5px] top-2 w-px bg-accent/35" />
              <div className="relative">
                <span className="absolute -left-5 top-1 h-2.5 w-2.5 rounded-full border-2 border-accent bg-background" />
                <p className="font-medium text-foreground">Intent contract</p>
                <p className="font-mono text-[10px] text-muted-foreground">rev {payload.graph?.contractRevision}</p>
              </div>
              {[...artifacts.values()].slice(0, 3).map((artifact) => (
                <div key={artifact.sha256} className="relative min-w-0">
                  <span className="absolute -left-5 top-1 h-2.5 w-2.5 rounded-full border-2 border-accent bg-background" />
                  <p className="truncate font-medium text-foreground" title={artifact.path}>{artifact.path}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">sha256:{artifact.sha256.slice(0, 12)}…</p>
                </div>
              ))}
              {artifacts.size === 0 ? (
                <div className="relative text-muted-foreground">
                  <span className="absolute -left-5 top-1 h-2.5 w-2.5 rounded-full border-2 border-muted-foreground bg-background" />
                  Aucun artefact haché
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
