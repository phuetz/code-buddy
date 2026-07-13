import { useState, type FormEvent } from 'react';
import { Box, CheckCircle2, CircleDashed, LockKeyhole, PackageCheck, ShieldCheck, XCircle } from 'lucide-react';
import type {
  OsCapsuleCreateInput,
  OsIntentProofPayload,
} from '../../../shared/intent-proof-types';
import { GuidedTooltip } from '../Tooltip';

interface OutcomeCapsuleViewProps {
  payload: OsIntentProofPayload;
  pending: boolean;
  error: string | null;
  onCreate: (input: Omit<OsCapsuleCreateInput, 'sessionId'>) => Promise<void>;
  onActivate: (capsuleId: string) => Promise<void>;
  onRevoke: (capsuleId: string) => Promise<void>;
}

function CapsuleCreateForm({ payload, pending, onCreate }: Pick<OutcomeCapsuleViewProps, 'payload' | 'pending' | 'onCreate'>) {
  const [outcomeId, setOutcomeId] = useState(payload.outcomes[0]?.id ?? '');
  const [title, setTitle] = useState(payload.outcomes[0]?.goal ?? '');
  const [description, setDescription] = useState('Workflow rejouable sous Constitution, preuves et permissions inchangées.');
  const [requiredRuntimes, setRequiredRuntimes] = useState('2');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onCreate({ outcomeId, title, description, requiredRuntimes: Number(requiredRuntimes) });
  };

  if (payload.outcomes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
        <LockKeyhole className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="mt-2 text-sm font-semibold text-foreground">Aucun outcome prouvé</p>
        <p className="mt-1 text-xs text-muted-foreground">Termine d’abord un loop avec couverture complète et preuve forte.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-xl border border-border bg-background p-5 md:grid-cols-2" data-testid="capsule-create-form">
      <label className="text-xs text-muted-foreground">Outcome source
        <select value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          {payload.outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.goal} · confiance {Math.round(outcome.trustScore * 100)}%</option>)}
        </select>
      </label>
      <label className="text-xs text-muted-foreground">Runtimes indépendants requis
        <select value={requiredRuntimes} onChange={(event) => setRequiredRuntimes(event.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          <option value="2">2 runtimes</option><option value="3">3 runtimes</option><option value="4">4 runtimes</option><option value="5">5 runtimes</option>
        </select>
      </label>
      <label className="text-xs text-muted-foreground">Nom de la capsule
        <input required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
      </label>
      <label className="text-xs text-muted-foreground">Description
        <input required value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
      </label>
      <div className="flex items-center justify-between gap-3 md:col-span-2">
        <p className="max-w-xl text-[11px] leading-relaxed text-muted-foreground">La compilation capture les hashes de preuves, les artefacts, la Constitution et les attestations Shadow. Aucun secret n’est accepté.</p>
        <button disabled={pending} className="shrink-0 rounded-md bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 disabled:opacity-50">Compiler la capsule</button>
      </div>
    </form>
  );
}

export function OutcomeCapsuleView({ payload, pending, error, onCreate, onActivate, onRevoke }: OutcomeCapsuleViewProps) {
  return (
    <div className="space-y-4" data-testid="outcome-capsule-view">
      <section className="overflow-hidden rounded-2xl border border-violet-300/30 bg-gradient-to-br from-violet-500/10 via-background to-cyan-500/5">
        <header className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
          <div className="rounded-xl bg-violet-500/15 p-2 text-violet-500"><PackageCheck className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h2 className="font-semibold text-foreground">Outcome Capsules</h2><GuidedTooltip title="Plus robuste qu’un playbook" description="Une capsule transporte non seulement une procédure, mais aussi ses preuves, sa Constitution et des répétitions réussies sur plusieurs modèles ou runtimes." kicker="Innovation Code Buddy" side="bottom"><span tabIndex={0} className="cursor-help text-muted-foreground">ⓘ</span></GuidedTooltip></div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Transforme une réussite prouvée en capacité portable. Une capsule reste inactive tant que deux runtimes distincts ne l’ont pas répétée et qu’un humain ne l’a pas approuvée.</p>
          </div>
        </header>
        <div className="p-4"><CapsuleCreateForm payload={payload} pending={pending} onCreate={onCreate} /></div>
      </section>

      {error ? <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">{error}</p> : null}

      <section className="grid gap-3 lg:grid-cols-2" data-testid="capsule-list">
        {payload.capsules.map((capsule) => (
          <article key={capsule.id} className="rounded-xl border border-border bg-background p-4">
            <div className="flex items-start gap-3">
              <Box className="mt-0.5 h-5 w-5 text-violet-500" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground">{capsule.title}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${capsule.status === 'active' ? 'bg-success/10 text-success' : capsule.status === 'revoked' ? 'bg-warning/10 text-warning' : 'bg-violet-500/10 text-violet-500'}`}>{capsule.status}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{capsule.description}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm font-semibold text-foreground">{Math.round(capsule.trustScore * 100)}%</p><p className="text-[9px] uppercase tracking-wide text-muted-foreground">confiance</p></div>
              <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm font-semibold text-foreground">{capsule.proofHashes.length}</p><p className="text-[9px] uppercase tracking-wide text-muted-foreground">preuves</p></div>
              <div className="rounded-lg bg-muted/40 p-2"><p className="text-sm font-semibold text-foreground">{capsule.portability.distinctRuntimes}/{capsule.portability.requiredRuntimes}</p><p className="text-[9px] uppercase tracking-wide text-muted-foreground">runtimes</p></div>
            </div>
            <div className="mt-3 space-y-1.5">
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground">{capsule.proofHashes.length > 0 ? <CheckCircle2 className="h-4 w-4 text-success" /> : <CircleDashed className="h-4 w-4" />} Provenance cryptographique</p>
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground">{capsule.portability.portable ? <CheckCircle2 className="h-4 w-4 text-success" /> : <CircleDashed className="h-4 w-4" />} Portabilité multi-runtime</p>
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground"><ShieldCheck className="h-4 w-4 text-success" /> Constitution figée</p>
            </div>
            <div className="mt-4 flex gap-2">
              {capsule.status !== 'active' && capsule.status !== 'revoked' ? <button type="button" disabled={pending || !capsule.portability.portable} onClick={() => void onActivate(capsule.id)} className="flex-1 rounded-md bg-success px-3 py-2 text-xs font-semibold text-white disabled:bg-muted disabled:text-muted-foreground">Activer</button> : null}
              {capsule.status === 'active' ? <button type="button" disabled={pending} onClick={() => void onRevoke(capsule.id)} className="flex-1 rounded-md border border-warning/40 px-3 py-2 text-xs font-semibold text-warning"><XCircle className="mr-1 inline h-4 w-4" /> Révoquer</button> : null}
            </div>
          </article>
        ))}
        {payload.capsules.length === 0 ? <div className="col-span-full rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">Aucune capsule compilée pour cette intention.</div> : null}
      </section>
    </div>
  );
}
