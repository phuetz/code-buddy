import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';

export type BetterSqlite3Constructor = typeof Database;

export const SQLITE_INSTALL_GUIDANCE =
  'Install optional SQLite support with `npm install better-sqlite3` to enable DB-backed memory, cache, and indexed search.';

export class OptionalSqliteUnavailableError extends Error {
  readonly code = 'OPTIONAL_SQLITE_UNAVAILABLE';
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super(`better-sqlite3 is unavailable. ${SQLITE_INSTALL_GUIDANCE}`);
    this.name = 'OptionalSqliteUnavailableError';
    this.originalError = originalError;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isOptionalSqliteUnavailableError(
  error: unknown,
): error is OptionalSqliteUnavailableError {
  if (error instanceof OptionalSqliteUnavailableError) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  const matchesCurrentError = (
    message.includes('better-sqlite3') ||
    message.includes('better_sqlite3.node') ||
    message.includes('could not locate the bindings file')
  );
  if (matchesCurrentError) {
    return true;
  }

  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause !== undefined && cause !== error && isOptionalSqliteUnavailableError(cause);
}

export function normalizeOptionalSqliteError(error: unknown): Error {
  if (error instanceof OptionalSqliteUnavailableError) {
    return error;
  }
  if (isOptionalSqliteUnavailableError(error)) {
    return new OptionalSqliteUnavailableError(error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function loadBetterSqlite3(): Promise<BetterSqlite3Constructor> {
  try {
    const sqliteModule = await import('better-sqlite3');
    return sqliteModule.default;
  } catch (error) {
    throw normalizeOptionalSqliteError(error);
  }
}

const requireModule = createRequire(import.meta.url);

export function loadBetterSqlite3Sync(): BetterSqlite3Constructor {
  try {
    const sqliteModule = requireModule('better-sqlite3') as
      | BetterSqlite3Constructor
      | { default: BetterSqlite3Constructor };
    return typeof sqliteModule === 'function' ? sqliteModule : sqliteModule.default;
  } catch (error) {
    throw normalizeOptionalSqliteError(error);
  }
}
