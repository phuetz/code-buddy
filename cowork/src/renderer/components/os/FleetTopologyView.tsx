import { Activity, CircleDot, Network } from 'lucide-react';

import { EmptyState } from '../ui/EmptyState.js';
import { Pill } from '../ui/Pill.js';
import { SectionCard } from '../ui/SectionCard.js';
import { StatTile } from '../ui/StatTile.js';
import { QUIET_PEER_HINT, summarizeFleet, utilizationTone, type Peer } from './util/fleet-model.js';

export interface FleetTopologyViewProps {
  peers: Peer[];
  onSelect?: (peer: Peer) => void;
}

const toneClass = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  critical: 'bg-red-500',
};

function statusTone(status: Peer['status']) {
  if (status === 'offline') {
    return 'danger' as const;
  }
  if (status === 'busy') {
    return 'warning' as const;
  }
  return 'success' as const;
}

export function FleetTopologyView({ peers, onSelect }: FleetTopologyViewProps) {
  const summary = summarizeFleet(peers);

  if (peers.length === 0) {
    return (
      <EmptyState
        icon={<Network className="h-6 w-6" />}
        title="Aucun pair détecté"
        hint="Lance buddy server pour alimenter la topologie de flotte."
      />
    );
  }

  return (
    <SectionCard title="Topologie de flotte" description="Pairs connectés, latence, rôle et saturation instantanée.">
      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label="En ligne" value={summary.online} tone="success" />
        <StatTile label="Occupés" value={summary.busy} tone="warning" />
        <StatTile label="Hors ligne" value={summary.offline} tone={summary.offline > 0 ? 'danger' : 'default'} />
        <StatTile label="Latence moyenne" value={String(summary.avgLatency) + ' ms'} hint="pairs mesurés" />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {peers.map((peer) => {
          const utilization = Math.max(0, Math.min(1, peer.utilization));
          const tone = utilizationTone(utilization);
          return (
            <button
              key={peer.id}
              type="button"
              onClick={() => onSelect?.(peer)}
              className="rounded-xl border border-border bg-background p-3 text-left transition hover:bg-muted"
              data-testid={`os-topology-peer-${peer.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CircleDot className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{peer.label}</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{peer.role}</p>
                </div>
                <div className="flex items-center gap-1">
                  {peer.quiet && (
                    <span
                      title={QUIET_PEER_HINT}
                      data-testid="os-peer-quiet"
                      data-peer-id={peer.id}
                    >
                      <Pill tone="default">silencieux</Pill>
                    </span>
                  )}
                  <Pill tone={statusTone(peer.status)}>{peer.status}</Pill>
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-muted">
                <div className={'h-2 rounded-full ' + toneClass[tone]} style={{ width: String(utilization * 100) + '%' }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" />{Math.round(utilization * 100)}%</span>
                <span>{peer.latencyMs ?? 0} ms</span>
              </div>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}
