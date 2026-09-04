/**
 * FleetPanel — multi-host Code Buddy listener UI (GAP 3).
 *
 * Displays peers (other Code Buddy instances on the Tailscale fleet) and
 * the live stream of `fleet:*` events they broadcast (tool starts/completes,
 * workflow progress, sub-agent spawns, presence heartbeats, compaction
 * notices). Backed by the FleetBridge in main/fleet/fleet-bridge.ts which
 * wraps the core FleetListener.
 *
 * @module cowork/renderer/components/FleetPanel
 */

import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Plus,
  RefreshCw,
  Trash2,
  Network,
  Wifi,
  WifiOff,
  CircleDot,
  AlertCircle,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { FleetPeer, FleetPeerStatus } from '../types';

const STATUS_TOKEN: Record<FleetPeerStatus, string> = {
  connecting: 'text-warning',
  connected: 'text-accent',
  authenticated: 'text-success',
  disconnected: 'text-text-muted',
  reconnecting: 'text-warning',
  error: 'text-error',
};

function StatusIcon({ status }: { status: FleetPeerStatus }) {
  const cls = STATUS_TOKEN[status] ?? 'text-text-muted';
  switch (status) {
    case 'authenticated':
    case 'connected':
      return <Wifi className={`w-3.5 h-3.5 ${cls}`} />;
    case 'connecting':
    case 'reconnecting':
      return <CircleDot className={`w-3.5 h-3.5 ${cls} animate-pulse`} />;
    case 'error':
      return <AlertCircle className={`w-3.5 h-3.5 ${cls}`} />;
    default:
      return <WifiOff className={`w-3.5 h-3.5 ${cls}`} />;
  }
}

function formatRelativeTime(ts: number | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function FleetPanel() {
  const show = useAppStore((s) => s.showFleetPanel);
  const setShow = useAppStore((s) => s.setShowFleetPanel);
  const peersMap = useAppStore((s) => s.fleetPeers);
  const events = useAppStore((s) => s.fleetEvents);
  const setFleetPeers = useAppStore((s) => s.setFleetPeers);
  const removeFleetPeer = useAppStore((s) => s.removeFleetPeer);
  const fleetDiscoveredPeers = useAppStore((s) => s.fleetDiscoveredPeers);
  const dismissFleetDiscoveredPeer = useAppStore((s) => s.dismissFleetDiscoveredPeer);

  const [showAdd, setShowAdd] = useState(false);
  const [filterPeer, setFilterPeer] = useState<string | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [addApiKey, setAddApiKey] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const fleetApi = window.electronAPI?.fleet;

  const peers = useMemo(() => Object.values(peersMap), [peersMap]);

  useEffect(() => {
    if (!show) return;
    if (!fleetApi) {
      setFleetPeers([]);
      return;
    }
    void fleetApi.list().then((list) => {
      setFleetPeers(
        list.map((p) => ({
          id: p.id,
          url: p.url,
          label: p.label,
          addedAt: p.addedAt,
          status: p.status as FleetPeerStatus,
          lastError: p.lastError,
          lastSeenAt: p.lastSeenAt,
          lastEventType: p.lastEventType,
          peerChatProvider: p.peerChatProvider as FleetPeer['peerChatProvider'],
          capability: p.capability as FleetPeer['capability'],
        }))
      );
    });
  }, [show, fleetApi, setFleetPeers]);

  const filteredEvents = useMemo(
    () => (filterPeer ? events.filter((e) => e.peerId === filterPeer) : events),
    [events, filterPeer]
  );

  if (!show) return null;

  const submitAdd = async () => {
    setAddError(null);
    if (!addUrl.trim()) {
      setAddError('URL required');
      return;
    }
    if (!addApiKey.trim()) {
      setAddError('API key required (must have fleet:listen and peer:invoke scopes)');
      return;
    }
    if (!fleetApi) {
      setAddError('Fleet bridge unavailable in browser preview. Open the desktop app to manage peers.');
      return;
    }
    const result = await fleetApi.addPeer({
      url: addUrl.trim(),
      apiKey: addApiKey.trim(),
      label: addLabel.trim() || undefined,
    });
    if (!result.success) {
      setAddError(result.error || 'Failed to add peer');
      return;
    }
    setAddUrl('');
    setAddApiKey('');
    setAddLabel('');
    setShowAdd(false);
  };

  const handleRemove = async (peerId: string) => {
    if (!fleetApi) return;
    await fleetApi.removePeer(peerId);
    removeFleetPeer(peerId);
    if (filterPeer === peerId) setFilterPeer(null);
  };

  const handleReconnect = async (peerId: string) => {
    if (!fleetApi) return;
    await fleetApi.reconnect(peerId);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm"
      data-testid="fleet-panel"
    >
      <div className="flex h-full w-[520px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              Fleet · Multi-host Code Buddy
            </h2>
          </div>
          <button
            onClick={() => setShow(false)}
            className="rounded p-1 hover:bg-surface transition-colors"
            aria-label="Close fleet panel"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="border-b border-border">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs uppercase tracking-wide text-text-muted">
              Peers ({peers.length})
            </span>
            <button
              onClick={() => setShowAdd((v) => !v)}
              data-testid="fleet-add-peer-button"
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add peer
            </button>
          </div>

          {showAdd && (
            <div className="space-y-2 border-t border-border px-4 py-3">
              <input
                type="text"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                data-testid="fleet-add-url-input"
                placeholder="ws://203.0.113.10:3000/ws"
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
              <input
                type="password"
                value={addApiKey}
                onChange={(e) => setAddApiKey(e.target.value)}
                data-testid="fleet-add-api-key-input"
                placeholder="API key (fleet:listen + peer:invoke)"
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                data-testid="fleet-add-label-input"
                placeholder="Label (optional, e.g. Linux hub)"
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              {addError && (
                <p className="text-xs text-error flex items-center gap-1" data-testid="fleet-add-error">
                  <AlertCircle className="w-3 h-3" />
                  {addError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAdd(false)}
                  className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitAdd}
                  data-testid="fleet-add-connect-button"
                  className="rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
                >
                  Connect
                </button>
              </div>
            </div>
          )}

          <ul className="max-h-64 overflow-y-auto">
            {peers.length === 0 && (
              <li className="px-4 py-3 text-xs text-text-muted">
                {fleetApi
                  ? (
                    <>
                      No peers configured. Add a Code Buddy instance running on your Tailscale mesh
                      (e.g. <code className="font-mono text-text-secondary">ws://203.0.113.10:3000/ws</code>)
                      with a key scoped for fleet:listen and peer:invoke.
                    </>
                  )
                  : 'Fleet bridge unavailable in browser preview. Open the desktop app to connect peers.'}
              </li>
            )}
            {peers.map((peer) => {
              const isActive = filterPeer === peer.id;
              return (
                <li
                  key={peer.id}
                  className={`flex items-center gap-2 px-4 py-2 text-xs ${
                    isActive ? 'bg-accent/10' : ''
                  } hover:bg-surface transition-colors`}
                >
                  <button
                    onClick={() => setFilterPeer(isActive ? null : peer.id)}
                    className="flex flex-1 items-center gap-2 text-left min-w-0"
                  >
                    <StatusIcon status={peer.status} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-text-primary truncate">
                        {peer.label || peer.id}
                      </div>
                      <div className="truncate text-[10px] text-text-muted font-mono">
                        {peer.url}
                      </div>
                      {peer.lastError && (
                        <div className="truncate text-[10px] text-error">{peer.lastError}</div>
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted shrink-0">
                      {formatRelativeTime(peer.lastSeenAt)}
                    </span>
                  </button>
                  <button
                    onClick={() => handleReconnect(peer.id)}
                    className="rounded p-1 hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
                    title="Reconnect"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleRemove(peer.id)}
                    className="rounded p-1 hover:bg-surface text-text-muted hover:text-error transition-colors"
                    title="Remove peer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>

          {fleetDiscoveredPeers.length > 0 && (
            <div className="border-t border-border">
              <div className="flex items-center justify-between px-4 py-2 bg-surface-secondary/40">
                <span className="text-xs uppercase tracking-wide text-text-muted">
                  Discovered on Tailscale ({fleetDiscoveredPeers.length})
                </span>
              </div>
              <ul className="max-h-48 overflow-y-auto border-b border-border">
                {fleetDiscoveredPeers.map((dp) => (
                  <li
                    key={dp.url}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-xs hover:bg-surface transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-text-primary truncate">
                        {dp.label}
                      </div>
                      <div className="truncate text-[10px] text-text-muted font-mono">
                        {dp.url}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          setAddUrl(dp.url);
                          setAddLabel(dp.label);
                          setAddApiKey(dp.apiKey || '');
                          setShowAdd(true);
                        }}
                        className="flex items-center gap-1 rounded bg-accent/20 hover:bg-accent/35 text-accent px-2 py-0.5 text-[10px] font-medium transition-colors"
                        title="Pair discovered peer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Pair</span>
                      </button>
                      <button
                        onClick={() => dismissFleetDiscoveredPeer(dp.url)}
                        className="rounded p-1 hover:bg-surface text-text-muted hover:text-error transition-colors"
                        title="Dismiss"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-xs uppercase tracking-wide text-text-muted">
              Events {filterPeer ? `· ${peersMap[filterPeer]?.label || filterPeer}` : '· all'}
              {filteredEvents.length > 0 && ` (${filteredEvents.length})`}
            </span>
            {filterPeer && (
              <button
                onClick={() => setFilterPeer(null)}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                Clear filter
              </button>
            )}
          </div>
          <ul className="flex-1 overflow-y-auto font-mono text-[11px]">
            {filteredEvents.length === 0 && (
              <li className="px-4 py-3 text-text-muted">
                No events yet. Trigger activity on a peer to see it here.
              </li>
            )}
            {filteredEvents
              .slice()
              .reverse()
              .map((event, idx) => (
                <li
                  key={`${event.peerId}-${event.receivedAt}-${idx}`}
                  className="border-b border-border px-4 py-1.5"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-text-muted">
                      {new Date(event.receivedAt).toLocaleTimeString()}
                    </span>
                    <span className="font-semibold text-accent">{event.type}</span>
                    {event.hostname && (
                      <span className="text-text-muted">@{event.hostname}</span>
                    )}
                  </div>
                  {Object.keys(event.payload).length > 0 && (
                    <pre className="ml-4 mt-0.5 overflow-x-auto whitespace-pre-wrap break-all text-text-secondary">
                      {JSON.stringify(
                        Object.fromEntries(
                          Object.entries(event.payload).filter(([k]) => k !== 'source')
                        )
                      )}
                    </pre>
                  )}
                </li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
