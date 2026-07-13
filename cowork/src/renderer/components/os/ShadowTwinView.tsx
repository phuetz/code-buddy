import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleDashed, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import type {
  OsExchangeRehearseInput,
  OsIntentProofPayload,
} from '../../../shared/intent-proof-types';

type BidEvaluation = OsIntentProofPayload['exchangeBids'][number];

interface ShadowTwinInspectorProps {
  evaluation: BidEvaluation | null;
  pending: boolean;
  startEditing?: boolean;
  onRehearse: (input: Omit<OsExchangeRehearseInput, 'sessionId'>) => Promise<void>;
}

interface ShadowLabViewProps {
  payload: OsIntentProofPayload;
  pending: boolean;
  onRehearse: (input: Omit<OsExchangeRehearseInput, 'sessionId'>) => Promise<void>;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')} %`;
}

function MetricRow({ label, predicted, observed, drift }: { label: string; predicted: string; observed: string; drift: number }) {
  return (
    <div className="grid grid-cols-[1fr_72px_72px_54px] items-center gap-2 text-[11px]">
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">{predicted}</span>
      <span className="text-foreground">{observed}</span>
      <span className={drift <= 0.1 ? 'text-success' : 'text-warning'}>{percent(drift)}</span>
    </div>
  );
}

export function ShadowTwinInspector({ evaluation, pending, startEditing = false, onRehearse }: ShadowTwinInspectorProps) {
  const [editing, setEditing] = useState(startEditing);
  const bid = evaluation?.bid ?? null;
  const rehearsal = evaluation?.rehearsal ?? null;
  const [quality, setQuality] = useState(String(bid?.prediction.quality ?? 0));
  const [latencyMs, setLatencyMs] = useState(String(bid?.prediction.latencyMs ?? 0));
  const [costUsd, setCostUsd] = useState(String(bid?.prediction.costUsd ?? 0));
  const [checkpointTaken, setCheckpointTaken] = useState(true);
  const [rollbackValidated, setRollbackValidated] = useState(true);
  const [noPersistentSideEffects, setNoPersistentSideEffects] = useState(true);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!bid) return;
    await onRehearse({
      bidId: bid.id,
      quality: Number(quality),
      latencyMs: Number(latencyMs),
      costUsd: Number(costUsd),
      reversibility: { checkpointTaken, rollbackValidated, noPersistentSideEffects },
    });
    setEditing(false);
  };

  if (!evaluation || !bid) {
    return <aside className="rounded-lg border border-border p-5 text-sm text-muted-foreground">Sélectionne une offre pour ouvrir son Shadow Twin.</aside>;
  }

  return (
    <aside className="rounded-lg border border-border bg-background" data-testid="shadow-twin-inspector">
      <header className="flex items-center gap-2 px-4 py-3">
        <RotateCcw className="h-5 w-5 text-violet-600" />
        <h2 className="font-semibold text-foreground">Shadow Twin</h2>
        <span className="rounded border border-violet-300 px-2 py-0.5 text-[10px] text-violet-600">{bid.label}</span>
      </header>

      {editing || !rehearsal ? (
        <form onSubmit={submit} className="space-y-3 border-t border-border p-4" data-testid="shadow-rehearsal-form">
          <p className="text-xs font-medium text-foreground">Observations mesurées</p>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[10px] text-muted-foreground">Qualité
              <input type="number" min="0" max="1" step="0.01" required value={quality} onChange={(event) => setQuality(event.target.value)} className="mt-1 w-full rounded border border-border px-2 py-1.5 text-xs text-foreground" />
            </label>
            <label className="text-[10px] text-muted-foreground">Latence ms
              <input type="number" min="0" required value={latencyMs} onChange={(event) => setLatencyMs(event.target.value)} className="mt-1 w-full rounded border border-border px-2 py-1.5 text-xs text-foreground" />
            </label>
            <label className="text-[10px] text-muted-foreground">Coût $
              <input type="number" min="0" step="0.01" required value={costUsd} onChange={(event) => setCostUsd(event.target.value)} className="mt-1 w-full rounded border border-border px-2 py-1.5 text-xs text-foreground" />
            </label>
          </div>
          <div className="grid gap-2 text-[11px] text-foreground">
            <label className="flex items-center gap-2"><input type="checkbox" checked={checkpointTaken} onChange={(event) => setCheckpointTaken(event.target.checked)} /> Checkpoint d’état pris</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rollbackValidated} onChange={(event) => setRollbackValidated(event.target.checked)} /> Chemin de rollback validé</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={noPersistentSideEffects} onChange={(event) => setNoPersistentSideEffects(event.target.checked)} /> Aucun effet persistant détecté</label>
          </div>
          <div className="flex justify-end gap-2">
            {rehearsal ? <button type="button" onClick={() => setEditing(false)} className="rounded border border-border px-3 py-1.5 text-xs">Annuler</button> : null}
            <button disabled={pending} className="rounded bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50">Enregistrer la répétition</button>
          </div>
        </form>
      ) : (
        <>
          <div className="border-y border-border p-4">
            <div className="mb-3 grid grid-cols-[1fr_72px_72px_54px] gap-2 text-[9px] uppercase text-muted-foreground">
              <span>Prédiction vs observation</span><span>Prédiction</span><span>Observation</span><span>Δ</span>
            </div>
            <div className="space-y-3">
              <MetricRow label="Qualité" predicted={percent(rehearsal.prediction.quality)} observed={percent(rehearsal.observation.quality)} drift={rehearsal.drift.quality} />
              <MetricRow label="Latence p95" predicted={`${rehearsal.prediction.latencyMs} ms`} observed={`${rehearsal.observation.latencyMs} ms`} drift={rehearsal.drift.latency} />
              <MetricRow label="Coût" predicted={`${rehearsal.prediction.costUsd.toFixed(2)} $`} observed={`${rehearsal.observation.costUsd.toFixed(2)} $`} drift={rehearsal.drift.cost} />
            </div>
            <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
              <span className="text-[10px] text-muted-foreground">Score de dérive</span>
              <strong className={rehearsal.status === 'pass' ? 'text-3xl text-violet-600' : 'text-3xl text-warning'}>{percent(rehearsal.drift.score)}</strong>
            </div>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium text-foreground">Réversibilité vérifiée</p>
              {Object.entries(rehearsal.reversibility).map(([key, passed]) => (
                <p key={key} className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  {passed ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-warning" />}
                  {key === 'checkpointTaken' ? 'Checkpoint d’état pris' : key === 'rollbackValidated' ? 'Chemin de rollback validé' : 'Aucun effet persistant'}
                </p>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-foreground">Journal des événements</p>
              {rehearsal.journal.map((entry) => <p key={entry} className="mt-1 flex gap-2 text-[10px] text-muted-foreground"><span className="text-success">•</span>{entry}</p>)}
            </div>
          </div>
          <div className="flex justify-end border-t border-border p-3">
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-violet-600 hover:underline">Nouvelle observation</button>
          </div>
        </>
      )}
    </aside>
  );
}

export function ShadowLabView({ payload, pending, onRehearse }: ShadowLabViewProps) {
  const [selectedBidId, setSelectedBidId] = useState(payload.exchangeBids[0]?.bid.id ?? null);
  const evaluation = payload.exchangeBids.find((entry) => entry.bid.id === selectedBidId) ?? payload.exchangeBids[0] ?? null;
  return (
    <section className="grid gap-4 xl:grid-cols-[320px_1fr]" data-testid="shadow-lab-view">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="mb-4 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-600" /><h2 className="font-semibold text-foreground">Répétitions shadow</h2></div>
        {payload.exchangeBids.length === 0 ? <p className="text-sm text-muted-foreground">Aucune offre à répéter.</p> : (
          <ul className="space-y-1">
            {payload.exchangeBids.map((entry) => (
              <li key={entry.bid.id}>
                <button type="button" onClick={() => setSelectedBidId(entry.bid.id)} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs ${evaluation?.bid.id === entry.bid.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}>
                  {entry.rehearsal?.status === 'pass' ? <CheckCircle2 className="h-4 w-4 text-success" /> : entry.rehearsal?.status === 'fail' ? <XCircle className="h-4 w-4 text-warning" /> : <CircleDashed className="h-4 w-4" />}
                  <span className="min-w-0 flex-1 truncate">{entry.bid.label}</span>
                  <span>{entry.rehearsal ? percent(entry.rehearsal.drift.score) : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ShadowTwinInspector key={evaluation?.bid.id ?? 'none'} evaluation={evaluation} pending={pending} onRehearse={onRehearse} />
    </section>
  );
}
