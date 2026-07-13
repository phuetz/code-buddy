/**
 * Shared contracts for Code Buddy Maison's daily rhythm.
 *
 * Calendar facts, household intent and sensed presence deliberately remain
 * separate. A public holiday does not imply that anybody is home, and an
 * `away` home mode is an explicit posture rather than a presence inference.
 */

export const HOME_MODES = [
  'normal',
  'free-day',
  'focus',
  'rest',
  'cooking',
  'guests',
  'away',
  'silent',
] as const;

export type HomeMode = (typeof HOME_MODES)[number];

export type HomeModeSource = 'default' | 'stored' | 'expired';

export interface HomeModeState {
  mode: HomeMode;
  setAt: string;
  expiresAt?: string;
  source: HomeModeSource;
  /** Present only when an expired posture was reset to `normal`. */
  previousMode?: HomeMode;
}

export type DayKind = 'workday' | 'weekend' | 'public_holiday' | 'unknown';

export type PresenceStatus = 'home' | 'away' | 'unknown';

export type PresenceSource =
  | 'manual'
  | 'camera'
  | 'home-assistant'
  | 'device'
  | 'none';

/**
 * A factual, independently sourced presence observation. It must never be
 * derived from `HomeModeState.mode`.
 */
export interface PresenceSnapshot {
  status: PresenceStatus;
  source: PresenceSource;
  observedAt?: string;
  confidence?: number;
}

export const ETALAB_HOLIDAY_ZONES = [
  'alsace-moselle',
  'guadeloupe',
  'guyane',
  'la-reunion',
  'martinique',
  'mayotte',
  'metropole',
  'nouvelle-caledonie',
  'polynesie-francaise',
  'saint-barthelemy',
  'saint-martin',
  'saint-pierre-et-miquelon',
  'wallis-et-futuna',
] as const;

export type EtalabHolidayZone = (typeof ETALAB_HOLIDAY_ZONES)[number];

export interface PublicHoliday {
  date: string;
  name: string;
  zone: EtalabHolidayZone;
}

export type HolidayResultSource = 'network' | 'cache' | 'unavailable';
export type HolidayFreshness = 'fresh' | 'stale' | 'unavailable';

export interface HolidayProvenance {
  provider: 'etalab-calendrier-api-gouv-fr' | 'none';
  source: HolidayResultSource;
  freshness: HolidayFreshness;
  checkedAt: string;
  year: number;
  zone?: EtalabHolidayZone;
  endpoint?: string;
  fetchedAt?: string;
  ageMs?: number;
  cacheTtlMs?: number;
}

export interface HolidayYearResult {
  available: boolean;
  holidays: PublicHoliday[];
  provenance: HolidayProvenance;
  /** Network/cache failure detail. Data can still be available from stale cache. */
  error?: string;
}

export interface HolidayLookupResult {
  date: string;
  available: boolean;
  holiday: PublicHoliday | null;
  provenance: HolidayProvenance;
  error?: string;
}

export interface PublicHolidayProvider {
  lookup(date: string): Promise<HolidayLookupResult>;
}

export interface DayContext {
  schemaVersion: 1;
  instant: string;
  timeZone: string;
  localDate: string;
  localTime: string;
  /** JavaScript convention: 0=Sunday ... 6=Saturday. */
  weekday: number;
  /** ISO convention: 1=Monday ... 7=Sunday. */
  isoWeekday: number;
  utcOffsetMinutes: number;
  dayKind: DayKind;
  publicHoliday: PublicHoliday | null;
  holidayProvenance: HolidayProvenance;
  /** Explicit household posture, independent from sensed presence. */
  homeMode: HomeModeState;
  /** Explicit presence observation, independent from calendar and home mode. */
  presence: PresenceSnapshot;
}
