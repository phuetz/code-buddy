import { useState } from 'react';
import { CircleHelp, GitBranch } from 'lucide-react';
import type {
  OsCapsuleCreateInput,
  OsConstitutionUpdateInput,
  OsExchangeBidInput,
  OsExchangeRehearseInput,
  OsForgeCreateInput,
  OsIntentProofPayload,
} from '../../../shared/intent-proof-types';
import { CounterfactualForgeView } from './CounterfactualForgeView';
import { IntentContractView } from './IntentContractView';
import { MissionConstitutionEditor } from './MissionConstitutionView';
import { ProofInspectorView, ProofTimeline } from './ProofInspectorView';
import { ProvenOutcomeView } from './ProvenOutcomeView';
import { ShadowLabView } from './ShadowTwinView';
import { SovereignExecutionView } from './SovereignExecutionView';
import { GuidedTooltip } from '../Tooltip';
import { OutcomeCapsuleView } from './OutcomeCapsuleView';

type AgentOsTab = 'mission' | 'exchange' | 'shadow' | 'constitution' | 'capsules';

interface IntentProofPanelProps {
  payload: OsIntentProofPayload | null;
  loading: boolean;
  pendingAction: string | null;
  actionError: string | null;
  onRefresh: () => void;
  onForgeCreate: (input: Omit<OsForgeCreateInput, 'sessionId'>) => Promise<void>;
  onForgeEvaluate: (branchId: string) => Promise<void>;
  onForgeSelect: (branchId: string) => Promise<void>;
  onConstitutionUpdate: (input: Omit<OsConstitutionUpdateInput, 'sessionId'>) => Promise<void>;
  onExchangeBid: (input: Omit<OsExchangeBidInput, 'sessionId'>) => Promise<void>;
  onExchangeRehearse: (input: Omit<OsExchangeRehearseInput, 'sessionId'>) => Promise<void>;
  onExchangeAward: (bidId: string) => Promise<void>;
  onExchangeReject: (bidId: string) => Promise<void>;
  onCapsuleCreate: (input: Omit<OsCapsuleCreateInput, 'sessionId'>) => Promise<void>;
  onCapsuleActivate: (capsuleId: string) => Promise<void>;
  onCapsuleRevoke: (capsuleId: string) => Promise<void>;
}

export function IntentProofPanel({
  payload,
  loading,
  pendingAction,
  actionError,
  onRefresh,
  onForgeCreate,
  onForgeEvaluate,
  onForgeSelect,
  onConstitutionUpdate,
  onExchangeBid,
  onExchangeRehearse,
  onExchangeAward,
  onExchangeReject,
  onCapsuleCreate,
  onCapsuleActivate,
  onCapsuleRevoke,
}: IntentProofPanelProps) {
  const [activeTab, setActiveTab] = useState<AgentOsTab>('mission');
  const [focusedBranchId, setFocusedBranchId] = useState<string | null>(null);
  const [selectedProofId, setSelectedProofId] = useState<string | null>(null);
  const state = payload?.state ?? null;
  const graph = payload?.graph ?? null;
  const focusedBranch = payload?.forgeBranches.find((branch) => branch.id === focusedBranchId)
    ?? payload?.forgeBranches.find((branch) => branch.status === 'selected')
    ?? payload?.forgeBranches[0]
    ?? null;
  const relevantProofs = focusedBranch?.proofIds.length
    ? payload?.proofs.filter((proof) => focusedBranch.proofIds.includes(proof.id)) ?? []
    : payload?.proofs ?? [];
  const selectedProof = relevantProofs.find((proof) => proof.id === selectedProofId)
    ?? relevantProofs.at(-1)
    ?? null;

  return (
    <section className="space-y-4" data-testid="intent-proof-panel" aria-label="Agent OS · Mission vérifiable">
      <nav className="flex border-b border-border" role="tablist" aria-label="Espaces de Mission Control" data-testid="agent-os-tabs">
        {([
          ['mission', 'Mission', 'Contrat & preuves', 'Transforme un objectif en contrat vérifiable. Consulte les critères, les branches Forge et les preuves qui justifient chaque décision.'],
          ['exchange', 'Exchange', 'Marché des capacités', 'Compare les offres des modèles locaux, du cloud et de tes pairs sur le même contrat. Une offre ne peut être attribuée que si elle respecte la Constitution.'],
          ['shadow', 'Shadow', 'Répétition sans risque', 'Mesure une offre avant de lui confier la mission. Compare la prédiction à l’observation et vérifie que le rollback est réellement possible.'],
          ['constitution', 'Constitution', 'Garde-fous d’autonomie', 'Définis les limites de confidentialité, coût, latence, risque et approbation. Cette enveloppe restreint l’agent ; elle ne remplace jamais les permissions de sécurité.'],
          ['capsules', 'Capsules', 'Réussites portables', 'Compile un outcome prouvé avec ses hashes, sa Constitution et ses répétitions multi-runtime pour en faire une capacité réutilisable.'],
        ] as const).map(([id, label, title, description]) => (
          <GuidedTooltip key={id} title={title} description={description} kicker="Mission Control" side="bottom">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`border-b-2 px-5 py-2.5 text-xs font-medium transition-colors ${activeTab === id ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              data-testid={`agent-os-tab-${id}`}
            >
              <span className="inline-flex items-center gap-1.5">{label}<CircleHelp className="h-3.5 w-3.5 opacity-60" /></span>
            </button>
          </GuidedTooltip>
        ))}
      </nav>
      {loading && !state ? (
        <div className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-3" data-testid="intent-proof-loading">
          {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-muted/70" />)}
        </div>
      ) : !payload || !state || !graph ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center" data-testid="intent-proof-empty">
          <GitBranch className="mb-3 h-8 w-8 text-muted-foreground/60" />
          <p className="font-medium text-foreground">Aucune intention durable pour cette session</p>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            Lance <code className="rounded bg-muted px-1 py-0.5 text-xs">/loop &lt;objectif&gt;</code> pour créer une mission dont l’achèvement exige des preuves.
          </p>
        </div>
      ) : (
        <>
          {activeTab === 'mission' ? (
            <>
              <IntentContractView payload={payload} loading={loading} onRefresh={onRefresh} />
              <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <CounterfactualForgeView
                  payload={payload}
                  focusedBranchId={focusedBranch?.id ?? null}
                  pendingAction={pendingAction}
                  actionError={actionError}
                  onFocusBranch={setFocusedBranchId}
                  onCreate={onForgeCreate}
                  onEvaluate={onForgeEvaluate}
                  onSelect={onForgeSelect}
                />
                <ProofInspectorView payload={payload} proof={selectedProof} />
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <ProofTimeline proofs={relevantProofs} selectedProofId={selectedProof?.id ?? null} onSelect={setSelectedProofId} />
                <ProvenOutcomeView payload={payload} />
              </div>
            </>
          ) : null}
          {activeTab === 'exchange' ? (
            <SovereignExecutionView
              payload={payload}
              pendingAction={pendingAction}
              actionError={actionError}
              onOpenConstitution={() => setActiveTab('constitution')}
              onBid={onExchangeBid}
              onRehearse={onExchangeRehearse}
              onAward={onExchangeAward}
              onReject={onExchangeReject}
            />
          ) : null}
          {activeTab === 'shadow' ? (
            <ShadowLabView payload={payload} pending={pendingAction !== null} onRehearse={onExchangeRehearse} />
          ) : null}
          {activeTab === 'constitution' ? (
            <MissionConstitutionEditor payload={payload} pending={pendingAction !== null} error={actionError} onUpdate={onConstitutionUpdate} />
          ) : null}
          {activeTab === 'capsules' ? (
            <OutcomeCapsuleView
              payload={payload}
              pending={pendingAction !== null}
              error={actionError}
              onCreate={onCapsuleCreate}
              onActivate={onCapsuleActivate}
              onRevoke={onCapsuleRevoke}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
