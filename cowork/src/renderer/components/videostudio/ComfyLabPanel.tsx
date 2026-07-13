import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  HardDrive,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import type {
  ComfyLabReadiness,
  ComfyLabSnapshot,
  ComfyLabUseCaseId,
} from '../../../shared/comfy-lab';
import {
  AvatarBiblePanel,
  type AvatarBibleFlowAsset,
} from './AvatarBiblePanel';

const READINESS_LABELS: Record<ComfyLabReadiness, string> = {
  ready: 'Prêt',
  partial: 'Partiel',
  missing: 'Manquant',
};

const READINESS_TONES: Record<ComfyLabReadiness, string> = {
  ready: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  partial: 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  missing: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

export interface ComfyLabPanelProps {
  onClose: () => void;
  onUseAvatar?: (asset: AvatarBibleFlowAsset) => void;
}

function formatStorage(bytes: number): string {
  if (bytes <= 0) return '0 Go';
  return `${(bytes / (1024 ** 3)).toFixed(1)} Go`;
}

export function ComfyLabPanel({ onClose, onUseAvatar }: ComfyLabPanelProps) {
  const [snapshot, setSnapshot] = useState<ComfyLabSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();

  const inspect = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await window.electronAPI.comfyLab.inspect();
      if (!result.ok || !result.snapshot) throw new Error(result.error ?? 'Diagnostic indisponible.');
      setSnapshot(result.snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void inspect();
  }, [inspect]);

  const openComfyUi = useCallback(async () => {
    setBusyAction('open');
    setNotice(undefined);
    try {
      const result = await window.electronAPI.comfyLab.openComfyUi();
      setNotice(result.ok ? result.message : result.error);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  const copyPlan = useCallback(async (useCaseId: ComfyLabUseCaseId) => {
    setBusyAction(useCaseId);
    setNotice(undefined);
    try {
      const result = await window.electronAPI.comfyLab.copyPlan({ useCaseId });
      setNotice(result.ok ? result.message : result.error);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  return (
    <section
      className="min-h-0 flex-1 overflow-auto bg-background"
      data-testid="comfy-lab-panel"
      aria-label="Laboratoire ComfyUI"
    >
      <div className="mx-auto max-w-7xl space-y-4 p-5">
        <header className="rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-500/10 via-surface to-cyan-500/5 p-5 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-600 dark:text-violet-300">
                Cartographie locale · aucun lancement automatique
              </p>
              <h2 className="mt-1 text-xl font-semibold">Laboratoire ComfyUI</h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                Six parcours créatifs classés par priorité, évalués depuis les modèles non vides,
                workflows locaux et nœuds exposés sur loopback. Ici, Code Buddy observe et prépare :
                il ne télécharge, n’installe et n’exécute rien.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {snapshot?.probe.cpuFallback ? (
                <span
                  className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-800 dark:text-amber-200"
                  data-testid="comfy-lab-cpu-fallback"
                  title="ComfyUI utilise le CPU : les workflows restent compatibles mais beaucoup plus lents."
                >
                  CPU fallback
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void openComfyUi()}
                disabled={busyAction === 'open' || snapshot?.probe.state !== 'reachable'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45"
                data-testid="comfy-lab-open"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Ouvrir ComfyUI
              </button>
              <button
                type="button"
                onClick={() => void inspect()}
                disabled={loading}
                className="rounded-lg border border-border bg-background p-2 text-muted-foreground hover:text-foreground disabled:opacity-45"
                aria-label="Actualiser le diagnostic ComfyUI"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border bg-background p-2 text-muted-foreground hover:text-foreground"
                aria-label="Fermer le laboratoire ComfyUI"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {snapshot ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="comfy-lab-inventory">
              <InventoryTile
                icon={<HardDrive className="h-4 w-4" />}
                label="Installation"
                value={snapshot.installation.found ? 'Détectée' : 'Absente'}
                detail={snapshot.installation.source === 'COMFYUI_ROOT' ? 'COMFYUI_ROOT' : snapshot.installation.source}
              />
              <InventoryTile
                icon={<Server className="h-4 w-4" />}
                label="Loopback"
                value={snapshot.probe.state === 'reachable' ? 'En ligne' : 'Hors ligne'}
                detail={snapshot.probe.device
                  ? `${snapshot.probe.device.name} · ${snapshot.probe.device.type}`
                  : snapshot.probe.comfyuiVersion ? `ComfyUI ${snapshot.probe.comfyuiVersion}` : snapshot.probe.url}
              />
              <InventoryTile
                icon={<HardDrive className="h-4 w-4" />}
                label="Modèles non vides"
                value={String(snapshot.inventory.modelFiles)}
                detail={formatStorage(snapshot.inventory.modelBytes)}
              />
              <InventoryTile
                icon={<ShieldCheck className="h-4 w-4" />}
                label="Signaux déclaratifs"
                value={`${snapshot.inventory.templates} workflows`}
                detail={`${snapshot.inventory.nodes} nœuds sondés`}
              />
            </div>
          ) : null}
        </header>

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div role="status" className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-xs text-violet-800 dark:text-violet-200">
            {notice}
          </div>
        ) : null}
        {snapshot?.inventory.truncated ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
            Inventaire borné : le plafond de fichiers a été atteint. Les états restent prudents.
          </div>
        ) : null}

        {loading && !snapshot ? (
          <div className="flex min-h-52 items-center justify-center rounded-2xl border border-dashed border-border text-xs text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Inventaire local borné en cours…
          </div>
        ) : null}

        <AvatarBiblePanel onUseAsset={onUseAvatar} />

        {snapshot ? (
          <div className="grid gap-4 xl:grid-cols-2" data-testid="comfy-lab-use-cases">
            {snapshot.useCases.map((useCase) => (
              <article key={useCase.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {useCase.eyebrow}
                    </p>
                    <h3 className="mt-1 text-sm font-semibold">{useCase.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{useCase.summary}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${READINESS_TONES[useCase.readiness]}`}>
                    {READINESS_LABELS[useCase.readiness]}
                  </span>
                </div>

                <div className="mt-3 rounded-xl bg-accent/45 px-3 py-2 text-[11px]">
                  <span className="font-semibold">Livrable :</span> {useCase.deliverable}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {useCase.requirements.map((requirement) => (
                    <div key={requirement.id} className="rounded-lg border border-border bg-background p-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium">
                        {requirement.available
                          ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          : <TriangleAlert className="h-3 w-3 text-amber-500" />}
                        {requirement.label}
                      </div>
                      <p className="mt-1 truncate text-[9px] text-muted-foreground" title={requirement.matches.join(', ')}>
                        {requirement.available ? requirement.matches.join(', ') : 'Non détecté'}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-3 text-[10px] leading-relaxed sm:grid-cols-2">
                  <div>
                    <p className="font-semibold">Coût local estimatif</p>
                    <p className="text-muted-foreground">{useCase.cost.api} · {useCase.cost.compute} · {useCase.cost.storage}</p>
                  </div>
                  <div>
                    <p className="font-semibold">Licence à vérifier</p>
                    <p className="text-muted-foreground">{useCase.license}</p>
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                  {useCase.limits.map((limit) => <li key={limit}>• {limit}</li>)}
                </ul>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-[10px] text-muted-foreground">{useCase.readinessReason}</p>
                  <button
                    type="button"
                    onClick={() => void copyPlan(useCase.id)}
                    disabled={busyAction === useCase.id}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-semibold hover:bg-accent disabled:opacity-45"
                    data-testid={`comfy-lab-copy-${useCase.id}`}
                  >
                    <Copy className="h-3 w-3" /> Copier le plan
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InventoryTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-background/80 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}<span className="text-[9px] uppercase tracking-wide">{label}</span></div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
      <div className="truncate text-[9px] text-muted-foreground" title={detail}>{detail}</div>
    </div>
  );
}
