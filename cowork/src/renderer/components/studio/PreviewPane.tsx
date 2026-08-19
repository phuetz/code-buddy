import { ExternalLink, Monitor, RefreshCw, ServerOff, ShieldCheck, Smartphone, Tablet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isLoopbackUrl } from './utils/loopback-url.js';

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

const DEVICES: { id: PreviewDevice; label: string; icon: typeof Monitor; width: number }[] = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: 0 },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: 834 },
  { id: 'mobile', label: 'Mobile', icon: Smartphone, width: 390 },
];

export interface PreviewPaneProps {
  url: string | null;
  status: 'idle' | 'starting' | 'running' | 'dead';
  onReload: () => void;
  onOpenExternal?: () => void;
  /** Ask Code Buddy to verify the running app (web_test): console/page errors,
   *  snapshot, screenshot, assertions. Wired to the agent session. */
  onVerify?: () => void;
  /** Start (or restart) the preview server — shown in the idle empty state. */
  onStart?: () => void;
}

function statusCopy(status: PreviewPaneProps['status'], unsafeUrl: boolean): { title: string; detail: string } {
  if (unsafeUrl) {
    return {
      title: 'Preview blocked',
      detail: 'Cowork only displays local previews served by the development server.',
    };
  }
  if (status === 'starting') {
    return { title: 'Server starting', detail: 'The preview will appear as soon as the server responds locally.' };
  }
  if (status === 'dead') {
    return { title: 'Server stopped', detail: 'Restart the server to restore the preview.' };
  }
  return { title: 'No preview', detail: 'Generate or start an app to show the result.' };
}

export function PreviewPane({ url, status, onReload, onOpenExternal, onVerify, onStart }: PreviewPaneProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const safeUrl = useMemo(() => (url && isLoopbackUrl(url) ? url : null), [url]);
  const unsafeUrl = Boolean(url && !safeUrl);
  const canRender = status === 'running' && safeUrl;
  const copy = statusCopy(status, unsafeUrl);
  const frameWidth = DEVICES.find((d) => d.id === device)?.width ?? 0;

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
          placeholder="Local preview"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground outline-none"
          aria-label="Preview URL"
        />
        <div className="flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="Preview size">
          {DEVICES.map((item) => {
            const Icon = item.icon;
            const selected = item.id === device;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setDevice(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-pressed={selected}
                className={`inline-flex h-7 w-7 items-center justify-center rounded ${selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleReload}
          disabled={!canRender}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title="Reload"
          aria-label="Reload preview"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
        {onOpenExternal && (
          <button
            type="button"
            onClick={onOpenExternal}
            disabled={!canRender}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="Open in browser"
            aria-label="Open in browser"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {onVerify && (
          <button
            type="button"
            onClick={onVerify}
            disabled={!canRender}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="Verify the app with Code Buddy (web_test)"
            aria-label="Verify the app with web_test"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Verify
          </button>
        )}
      </header>
      {canRender ? (
        <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-background p-2">
          <iframe
            key={`${safeUrl}-${reloadKey}`}
            src={safeUrl}
            title="App Studio Preview"
            sandbox="allow-scripts allow-same-origin"
            style={frameWidth > 0 ? { width: `${frameWidth}px` } : undefined}
            className={`min-h-0 border-0 bg-white ${frameWidth > 0 ? 'h-full shrink-0 rounded-md border border-border shadow-sm' : 'w-full flex-1'}`}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <ServerOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-medium text-foreground">{copy.title}</h3>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{copy.detail}</p>
          </div>
          {status === 'idle' && onStart && (
            <button
              type="button"
              onClick={onStart}
              className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-background hover:bg-accent-hover"
              data-testid="preview-start"
            >
              Start preview
            </button>
          )}
          {status === 'dead' && (
            <button
              type="button"
              onClick={onReload}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted"
            >
              Restart
            </button>
          )}
        </div>
      )}
    </section>
  );
}
