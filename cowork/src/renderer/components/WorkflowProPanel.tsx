import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, RefreshCw, Server, AlertTriangle } from 'lucide-react';

export const WorkflowProPanel: React.FC = () => {
  const [status, setStatus] = useState<{ running: boolean; port: number; url?: string; managed?: boolean; external?: boolean; starting?: boolean; embeddable?: boolean; error?: string }>({ running: false, port: 8080 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootLog, setBootLog] = useState<string[]>([]);

  const mounted = useRef(false);
  const statusRequest = useRef(0);

  const checkStatus = useCallback(async () => {
    const request = ++statusRequest.current;
    try {
      const s = await window.electronAPI.workflowBuilder.status();
      if (mounted.current && request === statusRequest.current) setStatus(s);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => { mounted.current = false; clearInterval(interval); };
  }, [checkStatus]);

  // While starting, poll the server's boot log so the panel streams progress
  // (npm boot lines) instead of a blind "Starting…" spinner.
  useEffect(() => {
    if (!loading || !window.electronAPI.workflowBuilder.logs) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await window.electronAPI.workflowBuilder.logs(50);
        if (!cancelled) setBootLog(res.lines);
      } catch {
        // ignore transient errors
      }
    };
    poll();
    const interval = setInterval(poll, 600);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loading]);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    setBootLog([]);
    try {
      const res = await window.electronAPI.workflowBuilder.start();
      if (!res.success) setError(res.error || 'Failed to start WorkflowBuilder');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      checkStatus();
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.workflowBuilder.stop();
      if (!result.success) setError(result.error || 'Failed to stop WorkflowBuilder');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      checkStatus();
    }
  };

  const openInBrowser = async () => {
    try {
      const url = new URL(status.url || `http://localhost:${status.port}`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Invalid WorkflowBuilder URL');
      }
      const opened = await window.electronAPI.openExternal(url.href);
      if (opened === false) setError('Could not open WorkflowBuilder in your browser');
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-surface">
      <div className="flex items-center justify-between p-2 bg-surface-hover border-b border-border">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">WorkflowBuilder Pro</h2>
          {status.running ? (
            <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Running (Port {status.port})
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              Stopped
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(error || status.error) && (
            <span className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {error || status.error}
            </span>
          )}
          {!status.running && status.managed !== true ? (
            <button
              onClick={handleStart}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {loading ? 'Connecting...' : status.external ? 'Connect' : 'Start Server'}
            </button>
          ) : status.managed === false ? (
            <span className="text-xs text-text-secondary">Externally managed</span>
          ) : (
            <button
              onClick={handleStop}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-surface-hover text-text-primary rounded hover:bg-surface-active disabled:opacity-50 transition-colors"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
              Stop
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 relative bg-surface-active">
        {status.running && status.embeddable === false ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-secondary p-6">
            <p>WorkflowBuilder is ready. Its security policy prevents embedding in Cowork.</p>
            <p className="text-sm break-all">{status.url}</p>
            <button onClick={openInBrowser} className="px-4 py-2 rounded bg-accent text-white">Open in browser</button>
          </div>
        ) : status.running ? (
          <iframe
            src={status.url || `http://localhost:${status.port}`}
            className="absolute inset-0 w-full h-full border-none bg-surface"
            title="WorkflowBuilder Pro"
            // Untrusted self-hosted server content: run it sandboxed (scripts +
            // same-origin so the editor still works) and drop the clipboard grant.
            sandbox="allow-scripts allow-same-origin"
          />
        ) : loading && bootLog.length > 0 ? (
          <div className="absolute inset-0 flex flex-col p-4" data-testid="workflow-boot-log">
            <div className="flex items-center gap-2 mb-2 text-text-secondary text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Starting WorkflowBuilder…
            </div>
            <pre className="flex-1 overflow-auto text-[11px] font-mono text-text-muted bg-surface rounded-md border border-border p-2 whitespace-pre-wrap break-words">
              {bootLog.join('\n')}
            </pre>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <Server className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">WorkflowBuilder Pro is not running</p>
            <p className="text-sm mt-2">{status.external ? 'The configured editor must be started by its own service manager.' : 'Click "Start Server" to launch the self-hosted visual workflow editor.'}</p>
            {status.url && <p className="text-sm mt-2">{status.url}</p>}
            <p className="text-xs mt-2">Set CODEBUDDY_WORKFLOW_URL to connect to an existing WorkflowBuilder.</p>
          </div>
        )}
      </div>
    </div>
  );
};
