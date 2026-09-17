/**
 * Unified Recents index across CLI SessionStore JSON, Cowork SQLite and
 * mobile-tagged threads. Metadata only — messages stay in their native store.
 *
 * Rebuild is the source of truth (on demand / at open). The on-disk cache is
 * versioned and disposable: an unknown version is ignored and rebuilt.
 * Cowork sessions appear without a manual handoff (read-only SQLite). Resume
 * from CLI/mobile lazily writes the existing cowork-<id>.json bridge.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { writeJsonAtomicSync } from '../utils/atomic-write.js';
import { getDataRedactionEngine } from '../security/data-redaction.js';
import { isOptionalSqliteUnavailableError, loadBetterSqlite3Sync } from '../database/optional-sqlite.js';
import { cliSessionsDir, writeHandoffSession } from './session-handoff.js';

export const UNIFIED_INDEX_VERSION = 1;

export type UnifiedSurface = 'cli' | 'cowork' | 'mobile';

export interface UnifiedSessionRecord {
  id: string;
  origin: UnifiedSurface;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  ownerUserId?: string;
  profile?: string;
  sourceId?: string;
  pointer: {
    kind: 'session-store' | 'cowork-db';
    path?: string;
    coworkId?: string;
  };
}

export interface UnifiedIndexDocument {
  version: number;
  rebuiltAt: string;
  sessions: UnifiedSessionRecord[];
}

export interface UnifiedSessionIndexOptions {
  sessionsDir?: string;
  coworkDbPath?: string | null;
  indexPath?: string;
  profile?: string | null;
  ownerUserId?: string;
  env?: NodeJS.ProcessEnv;
  limit?: number;
}

const INDEX_NAME = 'recents-index.json';

export function recentsIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEBUDDY_RECENTS_INDEX && env.CODEBUDDY_RECENTS_INDEX.trim()) {
    return path.resolve(env.CODEBUDDY_RECENTS_INDEX);
  }
  return path.join(env.CODEBUDDY_HOME || path.join(os.homedir(), '.codebuddy'), INDEX_NAME);
}

export function resolveCoworkDbPath(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | null {
  const explicit = env.CODEBUDDY_COWORK_DB?.trim();
  if (explicit) return path.resolve(explicit);
  const userData = env.CODEBUDDY_COWORK_USER_DATA?.trim();
  if (userData) {
    const nested = path.join(userData, 'data', 'cowork.db');
    if (fs.existsSync(nested)) return nested;
  }
  const names = ['Code Buddy Cowork', 'code-buddy-cowork', 'codebuddy-cowork'];
  const roots = [
    env.XDG_CONFIG_HOME,
    path.join(home, '.config'),
    path.join(home, 'Library', 'Application Support'),
    env.APPDATA,
  ].filter((value): value is string => Boolean(value));
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name, 'data', 'cowork.db');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function redactTitle(value: string): string {
  try {
    return getDataRedactionEngine().redact(value).redacted.slice(0, 200);
  } catch {
    return value.slice(0, 200);
  }
}

function isoFromUnknown(value: unknown, fallback = '1970-01-01T00:00:00.000Z'): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^\d+$/.test(value.trim())) {
      return isoFromUnknown(numeric, fallback);
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function stringMeta(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function inferUnifiedOrigin(input: {
  id: string;
  metadata?: Record<string, unknown>;
  source?: string;
}): UnifiedSurface {
  const metadata = input.metadata ?? {};
  const handoff = stringMeta(metadata, 'handoffSource');
  const surface = stringMeta(metadata, 'surface') ?? stringMeta(metadata, 'lastSurface');
  const origin = stringMeta(metadata, 'origin');
  const source = input.source;
  if (
    handoff === 'cowork'
    || origin === 'cowork'
    || source === 'cowork'
    || input.id.startsWith('cowork-')
  ) {
    return 'cowork';
  }
  if (surface === 'mobile' || origin === 'mobile' || source === 'mobile') {
    return 'mobile';
  }
  return 'cli';
}

export function currentIndexProfile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.CODEBUDDY_PROFILE?.trim();
  return value || undefined;
}

export function canAccessUnifiedRecord(
  record: Pick<UnifiedSessionRecord, 'ownerUserId' | 'profile'>,
  opts: { ownerUserId?: string; profile?: string | null; env?: NodeJS.ProcessEnv } = {},
): boolean {
  const env = opts.env ?? process.env;
  if (opts.ownerUserId) {
    if (record.ownerUserId && record.ownerUserId !== opts.ownerUserId) return false;
    if (!record.ownerUserId) {
      const configured = (env.CODEBUDDY_OWNER_USER_ID ?? '').trim();
      if (configured && configured !== opts.ownerUserId) return false;
    }
  }
  const profile = opts.profile === undefined ? currentIndexProfile(env) : opts.profile;
  if (profile && record.profile && record.profile !== profile) return false;
  return true;
}

function readCliRecords(sessionsDir: string): UnifiedSessionRecord[] {
  if (!fs.existsSync(sessionsDir)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.json') && name !== INDEX_NAME);
  } catch {
    return [];
  }
  const records: UnifiedSessionRecord[] = [];
  for (const name of names) {
    const filePath = path.join(sessionsDir, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      if (typeof parsed.id !== 'string' || !parsed.id.trim()) continue;
      const metadata = parsed.metadata && typeof parsed.metadata === 'object'
        ? parsed.metadata as Record<string, unknown>
        : undefined;
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      records.push({
        id: parsed.id,
        origin: inferUnifiedOrigin({ id: parsed.id, metadata }),
        title: redactTitle(typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : parsed.id),
        createdAt: isoFromUnknown(parsed.createdAt),
        updatedAt: isoFromUnknown(parsed.lastAccessedAt ?? parsed.updatedAt, isoFromUnknown(parsed.createdAt)),
        messageCount: messages.length,
        ownerUserId: stringMeta(metadata, 'ownerUserId'),
        profile: stringMeta(metadata, 'profile'),
        sourceId: stringMeta(metadata, 'handoffSourceId'),
        pointer: { kind: 'session-store', path: filePath },
      });
    } catch {
      // Malformed or aggregate files are ignored, same as the Cowork catalog.
    }
  }
  return records;
}

function coworkCanonicalId(sourceId: string): string {
  const safe = sourceId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `cowork-${safe || 'session'}`;
}

function coworkTextFromContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((block): block is { type?: unknown; text?: unknown } => Boolean(block) && typeof block === 'object')
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n\n');
    }
    if (parsed && typeof parsed === 'object' && typeof (parsed as { text?: unknown }).text === 'string') {
      return (parsed as { text: string }).text;
    }
  } catch {
    if (raw.trim()) return raw;
  }
  return '';
}

interface CoworkDbRow {
  id: string;
  title: string;
  created_at: number | string;
  updated_at: number | string;
  source: string | null;
  intelligence: string | null;
  message_count: number;
}

function readCoworkRecords(dbPath: string): UnifiedSessionRecord[] {
  let DatabaseCtor;
  try {
    DatabaseCtor = loadBetterSqlite3Sync();
  } catch (error) {
    if (!isOptionalSqliteUnavailableError(error)) {
      logger.warn('[recents] better-sqlite3 unavailable; skipping Cowork sessions', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return [];
  }
  let db: InstanceType<ReturnType<typeof loadBetterSqlite3Sync>> | undefined;
  try {
    db = new DatabaseCtor(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT s.id, s.title, s.created_at, s.updated_at, s.source, s.intelligence,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
        WHERE COALESCE(s.archived, 0) = 0`,
    ).all() as CoworkDbRow[];
    return rows.map((row) => {
      let profile: string | undefined;
      if (row.intelligence) {
        try {
          const intel = JSON.parse(row.intelligence) as { profileId?: unknown };
          if (typeof intel.profileId === 'string' && intel.profileId.trim()) {
            profile = intel.profileId.trim();
          }
        } catch {
          profile = undefined;
        }
      }
      const origin = inferUnifiedOrigin({
        id: row.id,
        source: row.source ?? 'cowork',
        metadata: row.source === 'cli-import' ? { origin: 'cli' } : { origin: 'cowork' },
      });
      return {
        id: origin === 'cowork' ? coworkCanonicalId(row.id) : row.id,
        origin,
        title: redactTitle(row.title || row.id),
        createdAt: isoFromUnknown(row.created_at),
        updatedAt: isoFromUnknown(row.updated_at, isoFromUnknown(row.created_at)),
        messageCount: Number(row.message_count) || 0,
        profile,
        sourceId: row.id,
        pointer: { kind: 'cowork-db' as const, path: dbPath, coworkId: row.id },
      };
    });
  } catch (error) {
    logger.warn('[recents] Cowork database unreadable; listing SessionStore only', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

function mergeRecords(cli: UnifiedSessionRecord[], cowork: UnifiedSessionRecord[]): UnifiedSessionRecord[] {
  const byId = new Map<string, UnifiedSessionRecord>();
  const cliIds = new Set(cli.map((row) => row.id));

  for (const row of cli) {
    byId.set(row.id, row);
  }

  for (const row of cowork) {
    if (row.origin === 'cli' && row.sourceId?.startsWith('cli-import:')) {
      const original = row.sourceId.slice('cli-import:'.length);
      if (cliIds.has(original)) continue;
    }
    const existing = byId.get(row.id);
    if (existing) {
      const existingTime = Date.parse(existing.updatedAt) || 0;
      const incomingTime = Date.parse(row.updatedAt) || 0;
      if (incomingTime >= existingTime) {
        byId.set(row.id, {
          ...row,
          ownerUserId: row.ownerUserId ?? existing.ownerUserId,
          pointer: row.pointer.kind === 'cowork-db' ? row.pointer : existing.pointer,
        });
      }
      continue;
    }
    byId.set(row.id, row);
  }

  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function stripSecrets(record: UnifiedSessionRecord): UnifiedSessionRecord {
  const clean: UnifiedSessionRecord = {
    id: record.id,
    origin: record.origin,
    title: redactTitle(record.title),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    pointer: { ...record.pointer },
  };
  if (record.ownerUserId) clean.ownerUserId = record.ownerUserId;
  if (record.profile) clean.profile = record.profile;
  if (record.sourceId) clean.sourceId = record.sourceId;
  return clean;
}

export function rebuildUnifiedSessionIndex(options: UnifiedSessionIndexOptions = {}): UnifiedIndexDocument {
  const env = options.env ?? process.env;
  const sessionsDir = options.sessionsDir ?? cliSessionsDir();
  const coworkDb = options.coworkDbPath === undefined ? resolveCoworkDbPath(env) : options.coworkDbPath;
  const cli = readCliRecords(sessionsDir);
  const cowork = coworkDb && fs.existsSync(coworkDb) ? readCoworkRecords(coworkDb) : [];
  const document: UnifiedIndexDocument = {
    version: UNIFIED_INDEX_VERSION,
    rebuiltAt: new Date().toISOString(),
    sessions: mergeRecords(cli, cowork).map(stripSecrets),
  };
  const indexPath = options.indexPath ?? recentsIndexPath(env);
  try {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true, mode: 0o700 });
    writeJsonAtomicSync(indexPath, document, { mode: 0o600 });
  } catch (error) {
    logger.warn('[recents] index cache not written', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return document;
}

function readCachedIndex(indexPath: string): UnifiedIndexDocument | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Partial<UnifiedIndexDocument>;
    if (parsed.version !== UNIFIED_INDEX_VERSION || !Array.isArray(parsed.sessions)) return null;
    return {
      version: UNIFIED_INDEX_VERSION,
      rebuiltAt: typeof parsed.rebuiltAt === 'string' ? parsed.rebuiltAt : new Date(0).toISOString(),
      sessions: parsed.sessions.filter((row): row is UnifiedSessionRecord => Boolean(row) && typeof row.id === 'string'),
    };
  } catch {
    return null;
  }
}

export function listUnifiedSessions(options: UnifiedSessionIndexOptions = {}): UnifiedSessionRecord[] {
  const env = options.env ?? process.env;
  const document = rebuildUnifiedSessionIndex(options);
  const filtered = document.sessions.filter((row) => canAccessUnifiedRecord(row, {
    ownerUserId: options.ownerUserId,
    profile: options.profile,
    env,
  }));
  const limit = options.limit && options.limit > 0 ? options.limit : filtered.length;
  return filtered.slice(0, limit);
}

export function upsertUnifiedSessionRecord(
  record: UnifiedSessionRecord,
  options: UnifiedSessionIndexOptions = {},
): void {
  const env = options.env ?? process.env;
  const indexPath = options.indexPath ?? recentsIndexPath(env);
  const cached = readCachedIndex(indexPath);
  const sessions = cached?.sessions ?? rebuildUnifiedSessionIndex(options).sessions;
  const next = stripSecrets(record);
  const merged = [next, ...sessions.filter((row) => row.id !== next.id)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const document: UnifiedIndexDocument = {
    version: UNIFIED_INDEX_VERSION,
    rebuiltAt: new Date().toISOString(),
    sessions: merged,
  };
  try {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true, mode: 0o700 });
    writeJsonAtomicSync(indexPath, document, { mode: 0o600 });
  } catch (error) {
    logger.warn('[recents] upsert cache not written', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function loadCoworkTurns(dbPath: string, coworkId: string): Array<{ role: string; text: string; timestamp?: number }> {
  const DatabaseCtor = loadBetterSqlite3Sync();
  const db = new DatabaseCtor(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(
      `SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC`,
    ).all(coworkId) as Array<{ role: string; content: string; timestamp: number }>;
    return rows
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({
        role: row.role,
        text: coworkTextFromContent(row.content),
        timestamp: Number(row.timestamp) || undefined,
      }))
      .filter((turn) => turn.text.trim().length > 0);
  } finally {
    db.close();
  }
}

export async function materializeUnifiedSession(
  sessionId: string,
  options: UnifiedSessionIndexOptions = {},
): Promise<{ id: string; origin: UnifiedSurface } | null> {
  const records = listUnifiedSessions({ ...options, limit: 500 });
  /*
   * Un identifiant abrégé reste pratique, mais il ne doit jamais désigner
   * « la première session qui commence par là » : sur deux sessions au préfixe
   * commun, l'utilisateur reprendrait silencieusement la mauvaise. Une
   * correspondance exacte gagne toujours ; un préfixe n'est accepté que s'il
   * ne désigne qu'une seule session. La liste est déjà restreinte au
   * propriétaire par listUnifiedSessions, donc l'ambiguïté est un défaut de
   * justesse, pas une fuite entre comptes.
   */
  const exact = records.find((row) => row.id === sessionId || row.sourceId === sessionId);
  const prefixes = exact ? [] : records.filter((row) => row.id.startsWith(sessionId));
  const match = exact ?? (prefixes.length === 1 ? prefixes[0] : undefined);
  if (!match) return null;
  if (!canAccessUnifiedRecord(match, options)) return null;
  if (match.pointer.kind === 'session-store') {
    return { id: match.id, origin: match.origin };
  }
  const dbPath = match.pointer.path;
  const coworkId = match.pointer.coworkId;
  if (!dbPath || !coworkId) return null;
  const turns = loadCoworkTurns(dbPath, coworkId);
  if (turns.length === 0) return null;
  const result = await writeHandoffSession({
    source: 'cowork',
    sourceId: coworkId,
    name: match.title,
    createdAt: match.createdAt,
    turns,
  }, { dir: options.sessionsDir });
  return { id: result.id, origin: 'cowork' };
}
