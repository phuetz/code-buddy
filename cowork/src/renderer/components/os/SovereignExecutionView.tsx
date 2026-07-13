import { useState, type FormEvent } from 'react';
import { Ban, CheckCircle2, CircleDashed, GitCompareArrows, Plus, Radio, ShieldCheck, Trophy, XCircle } from 'lucide-react';
import type {
  OsExchangeBidInput,
  OsExchangeRehearseInput,
  OsIntentProofPayload,
} from '../../../shared/intent-proof-types';
import { ConstitutionBand } from './MissionConstitutionView';
import { ShadowTwinInspector } from './ShadowTwinView';
import { GuidedTooltip } from '../Tooltip';

type Evaluation = OsIntentProofPayload['exchangeBids'][number];

interface SovereignExecutionViewProps {
  payload: OsIntentProofPayload;
  pendingAction: string | null;
  actionError: string | null;
  onOpenConstitution: () => void;
  onBid: (input: Omit<OsExchangeBidInput, 'sessionId'>) => Promise<void>;
  onRehearse: (input: Omit<OsExchangeRehearseInput, 'sessionId'>) => Promise<void>;
  onAward: (bidId: string) => Promise<void>;
  onReject: (bidId: string) => Promise<void>;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function MissionBidForm({ payload, pending, onSubmit, onClose }: {
  payload: OsIntentProofPayload;
  pending: boolean;
  onSubmit: SovereignExecutionViewProps['onBid'];
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [strategy, setStrategy] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [evidencePlan, setEvidencePlan] = useState('');
  const [quality, setQuality] = useState('0.8');
  const [latencyMs, setLatencyMs] = useState('500');
  const [costUsd, setCostUsd] = useState('0');
  const [privacy, setPrivacy] = useState<'local' | 'private' | 'cloud'>('local');
  const [risk, setRisk] = useState<'low' | 'medium' | 'high'>('low');
  const [reversible, setReversible] = useState(true);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      label, provider, model, strategy, hypothesis, evidencePlan,
      criterionIds: payload.progress?.criteria.map((criterion) => criterion.criterionId) ?? [],
      quality: Number(quality), latencyMs: Number(latencyMs), costUsd: Number(costUsd),
      privacy, risk, reversible,
    });
    onClose();
  };

  return (
    <form onSubmit={submit} className="grid gap-3 border-b border-border bg-muted/20 p-4 md:grid-cols-3" data-testid="exchange-bid-form">
      <label className="text-[10px] text-muted-foreground">Offreur<input required value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" /></label>
      <label className="text-[10px] text-muted-foreground">Provider<input required value={provider} onChange={(event) => setProvider(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" /></label>
      <label className="text-[10px] text-muted-foreground">Modèle<input required value={model} onChange={(event) => setModel(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" /></label>
      <label className="text-[10px] text-muted-foreground md:col-span-2">Stratégie<input required value={strategy} onChange={(event) => setStrategy(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" /></label>
      <label className="text-[10px] text-muted-foreground">Hypothèse<input required value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" /></label>
      <label className="text-[10px] text-muted-foreground md:col-span-3">Plan de preuve<input required value={evidencePlan} onChange={(event) => setEvidencePlan(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" /></label>
      <div className="grid grid-cols-3 gap-2 md:col-span-2">
        <label className="text-[10px] text-muted-foreground">Qualité<input type="number" min="0" max="1" step="0.01" required value={quality} onChange={(event) => setQuality(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" /></label>
        <label className="text-[10px] text-muted-foreground">Latence ms<input type="number" min="0" required value={latencyMs} onChange={(event) => setLatencyMs(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" /></label>
        <label className="text-[10px] text-muted-foreground">Coût $<input type="number" min="0" step="0.01" required value={costUsd} onChange={(event) => setCostUsd(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={privacy} onChange={(event) => setPrivacy(event.target.value as typeof privacy)} className="rounded border border-border bg-background px-2 py-1.5 text-xs"><option value="local">Local</option><option value="private">Privé</option><option value="cloud">Cloud</option></select>
        <select value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)} className="rounded border border-border bg-background px-2 py-1.5 text-xs"><option value="low">Risque faible</option><option value="medium">Risque moyen</option><option value="high">Risque élevé</option></select>
        <label className="col-span-2 flex items-center gap-2 text-[11px] text-foreground"><input type="checkbox" checked={reversible} onChange={(event) => setReversible(event.target.checked)} /> Réversible</label>
      </div>
      <div className="flex justify-end gap-2 md:col-span-3">
        <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-xs">Annuler</button>
        <button disabled={pending} className="rounded bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50">Soumettre l’offre</button>
      </div>
    </form>
  );
}

function PolicyStatus({ evaluation }: { evaluation: Evaluation }) {
  if (!evaluation.policy.allowed) return <span className="inline-flex items-center gap-1 text-[10px] text-warning"><Ban className="h-4 w-4" /> Bloqué par la constitution</span>;
  if (evaluation.bid.status === 'awarded') return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success"><Trophy className="h-4 w-4" /> Attribué</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] text-success"><CheckCircle2 className="h-4 w-4" /> {evaluation.pareto ? 'Éligible (Pareto)' : 'Éligible'}</span>;
}

function SettlementContract({ evaluation }: { evaluation: Evaluation | null }) {
  const gates = evaluation?.settlement;
  const rows = [
    ['Constitution', gates?.constitution],
    ['Répétition shadow', gates?.shadow],
    ['Plan de preuve', gates?.proofPlan],
    ['Réversibilité', gates?.reversibility],
  ];
  return (
    <section className="rounded-lg border border-border bg-background p-4" data-testid="settlement-contract">
      <div className="mb-5 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-violet-600" /><h2 className="font-semibold text-foreground">Contrat de règlement</h2><GuidedTooltip title="Pourquoi quatre portes ?" description="La mission est attribuée uniquement quand la Constitution, la répétition Shadow, le plan de preuve et la réversibilité sont tous validés." kicker="Décision contrôlée" side="top"><span tabIndex={0} className="ml-1 inline-flex cursor-help rounded-full text-muted-foreground outline-none focus:ring-2 focus:ring-violet-400">ⓘ</span></GuidedTooltip></div>
      <div className="grid grid-cols-4 gap-2">
        {rows.map(([label, passed], index) => (
          <div key={String(label)} className="relative text-center">
            {index > 0 ? <span className={`absolute right-1/2 top-7 h-px w-full ${passed ? 'bg-success' : 'bg-border'}`} /> : null}
            <p className="relative z-10 text-[10px] text-foreground">{label}</p>
            <span className={`relative z-10 mx-auto mt-3 flex h-7 w-7 items-center justify-center rounded-full bg-background ${passed ? 'text-success' : 'text-muted-foreground'}`}>
              {passed ? <CheckCircle2 className="h-7 w-7 fill-success text-background" /> : <CircleDashed className="h-6 w-6" />}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-border pt-3">
        <p className={`flex items-center gap-2 text-sm font-semibold ${gates?.readyToAward ? 'text-success' : 'text-muted-foreground'}`}>
          {gates?.readyToAward ? <CheckCircle2 className="h-5 w-5" /> : <CircleDashed className="h-5 w-5" />}
          {gates?.readyToAward ? 'Prêt à attribuer' : 'Gates incomplets'}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">Le gagnant sera payé en confiance uniquement après preuves.</p>
      </div>
    </section>
  );
}

function AssumptionRadar({ evaluations }: { evaluations: Evaluation[] }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4" data-testid="assumption-radar">
      <div className="mb-5 flex items-center gap-2"><GitCompareArrows className="h-5 w-5 text-violet-600" /><h2 className="font-semibold text-foreground">Radar des hypothèses</h2><GuidedTooltip title="Une hypothèse, pas une promesse" description="Chaque offre expose ce qu’elle pense améliorer. La répétition Shadow fait passer cette hypothèse de non vérifiée à soutenue ou réfutée." kicker="Apprentissage mesuré" side="top"><span tabIndex={0} className="ml-1 inline-flex cursor-help rounded-full text-muted-foreground outline-none focus:ring-2 focus:ring-violet-400">ⓘ</span></GuidedTooltip></div>
      <div className="space-y-4">
        {evaluations.slice(0, 3).map((entry, index) => {
          const status = entry.rehearsal?.status === 'pass' ? 'Soutenue' : entry.rehearsal?.status === 'fail' ? 'Réfutée' : 'Non vérifiée';
          return (
            <div key={entry.bid.id} className="grid grid-cols-[minmax(0,1fr)_1fr_105px] items-center gap-3 text-[11px]">
              <span className="truncate text-foreground" title={entry.bid.hypothesis}>{entry.bid.hypothesis}</span>
              <span className="flex items-center gap-2"><span className="h-px flex-1 border-t border-dashed border-muted-foreground" />{status === 'Soutenue' ? <CheckCircle2 className="h-5 w-5 text-success" /> : status === 'Réfutée' ? <XCircle className="h-5 w-5 text-warning" /> : <CircleDashed className="h-5 w-5 text-muted-foreground" />}<span className="text-muted-foreground">{status}</span></span>
              <span className="flex items-center gap-2"><span className="rounded border border-violet-300 px-2 py-1 text-violet-600">C{index + 1}</span><span className="truncate text-muted-foreground">{entry.bid.criterionIds.length} crit.</span></span>
            </div>
          );
        })}
        {evaluations.length === 0 ? <p className="text-sm text-muted-foreground">Les hypothèses apparaissent avec les offres.</p> : null}
      </div>
    </section>
  );
}

export function SovereignExecutionView({
  payload,
  pendingAction,
  actionError,
  onOpenConstitution,
  onBid,
  onRehearse,
  onAward,
  onReject,
}: SovereignExecutionViewProps) {
  const initial = payload.exchangeBids.find((entry) => entry.settlement.readyToAward)
    ?? payload.exchangeBids.find((entry) => entry.bid.status === 'awarded')
    ?? payload.exchangeBids[0]
    ?? null;
  const [selectedBidId, setSelectedBidId] = useState<string | null>(initial?.bid.id ?? null);
  const [creating, setCreating] = useState(false);
  const [rehearsalTarget, setRehearsalTarget] = useState<string | null>(null);
  const selected = payload.exchangeBids.find((entry) => entry.bid.id === selectedBidId) ?? initial;
  const pending = pendingAction !== null;
  const recordRehearsal = async (input: Omit<OsExchangeRehearseInput, 'sessionId'>) => {
    await onRehearse(input);
    setRehearsalTarget(null);
  };

  return (
    <div className="space-y-4" data-testid="sovereign-exchange-view">
      {payload.constitution ? <ConstitutionBand constitution={payload.constitution} onEdit={onOpenConstitution} /> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.95fr)]">
        <section className="min-w-0 rounded-lg border border-border bg-background">
          <header className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Radio className="h-5 w-5 text-violet-600" />
            <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><h2 className="font-semibold text-foreground">Marché des capacités</h2><GuidedTooltip title="Compare avant d’exécuter" description="Les offres sont classées selon qualité, latence, coût, confidentialité et réversibilité. La meilleure note ne peut pas contourner ta Constitution." kicker="Exchange multi-modèle" side="bottom"><span tabIndex={0} className="inline-flex cursor-help rounded-full text-muted-foreground outline-none focus:ring-2 focus:ring-violet-400">ⓘ</span></GuidedTooltip></div><p className="text-[11px] text-muted-foreground">Les modèles et pairs soumissionnent sur le même contrat d’intention.</p></div>
            <button type="button" onClick={() => setCreating((value) => !value)} aria-label="Nouvelle offre" aria-expanded={creating} className="rounded border border-border p-1.5 text-muted-foreground hover:bg-muted" data-testid="exchange-bid-toggle"><Plus className="h-4 w-4" /></button>
          </header>
          {creating ? <MissionBidForm payload={payload} pending={pending} onSubmit={onBid} onClose={() => setCreating(false)} /> : null}
          <div className="overflow-x-auto p-3">
            <div className="min-w-[780px]">
              <div className="grid grid-cols-[170px_1fr_86px_92px_72px_90px_130px] gap-2 border-b border-border px-2 pb-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Offreur</span><span>Modèle / stratégie</span><span>Qualité</span><span>Latence p95</span><span>Coût</span><span>Confidentialité</span><span>Statut constitution</span>
              </div>
              <ul className="divide-y divide-border" data-testid="exchange-bid-list">
                {payload.exchangeBids.map((entry) => (
                  <li key={entry.bid.id}>
                    <button type="button" onClick={() => setSelectedBidId(entry.bid.id)} className={`grid w-full grid-cols-[170px_1fr_86px_92px_72px_90px_130px] items-center gap-2 px-2 py-4 text-left text-xs ${selected?.bid.id === entry.bid.id ? 'outline outline-1 outline-violet-500' : 'hover:bg-muted/30'}`} data-testid={`exchange-bid-${entry.bid.id}`}>
                      <span className="flex min-w-0 items-center gap-2">{selected?.bid.id === entry.bid.id ? <span className="h-3.5 w-3.5 rounded-full border-4 border-violet-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground" />}<span className="truncate font-medium text-foreground">{entry.bid.label}</span></span>
                      <span className="min-w-0"><span className="block truncate text-foreground">{entry.bid.provider} · {entry.bid.model}</span><span className="block truncate text-[10px] text-muted-foreground">{entry.bid.strategy}</span></span>
                      <span><span className="font-medium text-foreground">{pct(entry.bid.prediction.quality)}</span><span className="mt-1 block h-1 overflow-hidden rounded bg-muted"><span className="block h-full bg-success" style={{ width: pct(entry.bid.prediction.quality) }} /></span></span>
                      <span className="text-foreground">{entry.bid.prediction.latencyMs} ms</span>
                      <span className="text-foreground">{entry.bid.prediction.costUsd.toFixed(2)} $</span>
                      <span className="capitalize text-foreground">{entry.bid.privacy === 'private' ? 'Privé' : entry.bid.privacy}</span>
                      <PolicyStatus evaluation={entry} />
                    </button>
                  </li>
                ))}
              </ul>
              {payload.exchangeBids.length === 0 ? <div className="flex min-h-44 flex-col items-center justify-center text-center"><Radio className="mb-2 h-7 w-7 text-muted-foreground/60" /><p className="text-sm font-medium text-foreground">Aucune offre</p><p className="mt-1 text-xs text-muted-foreground">Les modèles locaux, cloud ou pairs peuvent soumissionner.</p></div> : null}
            </div>
          </div>
          {selected ? <div className="border-t border-border px-4 py-3"><button type="button" onClick={() => setRehearsalTarget(selected.bid.id)} className="inline-flex items-center gap-2 rounded border border-violet-500 px-3 py-2 text-xs font-medium text-violet-600"><GitCompareArrows className="h-4 w-4" /> Répéter en shadow</button></div> : null}
        </section>
        <div className="space-y-3">
          <ShadowTwinInspector key={`${selected?.bid.id ?? 'none'}:${rehearsalTarget === selected?.bid.id}`} evaluation={selected} pending={pending} startEditing={rehearsalTarget === selected?.bid.id} onRehearse={recordRehearsal} />
          {selected ? <div className="flex gap-3"><button type="button" disabled={pending || selected.bid.status === 'awarded'} onClick={() => void onReject(selected.bid.id)} className="flex-1 rounded border border-border py-2 text-xs font-medium disabled:opacity-50">Refuser</button><button type="button" disabled={pending || !selected.settlement.readyToAward || selected.bid.status === 'awarded'} onClick={() => void onAward(selected.bid.id)} className={`flex-[1.7] rounded py-2 text-xs font-semibold ${selected.bid.status === 'awarded' ? 'bg-muted text-muted-foreground' : 'bg-success text-white disabled:bg-muted disabled:text-muted-foreground'}`} data-testid="exchange-award"><Trophy className="mr-2 inline h-4 w-4" /> {selected.bid.status === 'awarded' ? 'Mission attribuée' : 'Attribuer la mission'}</button></div> : null}
        </div>
      </div>
      {actionError ? <p className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">{actionError}</p> : null}
      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <AssumptionRadar evaluations={payload.exchangeBids} />
        <SettlementContract evaluation={selected} />
      </div>
    </div>
  );
}
