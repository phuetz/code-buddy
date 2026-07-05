import { ExternalLink, RefreshCw, ServerOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isLoopbackUrl } from './utils/loopback-url.js';

export interface PreviewPaneProps {
  url: string | null;
  status: 'idle' | 'starting' | 'running' | 'dead';
  onReload: () => void;
  onOpenExternal?: () => void;
}

function statusCopy(status: PreviewPaneProps['status'], unsafeUrl: boolean): { title: string; detail: string } {
  if (unsafeUrl) {
    return {
      title: 'Preview refusée',
      detail: 'Cowork affiche uniquement les previews locales fournies par le serveur de développement.',
    };
  }
  if (status === 'starting') {
    return { title: 'Serveur en démarrage', detail: 'La preview apparaîtra dès que le serveur répondra en local.' };
  }
  if (status === 'dead') {
    return { title: 'Serveur arrêté', detail: 'Relance le serveur pour restaurer la preview.' };
  }
  return { title: 'Aucune preview', detail: 'Génère ou démarre une app pour afficher le rendu.' };
}

export function PreviewPane({ url, status, onReload, onOpenExternal }: PreviewPaneProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const safeUrl = useMemo(() => (url && isLoopbackUrl(url) ? url : null), [url]);
  const unsafeUrl = Boolean(url && !safeUrl);
  const canRender = status === 'running' && safeUrl;
  const copy = statusCopy(status, unsafeUrl);

  const handleReload = () => {
    setReloadKey((value) => value + 1);
    onReload();
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-surface">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-muted px-3">
        <input
          readOnly
          value={safeUrl ?? ''}
          placeholder="Preview locale"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground outline-none"
          aria-label="URL de preview"
        />
        <button
          type="button"
          onClick={handleReload}
          disabled={!canRender}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title="Recharger"
          aria-label="Recharger la preview"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
        {onOpenExternal && (
          <button
            type="button"
            onClick={onOpenExternal}
            disabled={!canRender}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="Ouvrir dans le navigateur"
            aria-label="Ouvrir dans le navigateur"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>
      {canRender ? (
        <iframe
          key={`${safeUrl}-${reloadKey}`}
          src={safeUrl}
          title="App Studio Preview"
          sandbox="allow-scripts allow-same-origin"
          className="min-h-0 flex-1 border-0 bg-background"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <ServerOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-medium text-foreground">{copy.title}</h3>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{copy.detail}</p>
          </div>
          {status === 'dead' && (
            <button
              type="button"
              onClick={onReload}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted"
            >
              Relancer
            </button>
          )}
        </div>
      )}
    </section>
  );
}
