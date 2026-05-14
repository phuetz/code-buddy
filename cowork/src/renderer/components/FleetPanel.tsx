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
  KeyRound,
  Copy,
  Check,
  Search,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { FleetPeerStatus } from '../types';

const STATUS_TOKEN: Record<FleetPeerStatus, string> = {
  connecting: 'text-warning',
  connected: 'text-accent',
  authenticated: 'text-success',
  disconnected: 'text-text-muted',
  reconnecting: 'text-warning',
  error: 'text-error',
};

interface DiscoveredFleetPeer {
  label: string;
  url: string;
  source: 'tailscale' | 'manual';
  apiKey?: string;
}

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
  const discoveredPeers = useAppStore((s) => s.fleetDiscoveredPeers);
  const setFleetDiscoveredPeers = useAppStore((s) => s.setFleetDiscoveredPeers);
  const dismissFleetDiscoveredPeer = useAppStore((s) => s.dismissFleetDiscoveredPeer);

  const [showAdd, setShowAdd] = useState(false);
  const [filterPeer, setFilterPeer] = useState<string | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [addApiKey, setAddApiKey] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [localKey, setLocalKey] = useState<string | null>(null);
  const [localKeyError, setLocalKeyError] = useState<string | null>(null);
  const [localKeyBusy, setLocalKeyBusy] = useState(false);
  const [localKeyCopied, setLocalKeyCopied] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverNotice, setDiscoverNotice] = useState<{
    kind: 'info' | 'error';
    text: string;
  } | null>(null);

  const peers = useMemo(() => Object.values(peersMap), [peersMap]);

  useEffect(() => {
    if (!show) return;
    void window.electronAPI.fleet.list().then((list) => {
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
          capability: p.capability,
        }))
      );
    });
  }, [show, setFleetPeers]);

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
      setAddError('API key required (must have fleet:listen scope)');
      return;
    }
    const result = await window.electronAPI.fleet.addPeer({
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
    await window.electronAPI.fleet.removePeer(peerId);
    removeFleetPeer(peerId);
    if (filterPeer === peerId) setFilterPeer(null);
  };

  const handleReconnect = async (peerId: string) => {
    await window.electronAPI.fleet.reconnect(peerId);
  };

  const runDiscovery = async () => {
    if (discovering) return;
    setDiscovering(true);
    setDiscoverNotice(null);
    try {
      const result = await window.electronAPI.fleet.discoverPeers();
      if (!result.ok) {
        setDiscoverNotice({ kind: 'error', text: result.error || 'Discovery failed' });
        return;
      }
      setFleetDiscoveredPeers(result.peers);
      if (result.peers.length === 0) {
        setDiscoverNotice({ kind: 'info', text: 'No new peers found' });
      }
    } catch (err) {
      setDiscoverNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDiscovering(false);
    }
  };

  const connectDiscoveredPeer = async (peer: DiscoveredFleetPeer) => {
    if (!peer.apiKey?.trim()) {
      setAddUrl(peer.url);
      setAddLabel(peer.label);
      setShowAdd(true);
      setAddError('API key required');
      return;
    }

    const result = await window.electronAPI.fleet.addPeer({
      url: peer.url,
      apiKey: peer.apiKey,
      label: peer.label,
    });
    if (!result.success) {
      setDiscoverNotice({ kind: 'error', text: result.error || 'Failed to add peer' });
      return;
    }
    dismissFleetDiscoveredPeer(peer.url);
  };

  const createLocalKey = async () => {
    if (localKeyBusy) return;
    setLocalKeyBusy(true);
    setLocalKeyError(null);
    setLocalKey(null);
    setLocalKeyCopied(false);
    try {
      const result = await window.electronAPI.fleet.createApiKey({
        name: 'Cowork Fleet key',
        userId: 'local',
        scopes: ['fleet:listen', 'peer:invoke'],
      });
      if (!result.ok || !result.key) {
        setLocalKeyError(result.error || 'Failed to create key');
        return;
      }
      setLocalKey(result.key);
    } catch (err) {
      setLocalKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalKeyBusy(false);
    }
  };

  const copyLocalKey = async () => {
    if (!localKey) return;
    await navigator.clipboard.writeText(localKey);
    setLocalKeyCopied(true);
    window.setTimeout(() => setLocalKeyCopied(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm">
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
            <div className="flex items-center gap-1.5">
              <button
                onClick={runDiscovery}
                disabled={discovering}
                className="rounded p-1.5 text-text-muted hover:bg-surface hover:text-text-primary disabled:opacity-50 transition-colors"
                title="Discover Fleet peers"
                aria-label="Discover Fleet peers"
              >
                <Search className={`w-3.5 h-3.5 ${discovering ? 'animate-pulse' : ''}`} />
              </button>
              <button
                onClick={createLocalKey}
                disabled={localKeyBusy}
                className="rounded p-1.5 text-text-muted hover:bg-surface hover:text-text-primary disabled:opacity-50 transition-colors"
                title="Create local Fleet key"
                aria-label="Create local Fleet key"
              >
                <KeyRound className={`w-3.5 h-3.5 ${localKeyBusy ? 'animate-pulse' : ''}`} />
              </button>
              <button
                onClick={() => setShowAdd((v) => !v)}
                className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add peer
              </button>
            </div>
          </div>

          {(localKey || localKeyError) && (
            <div className="border-t border-border px-4 py-2">
              {localKey ? (
                <div className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <code className="min-w-0 flex-1 truncate font-mono text-text-secondary">
                    {localKey}
                  </code>
                  <button
                    onClick={copyLocalKey}
                    className="rounded p-1 text-text-muted hover:bg-background-secondary hover:text-text-primary transition-colors"
                    title={localKeyCopied ? 'Copied' : 'Copy'}
                    aria-label={localKeyCopied ? 'Copied' : 'Copy'}
                  >
                    {localKeyCopied ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ) : (
                <p className="flex items-center gap-1 text-xs text-error">
                  <AlertCircle className="h-3 w-3" />
                  {localKeyError}
                </p>
              )}
            </div>
          )}

          {(discoveredPeers.length > 0 || discoverNotice) && (
            <div className="border-t border-border px-4 py-2">
              {discoverNotice && (
                <p
                  className={`mb-2 flex items-center gap-1 text-xs ${
                    discoverNotice.kind === 'error' ? 'text-error' : 'text-text-muted'
                  }`}
                >
                  <AlertCircle className="h-3 w-3" />
                  {discoverNotice.text}
                </p>
              )}
              {discoveredPeers.length > 0 && (
                <ul className="space-y-1">
                  {discoveredPeers.map((peer) => (
                    <li
                      key={peer.url}
                      className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-text-primary">
                            {peer.label}
                          </span>
                          <span className="shrink-0 rounded bg-background-secondary px-1.5 py-0.5 text-[10px] text-text-muted">
                            {peer.source}
                          </span>
                        </div>
                        <div className="truncate font-mono text-[10px] text-text-muted">
                          {peer.url}
                        </div>
                      </div>
                      <button
                        onClick={() => void connectDiscoveredPeer(peer)}
                        className="rounded p-1 text-text-muted hover:bg-background-secondary hover:text-text-primary transition-colors"
                        title={peer.apiKey ? 'Add peer' : 'Use in add form'}
                        aria-label={peer.apiKey ? 'Add peer' : 'Use in add form'}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => dismissFleetDiscoveredPeer(peer.url)}
                        className="rounded p-1 text-text-muted hover:bg-background-secondary hover:text-error transition-colors"
                        title="Dismiss"
                        aria-label="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {showAdd && (
            <div className="space-y-2 border-t border-border px-4 py-3">
              <input
                type="text"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="ws://100.98.18.76:3000/ws"
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
              <input
                type="password"
                value={addApiKey}
                onChange={(e) => setAddApiKey(e.target.value)}
                placeholder="API key (with fleet:listen scope)"
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="Label (optional, e.g. Ministar Linux)"
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              {addError && (
                <p className="text-xs text-error flex items-center gap-1">
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
                No peers configured. Add a Code Buddy instance running on your Tailscale mesh
                (e.g. <code className="font-mono text-text-secondary">ws://100.98.18.76:3000/ws</code>).
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
