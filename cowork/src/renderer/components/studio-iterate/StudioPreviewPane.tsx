import { useCallback, useEffect, useRef, useState } from 'react';
import { PreviewToolbar } from './PreviewToolbar.js';
import type { PreviewDevice, PreviewStatus } from './iterate-model.js';
import {
  canRenderWebview,
  detectDevCommand,
  frameWidth,
  pickInstance,
  statusFromInstance,
} from './studio-preview-model.js';
import type { AppStudioApis } from '../studio/studio-api.js';

interface StudioPreviewPaneProps {
  /** Studio bridge (dev-server + files). Undefined outside Electron → disabled. */
  apis: AppStudioApis | undefined;
  /** Project directory whose dev server this pane owns. */
  cwd: string;
  className?: string;
}

/**
 * The bolt.new "test the generated app" surface: starts the project's dev server
 * (inferring the command from its package.json), renders it live in a sandboxed
 * <webview>, and drives it with the real PreviewToolbar (reload / device / stop).
 * Never throws — every IPC failure surfaces as an error line, not a crash.
 */
export function StudioPreviewPane({ apis, cwd, className }: StudioPreviewPaneProps) {
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [pid, setPid] = useState<number | null>(null);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // Adopt an already-running dev server for this cwd on mount / cwd change.
  useEffect(() => {
    if (!apis || !cwd) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apis.devServer.status();
        if (cancelled || !res.ok) return;
        const inst = pickInstance(res.data, cwd);
        if (inst) {
          setUrl(inst.url);
          setPid(inst.pid);
          setStatus(statusFromInstance(inst, false));
        }
      } catch {
        /* status probe is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apis, cwd]);

  const start = useCallback(async () => {
    if (!apis || !cwd) return;
    setError(null);
    setStatus('starting');
    let cmd = detectDevCommand(null);
    try {
      const pkg = await apis.files.read(cwd, 'package.json');
      if (pkg.ok) cmd = detectDevCommand(JSON.parse(pkg.data.content));
    } catch {
      /* fall back to Vite defaults */
    }
    try {
      const res = await apis.devServer.start({ cwd, command: cmd.command, url: cmd.url });
      if (!res.ok) {
        setStatus('dead');
        setError(res.error || 'The dev server did not start.');
        return;
      }
      setUrl(res.data.url);
      setPid(res.data.pid);
      setStatus('running');
    } catch (err) {
      setStatus('dead');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apis, cwd]);

  const stop = useCallback(async () => {
    if (apis && pid != null) {
      try {
        await apis.devServer.stop(pid);
      } catch {
        /* stopping is best-effort */
      }
    }
    setPid(null);
    setStatus('idle');
  }, [apis, pid]);

  const onToggle = useCallback(() => {
    if (status === 'running' || status === 'starting') void stop();
    else void start();
  }, [status, start, stop]);

  const onReload = useCallback(() => {
    const el = frameRef.current?.querySelector('webview') as
      | (HTMLElement & { reload?: () => void })
      | null;
    el?.reload?.();
  }, []);

  const onOpenExternal = useCallback(() => {
    if (url && window.electronAPI?.openExternal) void window.electronAPI.openExternal(url);
  }, [url]);

  const showWebview = canRenderWebview(status, url);
  const width = frameWidth(device);

  return (
    <div className={`flex h-full min-h-0 flex-col gap-2 ${className ?? ''}`} data-testid="studio-preview-pane">
      <PreviewToolbar
        url={url}
        status={status}
        device={device}
        onToggle={onToggle}
        onDevice={setDevice}
        onReload={onReload}
        onOpenExternal={onOpenExternal}
      />

      <div
        ref={frameRef}
        className="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-lg border border-border bg-surface"
      >
        {showWebview ? (
          <webview
            src={url}
            className="h-full bg-white"
            style={{ width: width > 0 ? `${width}px` : '100%' }}
            partition="persist:studio-preview"
            webpreferences="contextIsolation=yes, sandbox=yes"
          />
        ) : (
          <div className="m-auto max-w-sm p-6 text-center">
            {status === 'starting' ? (
              <p className="text-sm text-muted-foreground">Starting the dev server…</p>
            ) : status === 'dead' ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-500">The dev server failed.</p>
                {error ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-left text-xs text-muted-foreground">
                    {error}
                  </pre>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Live preview</p>
                <p className="text-xs text-muted-foreground">
                  Start the preview to test the generated app and see your changes live.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
