import { Check, Grid3X3, Minus } from 'lucide-react';

import { EmptyState } from '../ui/EmptyState.js';
import { Pill } from '../ui/Pill.js';
import { SectionCard } from '../ui/SectionCard.js';
import type { Peer } from './util/fleet-model.js';
import { buildMatrix, coverageOf } from './util/capability-matrix.js';

export interface PeerCapabilityMatrixProps {
  peers: Peer[];
  capabilities: string[];
}

export function PeerCapabilityMatrix({ peers, capabilities }: PeerCapabilityMatrixProps) {
  if (peers.length === 0 || capabilities.length === 0) {
    return (
      <EmptyState
        icon={<Grid3X3 className="h-6 w-6" />}
        title="Matrice vide"
        hint="Aucun pair ou aucune capacité n'a encore été publié par la flotte."
      />
    );
  }

  const matrix = buildMatrix(peers, capabilities);

  return (
    <SectionCard title="Matrice de capacités" description="Quels pairs exposent quels modèles, outils et rôles opérationnels.">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="sticky left-0 bg-surface p-2">Pair</th>
              {capabilities.map((capability) => (
                <th key={capability} className="p-2 text-center font-medium">
                  <div>{capability}</div>
                  <div className="mt-1 tabular-nums">{Math.round(coverageOf(capability, peers) * 100)}%</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {peers.map((peer, rowIndex) => (
              <tr key={peer.id} className="border-b border-border/60">
                <td className="sticky left-0 bg-surface p-2">
                  <div className="font-medium text-foreground">{peer.label}</div>
                  <Pill tone={peer.status === 'offline' ? 'danger' : peer.status === 'busy' ? 'warning' : 'success'}>{peer.role}</Pill>
                </td>
                {matrix[rowIndex]?.map((cell) => (
                  <td key={cell.capability} className="p-2 text-center">
                    <span className={cell.available ? 'inline-flex rounded-full bg-emerald-500/15 p-1 text-emerald-600' : 'inline-flex rounded-full bg-muted p-1 text-muted-foreground'}>
                      {cell.available ? <Check className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </span>
                    {cell.available && <div className="mt-1 text-[10px] text-muted-foreground">{cell.source}</div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
