/**
 * DevicePanel — C3. Read-only view of paired device nodes (SSH/ADB/local) via
 * the `deviceNodes.list` IPC (core DeviceNodeManager). Pairing/removal stay on
 * the CLI (`buddy device`); secrets are redacted server-side.
 *
 * @module renderer/components/DevicePanel
 */

import { useCallback, useEffect, useState } from 'react';
import { X, MonitorSmartphone, RefreshCw, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { useAppStore } from '../store';
import { EmptyState } from './LessonCandidatePanel';

interface DeviceNode {
  id: string;
  name: string;
  type: string;
  transportType: string;
  capabilities: string[];
  paired: boolean;
  lastSeen: number;
  address?: string;
  port?: number;
  username?: string;
}

export function DevicePanel() {
  const show = useAppStore((s) => s.showDevicePanel);
  const setShow = useAppStore((s) => s.setShowDevicePanel);

  const [items, setItems] = useState<DeviceNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await window.electronAPI.deviceNodes.list();
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? 'Failed to load devices');
      setItems([]);
      return;
    }
    setItems(res.items);
  }, []);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm"
      data-testid="device-panel"
    >
      <div className="flex h-full w-[560px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MonitorSmartphone className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Paired devices</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => void refresh()} className="rounded p-1 hover:bg-surface" title="Refresh">
              <RefreshCw className={`w-4 h-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => setShow(false)} className="rounded p-1 hover:bg-surface" aria-label="Close">
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        <div className="border-b border-border px-4 py-2 text-[11px] text-text-muted">
          Read-only. Pair or remove devices from the CLI: <code>buddy device pair</code>.
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-1.5 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {items.length === 0 ? (
            <EmptyState
              icon={<MonitorSmartphone className="w-8 h-8 text-text-muted" />}
              title={loading ? 'Loading…' : 'No paired devices'}
              hint="Pair a device with `buddy device pair --id … --transport ssh|adb|local`."
            />
          ) : (
            items.map((d) => (
              <div key={d.id} className="rounded border border-border bg-surface/40 p-3 space-y-1" data-testid="device-node">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {d.paired ? (
                      <Wifi className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <WifiOff className="w-3.5 h-3.5 text-text-muted" />
                    )}
                    <span className="text-xs font-medium text-text-primary">{d.name}</span>
                    <span className="text-[10px] text-text-muted">{d.id}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-accent">
                    {d.type} · {d.transportType}
                  </span>
                </div>
                {(d.address || d.username) && (
                  <div className="text-[10px] text-text-muted">
                    {d.username ? `${d.username}@` : ''}
                    {d.address ?? ''}
                    {d.port ? `:${d.port}` : ''}
                  </div>
                )}
                <div className="text-[10px] text-text-muted">
                  Capabilities: {d.capabilities.length ? d.capabilities.join(', ') : 'none detected'}
                </div>
                <div className="text-[10px] text-text-muted">
                  Last seen: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
