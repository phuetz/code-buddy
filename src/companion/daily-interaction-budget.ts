import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveZonedDateTime } from '../life-rhythm/day-context.js';
import { logger } from '../utils/logger.js';

const SCHEMA_VERSION = 1;
const RETAIN_DAYS = 14;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 10;
const mutationTails = new Map<string, Promise<void>>();

export type BudgetedInteractionSurface = 'presence' | 'proactive';

interface InteractionEvent {
  id?: string;
  at: string;
  surface: BudgetedInteractionSurface;
}

interface DailyBudgetEntry {
  events: InteractionEvent[];
}

interface DailyBudgetState {
  schemaVersion: typeof SCHEMA_VERSION;
  days: Record<string, DailyBudgetEntry>;
}

export interface ClaimDailyInteractionOptions {
  limit: number;
  surface: BudgetedInteractionSurface;
  now?: Date;
  timeZone?: string;
  statePath?: string;
}

export interface DailyInteractionClaim {
  granted: boolean;
  localDate: string;
  used: number;
  remaining: number;
  reason: 'granted' | 'limit_reached' | 'state_unavailable';
  claimId?: string;
}

export interface ReleaseDailyInteractionOptions {
  claimId: string;
  localDate: string;
  statePath?: string;
}

export interface DailyInteractionReservation {
  granted: boolean;
  release: () => Promise<void>;
}

function defaultStatePath(): string {
  return process.env.CODEBUDDY_COMPANION_INTERACTION_BUDGET_FILE
    || join(homedir(), '.codebuddy', 'companion', 'daily-interactions.json');
}

function emptyState(): DailyBudgetState {
  return { schemaVersion: SCHEMA_VERSION, days: {} };
}

function isEvent(value: unknown): value is InteractionEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<InteractionEvent>;
  return (event.surface === 'presence' || event.surface === 'proactive')
    && (event.id === undefined || (typeof event.id === 'string' && /^interaction_[0-9a-f-]{36}$/i.test(event.id)))
    && typeof event.at === 'string'
    && Number.isFinite(Date.parse(event.at));
}

function isRealLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return roundTrip.getUTCFullYear() === year
    && roundTrip.getUTCMonth() === month - 1
    && roundTrip.getUTCDate() === day;
}

async function loadState(path: string): Promise<DailyBudgetState | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as { schemaVersion?: unknown; days?: unknown };
    if (record.schemaVersion !== SCHEMA_VERSION || typeof record.days !== 'object' || record.days === null) {
      return null;
    }
    const days: Record<string, DailyBudgetEntry> = {};
    for (const [date, value] of Object.entries(record.days)) {
      if (!isRealLocalDate(date) || typeof value !== 'object' || value === null) continue;
      const events = (value as { events?: unknown }).events;
      if (Array.isArray(events) && events.every(isEvent)) days[date] = { events };
    }
    return { schemaVersion: SCHEMA_VERSION, days };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    logger.warn('[companion-budget] state unreadable; denying spontaneous interaction', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function saveState(path: string, state: DailyBudgetState): Promise<boolean> {
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporary, path);
    if (process.platform !== 'win32') await fs.chmod(path, 0o600);
    return true;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    logger.warn('[companion-budget] state write failed; denying spontaneous interaction', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function pruneDays(state: DailyBudgetState, currentDate: string): void {
  const retainedDates = Object.keys(state.days)
    .filter((date) => isRealLocalDate(date) && date <= currentDate)
    .sort()
    .reverse()
    .slice(0, RETAIN_DAYS);
  const retained: Record<string, DailyBudgetEntry> = {};
  for (const date of retainedDates) retained[date] = state.days[date]!;
  retained[currentDate] ??= { events: [] };
  state.days = retained;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function acquireFileLock(statePath: string): Promise<Awaited<ReturnType<typeof fs.open>> | null> {
  const lockPath = `${statePath}.lock`;
  await fs.mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      return await fs.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        logger.warn('[companion-budget] lock acquisition failed', {
          statePath,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  logger.warn('[companion-budget] lock timeout; denying spontaneous interaction', { statePath });
  return null;
}

async function releaseFileLock(
  statePath: string,
  handle: Awaited<ReturnType<typeof fs.open>>
): Promise<void> {
  await handle.close().catch(() => undefined);
  await fs.rm(`${statePath}.lock`, { force: true }).catch(() => undefined);
}

async function serializeForPath<T>(statePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(statePath) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const settled = run.then(() => undefined, () => undefined);
  mutationTails.set(statePath, settled);
  try {
    return await run;
  } finally {
    if (mutationTails.get(statePath) === settled) mutationTails.delete(statePath);
  }
}

/**
 * Atomically persists a shared daily claim before an unsolicited utterance.
 * A corrupt or unwritable ledger fails closed: silence is safer than losing
 * the cap and speaking repeatedly.
 */
export async function claimDailyInteraction(
  options: ClaimDailyInteractionOptions
): Promise<DailyInteractionClaim> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 0 || options.limit > 100) {
    throw new RangeError('limit must be an integer between 0 and 100');
  }
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  if (Number.isNaN(now.getTime())) throw new RangeError('now must be a valid Date');
  const timeZone = options.timeZone
    || process.env.CODEBUDDY_TIMEZONE
    || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = resolveZonedDateTime(now, timeZone).localDate;
  const statePath = resolve(options.statePath ?? defaultStatePath());
  return serializeForPath(statePath, async () => {
    const lock = await acquireFileLock(statePath);
    if (!lock) {
      return { granted: false, localDate, used: 0, remaining: 0, reason: 'state_unavailable' };
    }
    try {
      // Re-read only after both the in-process queue and inter-process lock are
      // held. This is the transaction boundary for the shared daily cap.
      const state = await loadState(statePath);
      if (!state) {
        return { granted: false, localDate, used: 0, remaining: 0, reason: 'state_unavailable' };
      }

      pruneDays(state, localDate);
      const entry = state.days[localDate]!;
      if (entry.events.length >= options.limit) {
        return {
          granted: false,
          localDate,
          used: entry.events.length,
          remaining: 0,
          reason: 'limit_reached',
        };
      }

      const claimId = `interaction_${randomUUID()}`;
      entry.events.push({ id: claimId, at: now.toISOString(), surface: options.surface });
      if (!(await saveState(statePath, state))) {
        return {
          granted: false,
          localDate,
          used: entry.events.length - 1,
          remaining: Math.max(0, options.limit - entry.events.length + 1),
          reason: 'state_unavailable',
        };
      }
      return {
        granted: true,
        localDate,
        used: entry.events.length,
        remaining: Math.max(0, options.limit - entry.events.length),
        reason: 'granted',
        claimId,
      };
    } finally {
      await releaseFileLock(statePath, lock);
    }
  });
}

/** Release an uncommitted delivery reservation after arbitration or I/O fails. */
export async function releaseDailyInteraction(
  options: ReleaseDailyInteractionOptions
): Promise<boolean> {
  if (!/^interaction_[0-9a-f-]{36}$/i.test(options.claimId) || !isRealLocalDate(options.localDate)) {
    return false;
  }
  const statePath = resolve(options.statePath ?? defaultStatePath());
  return serializeForPath(statePath, async () => {
    const lock = await acquireFileLock(statePath);
    if (!lock) return false;
    try {
      const state = await loadState(statePath);
      if (!state) return false;
      const entry = state.days[options.localDate];
      if (!entry) return false;
      const before = entry.events.length;
      entry.events = entry.events.filter((event) => event.id !== options.claimId);
      if (entry.events.length === before) return false;
      return saveState(statePath, state);
    } finally {
      await releaseFileLock(statePath, lock);
    }
  });
}

export async function reserveDailyInteraction(
  options: ClaimDailyInteractionOptions
): Promise<DailyInteractionReservation> {
  const claim = await claimDailyInteraction(options);
  return {
    granted: claim.granted,
    release: async () => {
      if (!claim.claimId) return;
      await releaseDailyInteraction({
        claimId: claim.claimId,
        localDate: claim.localDate,
        ...(options.statePath ? { statePath: options.statePath } : {}),
      });
    },
  };
}
