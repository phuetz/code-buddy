import { useState, type FormEvent } from 'react';
import { CheckCircle2, Edit3, ShieldCheck } from 'lucide-react';
import type {
  OsConstitutionUpdateInput,
  OsIntentProofPayload,
} from '../../../shared/intent-proof-types';
import { GuidedTooltip } from '../Tooltip';

interface ConstitutionBandProps {
  constitution: NonNullable<OsIntentProofPayload['constitution']>;
  onEdit: () => void;
}

interface MissionConstitutionEditorProps {
  payload: OsIntentProofPayload;
  pending: boolean;
  error: string | null;
  onUpdate: (input: Omit<OsConstitutionUpdateInput, 'sessionId'>) => Promise<void>;
}

const PRIVACY_LABEL = {
  'local-only': 'local seulement',
  'private-peers': 'pairs privés',
  'cloud-allowed': 'cloud autorisé',
} as const;

const APPROVAL_LABEL = {
  never: 'jamais',
  'on-risk': 'risque élevé',
  always: 'toujours',
} as const;

export function ConstitutionBand({ constitution, onEdit }: ConstitutionBandProps) {
  const constraints = [
    ['Confidentialité', PRIVACY_LABEL[constitution.privacy]],
    ['Budget', `${constitution.maxCostUsd.toFixed(2).replace('.', ',')} $`],
    ['Latence p95', `${constitution.maxLatencyMs} ms`],
    ['Réversibilité', constitution.requireReversible ? 'obligatoire' : 'optionnelle'],
    ['Approbation', APPROVAL_LABEL[constitution.approval]],
  ];
  return (
    <section className="rounded-lg border border-border bg-background px-4 py-4" data-testid="constitution-band">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-accent" />
        <h2 className="font-semibold text-foreground">Constitution d’autonomie</h2>
        <GuidedTooltip title="Le contrat de confiance de l’agent" description="Ces limites sont évaluées contre chaque offre avant exécution. Elles ne donnent aucune permission supplémentaire et restent soumises aux contrôles de sécurité." kicker="Garde-fous" side="bottom"><span tabIndex={0} className="inline-flex cursor-help rounded-full text-muted-foreground outline-none focus:ring-2 focus:ring-accent">ⓘ</span></GuidedTooltip>
      </div>
      <div className="grid items-center gap-3 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_110px_120px]">
        {constraints.map(([label, value]) => (
          <div key={label} className="min-w-0 border-r border-border pr-3 last:border-0">
            <p className="text-[10px] text-muted-foreground">{label} :</p>
            <p className="mt-1 truncate text-xs font-medium text-foreground">{value}</p>
          </div>
        ))}
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          data-testid="constitution-edit"
        >
          <Edit3 className="h-3.5 w-3.5" /> Modifier
        </button>
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-success">
          <CheckCircle2 className="h-5 w-5" /> Contrat actif
        </span>
      </div>
    </section>
  );
}

export function MissionConstitutionEditor({
  payload,
  pending,
  error,
  onUpdate,
}: MissionConstitutionEditorProps) {
  const constitution = payload.constitution;
  const [privacy, setPrivacy] = useState(constitution?.privacy ?? 'cloud-allowed');
  const [maxCostUsd, setMaxCostUsd] = useState(String(constitution?.maxCostUsd ?? 10));
  const [maxLatencyMs, setMaxLatencyMs] = useState(String(constitution?.maxLatencyMs ?? 5000));
  const [requireReversible, setRequireReversible] = useState(constitution?.requireReversible ?? true);
  const [approval, setApproval] = useState(constitution?.approval ?? 'on-risk');
  const [maxRisk, setMaxRisk] = useState(constitution?.maxRisk ?? 'medium');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onUpdate({
      privacy,
      maxCostUsd: Number(maxCostUsd),
      maxLatencyMs: Number(maxLatencyMs),
      requireReversible,
      approval,
      maxRisk,
    });
  };

  return (
    <section className="rounded-lg border border-border bg-background" data-testid="constitution-editor">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <h2 className="font-semibold text-foreground">Constitution d’autonomie</h2>
          <GuidedTooltip title="Configure les limites avant la mission" description="Un budget, une latence, une politique de confidentialité et un niveau de risque explicites rendent les décisions de l’agent lisibles et auditables." kicker="Configuration expliquée" side="bottom"><span tabIndex={0} className="inline-flex cursor-help rounded-full text-muted-foreground outline-none focus:ring-2 focus:ring-accent">ⓘ</span></GuidedTooltip>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Cette enveloppe peut seulement restreindre l’exécution ; elle ne remplace jamais les permissions de sécurité.
        </p>
      </header>
      <form onSubmit={submit} className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
        <label className="text-xs text-muted-foreground">
          Confidentialité
          <select value={privacy} onChange={(event) => setPrivacy(event.target.value as typeof privacy)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="local-only">Local seulement</option>
            <option value="private-peers">Pairs privés</option>
            <option value="cloud-allowed">Cloud autorisé</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Budget maximal ($)
          <input type="number" min="0" step="0.01" required value={maxCostUsd} onChange={(event) => setMaxCostUsd(event.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          Latence p95 maximale (ms)
          <input type="number" min="0" required value={maxLatencyMs} onChange={(event) => setMaxLatencyMs(event.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          Approbation humaine
          <select value={approval} onChange={(event) => setApproval(event.target.value as typeof approval)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="never">Jamais dans cette couche</option>
            <option value="on-risk">Sur risque élevé</option>
            <option value="always">Toujours</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Risque maximal
          <select value={maxRisk} onChange={(event) => setMaxRisk(event.target.value as typeof maxRisk)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="low">Faible</option>
            <option value="medium">Moyen</option>
            <option value="high">Élevé</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end rounded-md border border-border px-3 py-2.5 text-sm text-foreground">
          <input type="checkbox" checked={requireReversible} onChange={(event) => setRequireReversible(event.target.checked)} />
          Réversibilité obligatoire
        </label>
        {error ? <p className="text-xs text-warning md:col-span-2 xl:col-span-3">{error}</p> : null}
        <div className="flex justify-end md:col-span-2 xl:col-span-3">
          <button disabled={pending} className="rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-50">
            Enregistrer la constitution
          </button>
        </div>
      </form>
    </section>
  );
}
