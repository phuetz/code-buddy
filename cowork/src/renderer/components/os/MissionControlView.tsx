/**
 * MissionControlView — the Mission Control OS cockpit as a full-screen primaryView.
 *
 * Composes the dormant OS views (fleet topology, fleet load, council arena, peer
 * capability matrix) plus one interactive control (autonomy posture) into a single
 * calm cockpit. Every view is props-driven and renders its own honest empty state,
 * so with no `buddy server` running the cockpit shows "start buddy server to
 * populate" rather than fake data.
 *
 * This step is presentation-only: it passes static empty/default props (no IPC).
 * Live fleet/council/autonomy data + real action callbacks are a later wiring step
 * (see cowork/src/renderer/components/os-actions/os-actions-wiring.ts for the
 * callback contract). The interactive control's callbacks are no-ops for now.
 */
import { AutonomyControlPanel, type AutonomyControlState } from '../os-actions/AutonomyControlPanel';
import { CouncilArenaView } from './CouncilArenaView';
import { FleetLoadStrip } from './FleetLoadStrip';
import { FleetTopologyView } from './FleetTopologyView';
import { PeerCapabilityMatrix } from './PeerCapabilityMatrix';
import type { CouncilSession } from './util/council-model';
import type { FleetLoad } from './util/fleet-load-model';
import type { Peer } from './util/fleet-model';

// Static empty/default props — the cockpit renders its honest empty state until a
// running buddy server feeds live data through a future IPC bridge.
const EMPTY_PEERS: Peer[] = [];
const EMPTY_CAPABILITIES: string[] = [];
const EMPTY_LOAD: FleetLoad = { queued: 0, running: 0, capacity: 0, backpressure: 0, utilization: 0 };
const EMPTY_COUNCIL: CouncilSession = { id: 'council', title: 'Council', dhi: 0, verdicts: [] };
const DEFAULT_AUTONOMY: AutonomyControlState = { posture: 'plan', daemonPaused: true, costCapUsd: 10 };

export function MissionControlView() {
  // TODO(os-wiring): replace no-op callbacks with real IPC-backed actions
  // (posture change / daemon pause / cost cap) once the OS action bridge lands.
  const noop = () => {};

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold text-foreground">Mission Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cockpit de la flotte, du council et de l'autonomie. Lance <code className="rounded bg-muted px-1 py-0.5 text-xs">buddy server</code> pour alimenter les vues avec des données réelles.
          </p>
        </header>

        <FleetLoadStrip load={EMPTY_LOAD} />

        <FleetTopologyView peers={EMPTY_PEERS} />

        <div className="grid gap-6 xl:grid-cols-2">
          <CouncilArenaView session={EMPTY_COUNCIL} />
          <PeerCapabilityMatrix peers={EMPTY_PEERS} capabilities={EMPTY_CAPABILITIES} />
        </div>

        <AutonomyControlPanel
          state={DEFAULT_AUTONOMY}
          onPostureChange={noop}
          onDaemonPause={noop}
          onDaemonResume={noop}
          onCostCapChange={noop}
        />
      </div>
    </div>
  );
}
