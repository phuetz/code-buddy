/**
 * ChannelsPanel — read-only view of the core ChannelManager's per-channel
 * connection status via the `channels.status` IPC. Configuring channels and
 * sending stay on the CLI / cron delivery layer; secrets are dropped
 * server-side. Mirrors the read-only DevicePanel pattern.
 *
 * @module renderer/components/ChannelsPanel
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Radio, RefreshCw, AlertCircle, Wifi, WifiOff, ShieldCheck, ShieldOff } from 'lucide-react';
import { useAppStore } from '../store';
import { EmptyState } from './LessonCandidatePanel';

interface ChannelStatus {
  type: string;
  connected: boolean;
  authenticated: boolean;
  lastActivity?: number;
  error?: string;
}

export function ChannelsPanel() {
  const show = useAppStore((s) => s.showChannelsPanel);
  const setShow = useAppStore((s) => s.setShowChannelsPanel);

  const [items, setItems] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await window.electronAPI.channels.status();
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? 'Failed to load channel status');
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
      data-testid="channels-panel"
    >
      <div className="flex h-full w-[560px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Delivery channels</h2>
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
          Read-only status. Configure channels and delivery from the CLI / cron layer.
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
              icon={<Radio className="w-8 h-8 text-text-muted" />}
              title={loading ? 'Loading…' : 'No channels configured'}
              hint="Configure delivery channels (Telegram/Discord/email…) from the CLI; cron jobs deliver through them."
            />
          ) : (
            items.map((c) => (
              <div key={c.type} className="rounded border border-border bg-surface/40 p-3 space-y-1" data-testid="channel-status">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {c.connected ? (
                      <Wifi className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <WifiOff className="w-3.5 h-3.5 text-text-muted" />
                    )}
                    <span className="text-xs font-medium text-text-primary capitalize">{c.type}</span>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-accent">
                    {c.authenticated ? <ShieldCheck className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                    {c.connected ? 'connected' : 'offline'}
                  </span>
                </div>
                {c.error && <div className="text-[10px] text-error">{c.error}</div>}
                <div className="text-[10px] text-text-muted">
                  Last activity: {c.lastActivity ? new Date(c.lastActivity).toLocaleString() : '—'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
