import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';
import { HOME_MODES, type HomeMode, type HomeModeState } from './types.js';

const HOME_MODE_SCHEMA_VERSION = 1;

interface PersistedHomeMode {
  schemaVersion: typeof HOME_MODE_SCHEMA_VERSION;
  mode: HomeMode;
  setAt: string;
  expiresAt?: string;
}

export interface HomeModeStoreOptions {
  filePath?: string;
  now?: () => Date;
}

export interface SetHomeModeOptions {
  /** Exact expiration instant. Mutually exclusive with `durationMs`. */
  expiresAt?: Date | string;
  /** Relative expiration from the injected clock. Mutually exclusive with `expiresAt`. */
  durationMs?: number;
}

function defaultFilePath(): string {
  return path.join(os.homedir(), '.codebuddy', 'life-rhythm', 'home-mode.json');
}

function isHomeMode(value: unknown): value is HomeMode {
  return typeof value === 'string' && (HOME_MODES as readonly string[]).includes(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Private, atomic persistence for the household's explicit operating posture.
 *
 * The containing directory is forced to 0700 and the JSON file to 0600 on
 * POSIX systems. No reason/free-text field is stored, deliberately minimizing
 * sensitive household information at rest.
 */
export class HomeModeStore {
  readonly filePath: string;
  private readonly now: () => Date;

  constructor(options: HomeModeStoreOptions = {}) {
    this.filePath = path.resolve(options.filePath ?? defaultFilePath());
    this.now = options.now ?? (() => new Date());
  }

  async getCurrent(): Promise<HomeModeState> {
    const now = this.currentTime();
    const persisted = await this.readPersisted();
    if (!persisted) return this.defaultState(now);

    if (persisted.expiresAt && new Date(persisted.expiresAt).getTime() <= now.getTime()) {
      const previousMode = persisted.mode;
      const reset: PersistedHomeMode = {
        schemaVersion: HOME_MODE_SCHEMA_VERSION,
        mode: 'normal',
        setAt: now.toISOString(),
      };
      await this.writePersisted(reset);
      return {
        mode: 'normal',
        setAt: reset.setAt,
        source: 'expired',
        previousMode,
      };
    }

    return {
      mode: persisted.mode,
      setAt: persisted.setAt,
      source: 'stored',
      ...(persisted.expiresAt ? { expiresAt: persisted.expiresAt } : {}),
    };
  }

  async setMode(mode: HomeMode, options: SetHomeModeOptions = {}): Promise<HomeModeState> {
    if (!isHomeMode(mode)) {
      throw new RangeError(`Invalid home mode '${String(mode)}'`);
    }
    if (options.expiresAt !== undefined && options.durationMs !== undefined) {
      throw new RangeError('expiresAt and durationMs are mutually exclusive');
    }
    const now = this.currentTime();
    const expiresAt = this.resolveExpiration(options, now);
    const persisted: PersistedHomeMode = {
      schemaVersion: HOME_MODE_SCHEMA_VERSION,
      mode,
      setAt: now.toISOString(),
      ...(expiresAt ? { expiresAt } : {}),
    };
    await this.writePersisted(persisted);
    return {
      mode,
      setAt: persisted.setAt,
      source: 'stored',
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  async reset(): Promise<HomeModeState> {
    return this.setMode('normal');
  }

  private currentTime(): Date {
    const value = this.now();
    if (Number.isNaN(value.getTime())) throw new RangeError('now() returned an invalid Date');
    return new Date(value.getTime());
  }

  private defaultState(now: Date): HomeModeState {
    return {
      mode: 'normal',
      setAt: now.toISOString(),
      source: 'default',
    };
  }

  private resolveExpiration(options: SetHomeModeOptions, now: Date): string | undefined {
    if (options.durationMs !== undefined) {
      if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
        throw new RangeError('durationMs must be a finite positive number');
      }
      return new Date(now.getTime() + options.durationMs).toISOString();
    }
    if (options.expiresAt === undefined) return undefined;
    const parsed = options.expiresAt instanceof Date
      ? new Date(options.expiresAt.getTime())
      : new Date(options.expiresAt);
    if (Number.isNaN(parsed.getTime())) throw new RangeError('expiresAt must be a valid timestamp');
    if (parsed.getTime() <= now.getTime()) throw new RangeError('expiresAt must be in the future');
    return parsed.toISOString();
  }

  private async readPersisted(): Promise<PersistedHomeMode | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown;
      await this.enforcePrivatePermissions();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[life-rhythm] home mode store unreadable; using normal', {
          filePath: this.filePath,
          error: errorMessage(error),
        });
      }
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      logger.warn('[life-rhythm] home mode store has invalid content; using normal', {
        filePath: this.filePath,
      });
      return null;
    }
    const value = parsed as Record<string, unknown>;
    if (
      value.schemaVersion !== HOME_MODE_SCHEMA_VERSION ||
      !isHomeMode(value.mode) ||
      !isIsoTimestamp(value.setAt) ||
      (value.expiresAt !== undefined && !isIsoTimestamp(value.expiresAt))
    ) {
      logger.warn('[life-rhythm] home mode store has invalid schema; using normal', {
        filePath: this.filePath,
      });
      return null;
    }
    return {
      schemaVersion: HOME_MODE_SCHEMA_VERSION,
      mode: value.mode,
      setAt: value.setAt,
      ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
    };
  }

  private async writePersisted(value: PersistedHomeMode): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.tmp.${process.pid}.${randomUUID()}`;
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
      await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(temporary, this.filePath);
      await this.enforcePrivatePermissions();
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw new Error(`Unable to persist home mode: ${errorMessage(error)}`);
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
