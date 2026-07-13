import { useState } from 'react';
import { CheckCircle2, CircleDashed, FileArchive, Link2, ShieldCheck, XCircle } from 'lucide-react';
import type { OsIntentProofPayload } from '../../../shared/intent-proof-types';

type Proof = OsIntentProofPayload['proofs'][number];
type Tab = 'proof' | 'artifacts' | 'journal';

interface ProofInspectorViewProps {
  payload: OsIntentProofPayload;
  proof: Proof | null;
}

interface ProofTimelineProps {
  proofs: Proof[];
  selectedProofId: string | null;
  onSelect: (proofId: string) => void;
}

function integrityLabel(status: OsIntentProofPayload['integrity']['status']): string {
  if (status === 'valid') return 'Intégrité valide';
  if (status === 'broken') return 'Chaîne altérée';
  if (status === 'legacy') return 'Preuves héritées';
  return 'Aucune chaîne';
}

function ProofGlyph({ status }: { status: Proof['status'] }) {
  if (status === 'pass') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === 'fail') return <XCircle className="h-4 w-4 text-warning" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

export function ProofInspectorView({ payload, proof }: ProofInspectorViewProps) {
  const [tab, setTab] = useState<Tab>('proof');
  const integrityOk = payload.integrity.status === 'valid';
  const artifacts = proof?.artifactRefs ?? [];

  return (
    <aside className="min-w-0 rounded-xl border border-border bg-background" data-testid="proof-inspector">
      <header className="border-b border-border px-4 py-4">
        <h2 className="font-semibold text-foreground">Preuves</h2>
        <div className={`mt-3 flex items-start gap-3 border px-3 py-3 ${integrityOk ? 'border-success/50 bg-success/5' : payload.integrity.status === 'broken' ? 'border-warning/50 bg-warning/5' : 'border-border bg-muted/30'}`}>
          <ShieldCheck className={`mt-0.5 h-5 w-5 ${integrityOk ? 'text-success' : 'text-muted-foreground'}`} />
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${integrityOk ? 'text-success' : 'text-foreground'}`}>{integrityLabel(payload.integrity.status)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {payload.integrity.checked} maillon(s) vérifié(s) · {payload.integrity.legacy} hérités
            </p>
            {payload.proofs.at(-1)?.recordHash ? (
              <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
                root sha256:{payload.proofs.at(-1)!.recordHash!.slice(0, 20)}…
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex border-b border-border px-3" role="tablist" aria-label="Inspecteur de preuve">
        {(['proof', 'artifacts', 'journal'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`border-b-2 px-3 py-2 text-xs ${tab === value ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            data-testid={`proof-tab-${value}`}
          >
            {value === 'proof' ? 'Preuve' : value === 'artifacts' ? 'Artefacts' : 'Journal'}
          </button>
        ))}
      </div>

      <div className="min-h-64 p-4">
        {tab === 'proof' ? (
          proof ? (
            <div data-testid="intent-proof-evidence">
              <div className="mb-3 flex items-start gap-2">
                <ProofGlyph status={proof.status} />
                <div>
                  <p className="text-sm font-medium text-foreground">{proof.summary}</p>
                  <p className="text-[11px] text-muted-foreground">Tour {proof.turn} · {proof.assurance}</p>
                </div>
              </div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                {proof.evidence || 'Aucun détail brut attaché.'}
              </pre>
            </div>
          ) : <p className="text-sm text-muted-foreground">Sélectionne une preuve dans la chronologie.</p>
        ) : null}

        {tab === 'artifacts' ? (
          artifacts.length > 0 ? (
            <ul className="space-y-2" data-testid="proof-artifact-list">
              {artifacts.map((artifact) => (
                <li key={artifact.sha256} className="border-b border-border pb-2 last:border-0">
                  <p className="flex items-center gap-2 truncate text-xs font-medium text-foreground"><FileArchive className="h-3.5 w-3.5" /> {artifact.path}</p>
                  <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">sha256:{artifact.sha256}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{artifact.mediaType} · {artifact.sizeBytes} octets</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Cette preuve ne référence aucun artefact haché.</p>
        ) : null}

        {tab === 'journal' ? (
          <ol className="space-y-2" data-testid="proof-chain-journal">
            {[...payload.proofs].reverse().map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 text-xs">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-foreground">{entry.summary}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {entry.recordHash ? entry.recordHash.slice(0, 24) : 'legacy-unhashed'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </aside>
  );
}

export function ProofTimeline({ proofs, selectedProofId, onSelect }: ProofTimelineProps) {
  const ordered = [...proofs].reverse();
  return (
    <section className="rounded-xl border border-border bg-background p-4" data-testid="proof-timeline">
      <div className="mb-4 flex items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold text-foreground">Chronologie des preuves</h2>
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune preuve enregistrée.</p>
      ) : (
        <ol className="relative grid auto-cols-[minmax(150px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
          <span className="absolute left-4 right-4 top-[9px] h-px border-t border-dashed border-muted-foreground/50" aria-hidden="true" />
          {ordered.map((proof) => (
            <li key={proof.id} className="relative min-w-0">
              <button type="button" onClick={() => onSelect(proof.id)} className="w-full text-left" data-testid={`intent-proof-${proof.id}`}>
                <span className={`relative z-10 mb-3 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-background ${selectedProofId === proof.id ? 'ring-2 ring-accent ring-offset-2' : ''}`}>
                  <ProofGlyph status={proof.status} />
                </span>
                <span className="block text-[10px] text-muted-foreground">Tour {proof.turn} · {proof.kind}</span>
                <span className="mt-1 block truncate text-xs font-medium text-foreground" title={proof.summary}>{proof.summary}</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">{proof.assurance}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
