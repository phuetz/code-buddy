import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

const COOKING_TIMER_SCHEMA_VERSION = 1;
export const MIN_COOKING_TIMER_DURATION_MS = 1_000;
export const MAX_COOKING_TIMER_DURATION_MS = 24 * 60 * 60 * 1_000;
export const MAX_COOKING_TIMER_LABEL_LENGTH = 120;

export interface CookingTimer {
  id: string;
  label: string;
  durationMs: number;
  startedAt: string;
  /** Absolute instant: restoration never restarts the original duration. */
  dueAt: string;
}

export interface CookingTimerView extends CookingTimer {
  state: 'running' | 'due';
  remainingMs: number;
}

interface PersistedCookingTimers {
  schemaVersion: typeof COOKING_TIMER_SCHEMA_VERSION;
  timers: CookingTimer[];
}

export interface CookingTimerStoreOptions {
  filePath?: string;
  now?: () => Date;
}

function defaultFilePath(): string {
  return path.join(os.homedir(), '.codebuddy', 'life-rhythm', 'cooking-timers.json');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validInstant(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function parseTimer(value: unknown): CookingTimer | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    !/^cooking_[0-9a-f-]{36}$/i.test(value.id) ||
    typeof value.label !== 'string' ||
    !value.label.trim() ||
    value.label !== value.label.trim() ||
    value.label.length > MAX_COOKING_TIMER_LABEL_LENGTH ||
    typeof value.durationMs !== 'number' ||
    !Number.isInteger(value.durationMs) ||
    value.durationMs < MIN_COOKING_TIMER_DURATION_MS ||
    value.durationMs > MAX_COOKING_TIMER_DURATION_MS ||
    !validInstant(value.startedAt) ||
    !validInstant(value.dueAt)
  ) {
    return null;
  }
  const startedAtMs = new Date(value.startedAt).getTime();
  const dueAtMs = new Date(value.dueAt).getTime();
  if (dueAtMs - startedAtMs !== value.durationMs) return null;
  return {
    id: value.id,
    label: value.label,
    durationMs: value.durationMs,
    startedAt: value.startedAt,
    dueAt: value.dueAt,
  };
}

/**
 * Persistent named cooking timers for hands-free use.
 *
 * This store owns no Node timer and starts no daemon. `dueAt` is absolute;
 * callers poll `due(now)` from their existing loop and a due timer stays due
 * until it is explicitly acknowledged or cancelled.
 */
export class CookingTimerStore {
  readonly filePath: string;
  private readonly now: () => Date;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: CookingTimerStoreOptions = {}) {
    this.filePath = path.resolve(options.filePath ?? defaultFilePath());
    this.now = options.now ?? (() => new Date());
  }

  async start(durationMs: number, label: string): Promise<CookingTimer> {
    this.validateDuration(durationMs);
    const normalizedLabel = this.validateLabel(label);
    return this.enqueueMutation(async () => {
      const now = this.currentTime();
      const timer: CookingTimer = {
        id: `cooking_${randomUUID()}`,
        label: normalizedLabel,
        durationMs,
        startedAt: now.toISOString(),
        dueAt: new Date(now.getTime() + durationMs).toISOString(),
      };
      const timers = await this.readTimers();
      timers.push(timer);
      await this.writeTimers(timers);
      return { ...timer };
    });
  }

  /** List every unacknowledged timer, including timers already due. */
  async listActive(at?: Date | number): Promise<CookingTimerView[]> {
    await this.mutationTail;
    const now = this.resolveTime(at);
    const timers = await this.readTimers();
    return timers
      .map((timer) => this.toView(timer, now))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  }

  /** Return due, unacknowledged timers without consuming them. */
  async due(at?: Date | number): Promise<CookingTimerView[]> {
    return (await this.listActive(at)).filter((timer) => timer.state === 'due');
  }

  /** Acknowledge a timer only after its absolute due instant. */
  async acknowledge(id: string, at?: Date | number): Promise<CookingTimer | null> {
    return this.enqueueMutation(async () => {
      const now = this.resolveTime(at);
      const timers = await this.readTimers();
      const index = timers.findIndex((timer) => timer.id === id);
      if (index < 0) return null;
      const timer = timers[index]!;
      if (new Date(timer.dueAt).getTime() > now.getTime()) return null;
      timers.splice(index, 1);
      await this.writeTimers(timers);
      return { ...timer };
    });
  }

  /** Cancel a running or due timer. Missing ids are idempotent. */
  async cancel(id: string): Promise<CookingTimer | null> {
    return this.enqueueMutation(async () => {
      const timers = await this.readTimers();
      const index = timers.findIndex((timer) => timer.id === id);
      if (index < 0) return null;
      const [timer] = timers.splice(index, 1);
      await this.writeTimers(timers);
      return timer ? { ...timer } : null;
    });
  }

  private validateDuration(durationMs: number): void {
    if (
      !Number.isInteger(durationMs) ||
      durationMs < MIN_COOKING_TIMER_DURATION_MS ||
      durationMs > MAX_COOKING_TIMER_DURATION_MS
    ) {
      throw new RangeError(
        `durationMs must be an integer between ${MIN_COOKING_TIMER_DURATION_MS} and ${MAX_COOKING_TIMER_DURATION_MS}`,
      );
    }
  }

  private validateLabel(label: string): string {
    if (typeof label !== 'string') throw new TypeError('label must be a string');
    const normalized = label.trim();
    if (!normalized) throw new RangeError('label must not be empty');
    if (normalized.length > MAX_COOKING_TIMER_LABEL_LENGTH) {
      throw new RangeError(`label must not exceed ${MAX_COOKING_TIMER_LABEL_LENGTH} characters`);
    }
    return normalized;
  }

  private currentTime(): Date {
    return this.resolveTime(this.now());
  }

  private resolveTime(value?: Date | number): Date {
    const date = value === undefined
      ? this.now()
      : value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);
    if (Number.isNaN(date.getTime())) throw new RangeError('timer clock must be a valid instant');
    return date;
  }

  private toView(timer: CookingTimer, now: Date): CookingTimerView {
    const remainingMs = Math.max(0, new Date(timer.dueAt).getTime() - now.getTime());
    return {
      ...timer,
      state: remainingMs === 0 ? 'due' : 'running',
      remainingMs,
    };
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readTimers(): Promise<CookingTimer[]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown;
      await this.enforcePrivatePermissions();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[life-rhythm] cooking timer store unreadable; returning no timers', {
          filePath: this.filePath,
          error: errorMessage(error),
        });
      }
      return [];
    }
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== COOKING_TIMER_SCHEMA_VERSION ||
      !Array.isArray(parsed.timers)
    ) {
      logger.warn('[life-rhythm] cooking timer store schema invalid; returning no timers', {
        filePath: this.filePath,
      });
      return [];
    }
    const timers = parsed.timers.map(parseTimer);
    if (timers.some((timer) => timer === null)) {
      logger.warn('[life-rhythm] cooking timer store contains invalid timer data; returning no timers', {
        filePath: this.filePath,
      });
      return [];
    }
    const validTimers = timers as CookingTimer[];
    if (new Set(validTimers.map((timer) => timer.id)).size !== validTimers.length) {
      logger.warn('[life-rhythm] cooking timer store contains duplicate ids; returning no timers', {
        filePath: this.filePath,
      });
      return [];
    }
    return validTimers.map((timer) => ({ ...timer }));
  }

  private async writeTimers(timers: CookingTimer[]): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.tmp.${process.pid}.${randomUUID()}`;
    const envelope: PersistedCookingTimers = {
      schemaVersion: COOKING_TIMER_SCHEMA_VERSION,
      timers,
    };
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
      await fs.writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(temporary, this.filePath);
      await this.enforcePrivatePermissions();
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw new Error(`Unable to persist cooking timers: ${errorMessage(error)}`);
    }
  }

  private async enforcePrivatePermissions(): Promise<void> {
    if (process.platform === 'win32') return;
    await Promise.all([
      fs.chmod(path.dirname(this.filePath), 0o700),
      fs.chmod(this.filePath, 0o600),
    ]);
  }
}
