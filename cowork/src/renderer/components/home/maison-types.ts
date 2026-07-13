import type {
  MaisonDataStatus,
  MaisonMode,
  MaisonSnapshot,
} from '../../../shared/maison-ipc.js';

export type {
  MaisonDataStatus,
  MaisonDayContext,
  MaisonDayKind,
  MaisonMealOrigin,
  MaisonMealPlan,
  MaisonMode,
  MaisonPresence,
  MaisonPresenceState,
  MaisonProvenance,
  MaisonProvenanceKind,
  MaisonSnapshot,
} from '../../../shared/maison-ipc.js';

export interface MaisonCardProps {
  snapshot?: MaisonSnapshot | null;
  /** When omitted, a snapshot means ready and no snapshot means unknown. */
  status?: MaisonDataStatus;
  /** Timestamp seam for deterministic freshness labels and tests. */
  now?: number;
  /** Restrict the change-mode menu without changing the central mode registry. */
  modeOptions?: readonly MaisonMode[];
  className?: string;
  onModeChange: (mode: MaisonMode) => void;
  onSilenceChange: (silent: boolean) => void;
  onStartCooking: () => void;
  onGuestsChange: (enabled: boolean) => void;
  onRefresh?: () => void;
}
