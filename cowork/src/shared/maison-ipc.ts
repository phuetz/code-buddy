export type MaisonDayKind = 'workday' | 'weekend' | 'holiday' | 'unknown';
export type MaisonPresenceState = 'present' | 'away' | 'unknown';
export type MaisonMode =
  | 'normal'
  | 'free-day'
  | 'focus'
  | 'rest'
  | 'cooking'
  | 'guests'
  | 'away'
  | 'silent';
export type MaisonDataStatus = 'ready' | 'loading' | 'offline' | 'unknown';
export type MaisonProvenanceKind =
  | 'manual'
  | 'calendar'
  | 'presence'
  | 'companion'
  | 'sensor'
  | 'derived'
  | 'unknown';

export interface MaisonDayContext {
  kind: MaisonDayKind;
  label?: string;
  holidayName?: string;
}

export interface MaisonPresence {
  state: MaisonPresenceState;
  displayName?: string;
  detail?: string;
}

export interface MaisonProvenance {
  kind: MaisonProvenanceKind;
  label?: string;
  observedAt?: number | string | null;
}

export type MaisonMealOrigin = 'manual' | 'leftovers' | 'recipe' | 'calendar' | 'unknown';

export interface MaisonMealPlan {
  title: string;
  whenLabel?: string;
  detail?: string;
  origin?: MaisonMealOrigin;
  state?: 'suggested' | 'planned';
}

export interface MaisonSnapshot {
  day?: MaisonDayContext;
  presence?: MaisonPresence;
  mode?: MaisonMode;
  provenance?: MaisonProvenance;
  nextMeal?: MaisonMealPlan | null;
}

export interface MaisonTimerSummary {
  id: string;
  label: string;
  dueAt: string;
  state: 'running' | 'due';
  remainingMs: number;
}

export interface MaisonSnapshotPayload {
  status: MaisonDataStatus;
  snapshot: MaisonSnapshot;
  activeTimers: MaisonTimerSummary[];
  foodProfile: {
    configured: boolean;
    constraintCount: number;
    unknownCount: number;
  };
  warnings: string[];
}

export interface MaisonModeInput {
  mode: MaisonMode;
  durationMs?: number;
}

export interface MaisonTimerStartInput {
  label: string;
  durationMs: number;
}

export interface MaisonRendererApi {
  snapshot: () => Promise<MaisonSnapshotPayload>;
  setMode: (input: MaisonModeInput) => Promise<MaisonSnapshotPayload>;
  timerStart: (input: MaisonTimerStartInput) => Promise<MaisonSnapshotPayload>;
  timerAcknowledge: (id: string) => Promise<MaisonSnapshotPayload>;
  timerCancel: (id: string) => Promise<MaisonSnapshotPayload>;
}
