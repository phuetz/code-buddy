import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

export type BetterSqlite3Constructor = typeof Database;

/**
 * Detects whether Code Buddy is running from a global installation.
 */
export function isGlobalInstallation(
  targetUrl: string = import.meta.url,
  argv1: string = process.argv[1] || ''
): boolean {
  if (process.env.CODEBUDDY_INSTALL_MODE === 'global') return true;
  if (process.env.CODEBUDDY_INSTALL_MODE === 'local') return false;

  const urlPath = targetUrl.startsWith('file://') ? fileURLToPath(targetUrl) : targetUrl;
  const normalizedUrl = urlPath.replace(/\\/g, '/');
  const normalizedArgv = argv1.replace(/\\/g, '/');

  // If invoked via a project-local node_modules/.bin/, it is definitely local
  if (/\/node_modules\/\.bin\//i.test(normalizedArgv)) {
    return false;
  }

  const globalPatterns = [
    /\/lib\/node_modules\//i,
    /\/\.nvm\/versions\/node\/[^\/]+\/lib\/node_modules\//i,
    /\/\.npm-global\//i,
    /\/npm-global\//i,
    /\/usr\/(?:local\/)?lib\/node_modules\//i,
    /\/opt\/(?:homebrew|local)\/(?:lib|share)\/node_modules\//i,
    /\/AppData\/Roaming\/npm\/node_modules\//i,
    /\/Program Files(?: \(x86\))?\/nodejs\/node_modules\//i,
    /\/\.pnpm\/global\//i,
    /\/\.yarn\/global\//i,
    /\/\.bun\/(?:install\/)?global\//i,
    /\/global\/node_modules\//i,
  ];

  if (globalPatterns.some((pattern) => pattern.test(normalizedUrl) || pattern.test(normalizedArgv))) {
    return true;
  }

  return false;
}

/**
 * Returns install/rebuild guidance for better-sqlite3 adapted to global vs local install.
 */
export function getSqliteInstallGuidance(isGlobal: boolean = isGlobalInstallation()): string {
  if (isGlobal) {
    return 'Install optional SQLite support with `npm install -g --allow-scripts=better-sqlite3 @phuetz/code-buddy` to enable DB-backed memory, cache, and indexed search.';
  }
  return 'Rebuild or install optional SQLite support with `npm rebuild better-sqlite3` to enable DB-backed memory, cache, and indexed search.';
}

export const SQLITE_INSTALL_GUIDANCE = getSqliteInstallGuidance();

export class OptionalSqliteUnavailableError extends Error {
  readonly code = 'OPTIONAL_SQLITE_UNAVAILABLE';
  readonly originalError: unknown;

  constructor(originalError: unknown, isGlobal?: boolean) {
    super(`better-sqlite3 is unavailable. ${getSqliteInstallGuidance(isGlobal)}`);
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
