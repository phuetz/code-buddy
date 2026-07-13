import { BookOpenCheck, Database, ShieldCheck } from 'lucide-react';
import type { OsIntentProofPayload } from '../../../shared/intent-proof-types';

interface ProvenOutcomeViewProps {
  payload: OsIntentProofPayload;
}

export function ProvenOutcomeView({ payload }: ProvenOutcomeViewProps) {
  const outcome = payload.outcomes[0] ?? null;
  return (
    <section className="rounded-xl border border-border bg-background p-4" data-testid="proven-outcome-memory">
      <div className="mb-4 flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground">Mémoire des outcomes prouvés</h2>
      </div>
      {!outcome ? (
        <div className="flex min-h-24 items-center gap-3 border-l-2 border-muted pl-4">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Aucune réussite promue</p>
            <p className="text-xs text-muted-foreground">La mémoire s’ouvre seulement après couverture complète et preuve forte.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_190px]">
          <div className="border border-success/45 bg-success/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-success">Outcome prouvé</p>
              <span className="text-xs font-semibold text-success">confiance {Math.round(outcome.trustScore * 100)}%</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{outcome.goal}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {outcome.criteria.length} critère(s) · {outcome.proofIds.length} preuve(s) · {outcome.artifacts.length} artefact(s)
            </p>
            <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">{outcome.id}</p>
          </div>
          <div className="flex flex-col items-center justify-center border border-dashed border-accent/45 p-3 text-center">
            <BookOpenCheck className="h-5 w-5 text-accent" />
            <p className="mt-2 text-xs font-medium text-foreground">Revue humaine</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {outcome.lessonCandidateId ? `Candidat ${outcome.lessonCandidateId}` : 'Promotion disponible dans les leçons'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
