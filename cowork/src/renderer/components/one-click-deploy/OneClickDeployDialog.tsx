/**
 * Cowork « Déployer » — simulation by default, live upload only on explicit confirm.
 */
import { useMemo, useCallback, useEffect, useState } from 'react';
import { Loader2, Rocket, X } from 'lucide-react';
import type { OneClickReport } from '../../../../../src/deploy/one-click-types';

export interface OneClickDeployDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectRoot?: string | null;
  run?: (input: { projectRoot: string; apply?: boolean; dryRun?: boolean }) => Promise<OneClickReport>;
  resolveRoot?: () => Promise<string | null>;
}

export function OneClickDeployDialog({
  isOpen,
  onClose,
  projectRoot,
  run,
  resolveRoot,
}: OneClickDeployDialogProps) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<OneClickReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(projectRoot ?? null);

  /*
   * Mémorisé : recréée à chaque rendu, cette fonction changeait l'identité des
   * dépendances de runPlan et faisait passer React Hook pour incomplet. Ce
   * n'est pas qu'un avertissement de style — un appel en vol pourrait viser une
   * version périmée du pont.
   */
  const invoke = useMemo(
    () =>
      run ??
      ((input: { projectRoot: string; apply?: boolean; dryRun?: boolean }) => {
        const fn = window.electronAPI?.oneClickDeploy?.run;
        if (!fn) return Promise.reject(new Error('Pont de déploiement indisponible.'));
        return fn(input);
      }),
    [run],
  );

  const runPlan = useCallback(
    async (apply: boolean) => {
      const dir =
        projectRoot ||
        root ||
        (resolveRoot ? await resolveRoot() : (await window.electronAPI?.project?.getActive())?.workspacePath) ||
        null;
      if (!dir) {
        setError('Aucun projet ouvert. Configurez .codebuddy/deploy.json dans le dossier du site.');
        return;
      }
      setRoot(dir);
      if (!invoke) {
        setError('Pont de déploiement indisponible.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const next = await invoke({ projectRoot: dir, apply, dryRun: !apply });
        setReport(next);
        if (!next.ok) setError(next.error ?? 'Échec');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [invoke, projectRoot, resolveRoot, root],
  );

  useEffect(() => {
    if (!isOpen) return;
    setReport(null);
    setError(null);
    void runPlan(false);
  }, [isOpen, projectRoot]); // eslint-disable-line react-hooks/exhaustive-deps -- open/root only

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="one-click-deploy-dialog"
    >
      <section className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-surface shadow-lg">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Rocket className="h-4 w-4" aria-hidden="true" />
            Déployer
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm">
          <p className="mb-3 text-xs text-muted-foreground">
            Simulation par défaut : rien n’est envoyé. Cible lue dans{' '}
            <code>.codebuddy/deploy.json</code> (cloudflare-pages ou netlify).
          </p>
          {busy ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Préparation du plan…
            </div>
          ) : null}
          {error ? (
            <p className="mb-2 text-destructive" data-testid="one-click-deploy-error">
              {error}
            </p>
          ) : null}
          {report ? (
            <div data-testid="one-click-deploy-report" className="space-y-2">
              <p>
                Mode : <strong>{report.dryRun ? 'simulation' : 'envoi'}</strong>
                {report.target ? ` · ${report.target}` : ''} · {report.durationMs} ms
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-xs">
                {report.steps.map((step) => (
                  <li key={step.id}>
                    <span className="font-mono">{step.status}</span> {step.id}: {step.detail}
                    {step.command ? <div className="font-mono text-muted-foreground">{step.command}</div> : null}
                  </li>
                ))}
              </ol>
              {report.url ? (
                <p>
                  URL :{' '}
                  <a href={report.url} className="text-primary underline" onClick={(e) => { e.preventDefault(); void window.electronAPI?.openExternal?.(report.url ?? ''); }}>
                    {report.url}
                  </a>
                </p>
              ) : null}
              {report.deployId ? <p>Identifiant : {report.deployId}</p> : null}
              <div>
                <div className="font-medium">Retour arrière</div>
                <p className="text-xs text-muted-foreground">{report.rollback.summary}</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px]">
                  {report.rollback.commands.join('\n')}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs">
            Fermer
          </button>
          <button
            type="button"
            data-testid="one-click-deploy-apply"
            disabled={busy || !report?.ok || !report.dryRun}
            onClick={() => void runPlan(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Envoyer vraiment
          </button>
        </footer>
      </section>
    </div>
  );
}

export default OneClickDeployDialog;
