/**
 * Federated Collective Knowledge Graph bridge (CB2 INNOV-4, P0).
 *
 * `peer.ckg.sync` exposes a bounded delta of first-hand CKG entity events.
 * Synchronisation is pull-only and requires CODEBUDDY_CKG_SYNC=true on both
 * peers. Remote knowledge is re-ingested through the normal CKG `remember()`
 * API with a `peer:<id>` contributor, preserving native corroboration while
 * preventing gossip loops on subsequent serves.
 */

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import {
  CollectiveKnowledgeGraph,
  getCollectiveKnowledgeGraph,
  type CkgRememberInput,
} from '../memory/collective-knowledge-graph.js';
import { getCodeBuddyHome } from '../utils/codebuddy-home.js';
import { logger } from '../utils/logger.js';
import { getFleetRegistry } from './fleet-registry.js';
import { defangPeerKnowledgeText } from './peer-text-sanitizer.js';
import {
  registerPeerMethod,
  unregisterPeerMethod,
} from '../server/websocket/peer-method-registry.js';

export const CKG_SYNC_METHOD = 'peer.ckg.sync';
const DEFAULT_SYNC_TYPES: readonly CkgSyncType[] = ['lesson', 'fact'];
const CKG_SYNC_TYPES: readonly CkgSyncType[] = ['lesson', 'decision', 'fact', 'discovery'];
const DEFAULT_PAGE_LIMIT = 200;
const MAX_PAGE_LIMIT = 500;
const DEFAULT_RUN_MAX = 1000;
// A malicious peer must not be able to bloat the local ledger: every field of
// a synced entry is size-capped, and a page may never exceed what was asked.
const MAX_TEXT_LENGTH = 16_384;
const MAX_NAME_LENGTH = 256;
const MAX_FIELD_LENGTH = 128;
const MAX_RECORDED_AT_LENGTH = 64;
const MAX_CURSOR_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type CkgSyncType = 'lesson' | 'decision' | 'fact' | 'discovery';

/** A standard entity event read from the existing append-only CKG ledger. */
export interface CkgSyncEntry {
  v: 1;
  kind: 'entity';
  recordedAt: string;
  agentId: string;
  source?: string;
  contentHash: string;
  id: string;
  type: CkgSyncType;
  name: string;
  text?: string;
  confidence?: number;
}

export interface CkgSyncResponse {
  entries: CkgSyncEntry[];
  /** Epoch milliseconds of the newest returned event, or the request cursor when empty. */
  maxTs: number;
}

interface PeerSyncCursor {
  sinceTs: number;
  seenEntryIds: string[];
}

interface CkgSyncState {
  version: 1;
  peers: Record<string, PeerSyncCursor>;
}

export interface PeerCkgBridgeOptions {
  getCkg?: () => CollectiveKnowledgeGraph;
  /** Test seam used to prove the opt-in gate runs before ledger access. */
  readLedger?: (ledgerPath: string) => string;
}

export type PeerCkgRequest = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface PullFromPeerOptions {
  ckg?: CollectiveKnowledgeGraph;
  statePath?: string;
  request?: PeerCkgRequest;
  dryRun?: boolean;
  /** Wire page size. Clamped to the protocol's hard limit of 500. */
  limit?: number;
  /** Optional local type subset; always intersected with the local env allowlist. */
  types?: string[];
}

export interface PullFromPeerResult {
  peerId: string;
  dryRun: boolean;
  fetched: number;
  ingested: number;
  skipped: number;
  wouldIngest: number;
  maxTs: number;
  entries: CkgSyncEntry[];
}

let wired = false;

export function wirePeerCkgBridge(options: PeerCkgBridgeOptions = {}): void {
  if (wired) {
    logger.debug('[peer-ckg-bridge] wire() called while already wired — no-op');
    return;
  }

  const getCkg = options.getCkg ?? getCollectiveKnowledgeGraph;
  const readLedger = options.readLedger ?? ((ledgerPath: string) => readFileSync(ledgerPath, 'utf8'));
  registerPeerMethod(CKG_SYNC_METHOD, async (params) => {
    // Keep this gate outside serveCkgDelta as well: argument evaluation must
    // not even construct/resolve the CKG singleton while the feature is off.
    assertCkgSyncEnabled();
    return serveCkgDelta(params, getCkg(), readLedger);
  });
  wired = true;
  logger.debug('[peer-ckg-bridge] wired (peer.ckg.sync; fail-closed unless opted in)');
}

export function unwirePeerCkgBridge(): void {
  if (!wired) return;
  unregisterPeerMethod(CKG_SYNC_METHOD);
  wired = false;
  logger.debug('[peer-ckg-bridge] unwired');
}

/** Test-only reset hook. */
export function _unwirePeerCkgBridgeForTests(): void {
  unregisterPeerMethod(CKG_SYNC_METHOD);
  wired = false;
}

export function serveCkgDelta(
  params: Record<string, unknown>,
  ckg: CollectiveKnowledgeGraph = getCollectiveKnowledgeGraph(),
  readLedger: (ledgerPath: string) => string = (ledgerPath) => readFileSync(ledgerPath, 'utf8'),
): CkgSyncResponse {
  assertCkgSyncEnabled();

  const allowed = getAllowedSyncTypes();
  const requested = parseRequestedTypes(params.types);
  const selected = new Set((requested ?? [...allowed]).filter((type) => allowed.has(type)));
  const sinceTs = parseSinceTs(params.sinceTs);
  const limit = parsePageLimit(params.limit);
  if (selected.size === 0) return { entries: [], maxTs: sinceTs };

  let content: string;
  try {
    content = readLedger(ckg.getLedgerPath());
  } catch (error) {
    if (isMissingFileError(error)) return { entries: [], maxTs: sinceTs };
    throw new Error(
      `CKG_LEDGER_READ_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const entries: CkgSyncEntry[] = [];
  let maxTs = sinceTs;
  for (const line of content.split('\n')) {
    if (entries.length >= limit) break;
    const entry = parseLedgerEntry(line);
    if (!entry || !selected.has(entry.type) || isRemoteProvenance(entry)) continue;
    const timestamp = Date.parse(entry.recordedAt);
    if (!Number.isFinite(timestamp) || timestamp <= sinceTs) continue;
    entries.push(entry);
    maxTs = Math.max(maxTs, timestamp);
  }
  return { entries, maxTs };
}

/**
 * Pull all available pages from one peer up to CODEBUDDY_CKG_SYNC_MAX.
 * The optional request seam keeps tests in-process and avoids a real WebSocket.
 */
export async function pullFromPeer(
  peerId: string,
  options: PullFromPeerOptions = {},
): Promise<PullFromPeerResult> {
  assertCkgSyncEnabled();
  const normalizedPeerId = peerId.trim();
  if (!normalizedPeerId) throw new Error('CKG_SYNC_PEER_REQUIRED: peer id must not be empty');

  const ckg = options.ckg ?? getCollectiveKnowledgeGraph();
  const statePath = options.statePath ?? join(getCodeBuddyHome(), 'collective', 'sync-state.json');
  const state = loadSyncState(statePath);
  const storedCursor = Object.prototype.hasOwnProperty.call(state.peers, normalizedPeerId)
    ? state.peers[normalizedPeerId]
    : undefined;
  const cursor = storedCursor ?? { sinceTs: 0, seenEntryIds: [] };
  const persistedSeen = new Set(cursor.seenEntryIds);
  const runSeen = new Set(cursor.seenEntryIds);
  const dryRun = options.dryRun === true;
  const runMax = getRunMax();
  const pageLimit = normalizePageLimit(options.limit ?? DEFAULT_PAGE_LIMIT);
  const localAllowed = getAllowedSyncTypes();
  const requestedTypes = (options.types ?? [...localAllowed]).filter(isCkgSyncType);
  const types = [...new Set(requestedTypes.filter((type) => localAllowed.has(type)))];
  if (runMax === 0 || types.length === 0) {
    return {
      peerId: normalizedPeerId,
      dryRun,
      fetched: 0,
      ingested: 0,
      skipped: 0,
      wouldIngest: 0,
      maxTs: cursor.sinceTs,
      entries: [],
    };
  }
  const connection = options.request
    ? { request: options.request, close: async () => undefined }
    : await resolveDefaultPeerConnection(normalizedPeerId);

  let sinceTs = cursor.sinceTs;
  let fetched = 0;
  let ingested = 0;
  let skipped = 0;
  const candidates: CkgSyncEntry[] = [];

  try {
    while (candidates.length < runMax) {
      const remaining = runMax - candidates.length;
      const requestLimit = Math.min(pageLimit, remaining);
      if (requestLimit <= 0 || types.length === 0) break;
      const raw = await connection.request(CKG_SYNC_METHOD, {
        sinceTs,
        types,
        limit: requestLimit,
      });
      const response = parseSyncResponse(raw, sinceTs, localAllowed, requestLimit);
      fetched += response.entries.length;

      for (const entry of response.entries) {
        // Belt-and-braces: parseSyncResponse already rejects oversized pages,
        // but the run cap must hold even if that invariant ever regresses.
        if (candidates.length >= runMax) break;
        if (runSeen.has(entry.id)) {
          skipped += 1;
          continue;
        }
        runSeen.add(entry.id);
        candidates.push(entry);
        if (dryRun) continue;

        const stored = ckg.remember(toPeerRememberInput(entry, normalizedPeerId, ckg));
        if (!stored) {
          state.peers[normalizedPeerId] = {
            sinceTs,
            seenEntryIds: [...runSeen].filter((id) => id !== entry.id),
          };
          saveSyncState(statePath, state);
          throw new Error(`CKG_SYNC_INGEST_FAILED: could not ingest entry ${entry.id}`);
        }
        persistedSeen.add(entry.id);
        ingested += 1;
      }

      const previousSinceTs = sinceTs;
      sinceTs = response.maxTs;
      if (!dryRun) {
        state.peers[normalizedPeerId] = {
          sinceTs,
          seenEntryIds: [...persistedSeen],
        };
        saveSyncState(statePath, state);
      }
      if (response.entries.length < requestLimit || sinceTs <= previousSinceTs) break;
    }
  } finally {
    await connection.close();
  }

  return {
    peerId: normalizedPeerId,
    dryRun,
    fetched,
    ingested,
    skipped,
    wouldIngest: candidates.length,
    maxTs: sinceTs,
    entries: candidates,
  };
}

function assertCkgSyncEnabled(): void {
  if (process.env.CODEBUDDY_CKG_SYNC !== 'true') {
    throw new Error(
      'CKG_SYNC_NOT_ENABLED: set CODEBUDDY_CKG_SYNC=true on both peers to enable CKG federation',
    );
  }
}

function getAllowedSyncTypes(): Set<CkgSyncType> {
  const raw = process.env.CODEBUDDY_CKG_SYNC_TYPES;
  const configured = raw === undefined
    ? DEFAULT_SYNC_TYPES
    : raw.split(',').map((value) => value.trim()).filter(isCkgSyncType);
  return new Set(configured);
}

function isCkgSyncType(value: unknown): value is CkgSyncType {
  return typeof value === 'string' && CKG_SYNC_TYPES.includes(value as CkgSyncType);
}

function parseRequestedTypes(value: unknown): CkgSyncType[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.every((type) => typeof type === 'string')) {
    throw new Error('CKG_SYNC_INVALID_REQUEST: types must be an array of strings');
  }
  return value.filter(isCkgSyncType);
}

function parseSinceTs(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('CKG_SYNC_INVALID_REQUEST: sinceTs must be a non-negative number');
  }
  return value;
}

function parsePageLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new Error(`CKG_SYNC_INVALID_REQUEST: limit must be between 1 and ${MAX_PAGE_LIMIT}`);
  }
  return Math.floor(value);
}

function normalizePageLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(value)));
}

function getRunMax(): number {
  const raw = process.env.CODEBUDDY_CKG_SYNC_MAX;
  if (raw === undefined) return DEFAULT_RUN_MAX;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RUN_MAX;
}

function parseLedgerEntry(line: string): CkgSyncEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  return parseEntry(value);
}

function parseEntry(value: unknown): CkgSyncEntry | null {
  if (!isRecord(value)) return null;
  if (
    value.v !== 1 ||
    value.kind !== 'entity' ||
    typeof value.recordedAt !== 'string' ||
    typeof value.agentId !== 'string' ||
    typeof value.contentHash !== 'string' ||
    typeof value.id !== 'string' ||
    !isCkgSyncType(value.type) ||
    typeof value.name !== 'string' ||
    (value.text !== undefined && typeof value.text !== 'string') ||
    (value.source !== undefined && typeof value.source !== 'string') ||
    (value.confidence !== undefined && typeof value.confidence !== 'number')
  ) {
    return null;
  }
  if (
    value.recordedAt.length > MAX_RECORDED_AT_LENGTH ||
    !Number.isFinite(Date.parse(value.recordedAt)) ||
    value.agentId.length > MAX_FIELD_LENGTH ||
    value.contentHash.length > MAX_FIELD_LENGTH ||
    value.id.length > MAX_FIELD_LENGTH ||
    value.name.length > MAX_NAME_LENGTH ||
    (typeof value.text === 'string' && value.text.length > MAX_TEXT_LENGTH) ||
    (typeof value.source === 'string' && value.source.length > MAX_FIELD_LENGTH)
  ) {
    return null;
  }
  return {
    v: 1,
    kind: 'entity',
    recordedAt: value.recordedAt,
    agentId: value.agentId,
    contentHash: value.contentHash,
    id: value.id,
    type: value.type,
    name: value.name,
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.confidence === 'number' ? { confidence: value.confidence } : {}),
  };
}

function isRemoteProvenance(entry: CkgSyncEntry): boolean {
  return entry.agentId.startsWith('peer:') || entry.source?.startsWith('peer:') === true;
}

function parseSyncResponse(
  value: unknown,
  sinceTs: number,
  localAllowed: Set<CkgSyncType>,
  requestLimit: number,
): CkgSyncResponse {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error('CKG_SYNC_RESPONSE_INVALID: response must contain an entries array');
  }
  if (value.entries.length > requestLimit) {
    throw new Error('CKG_SYNC_RESPONSE_INVALID: peer returned more entries than requested');
  }
  if (typeof value.maxTs !== 'number' || !Number.isFinite(value.maxTs) || value.maxTs < sinceTs) {
    throw new Error('CKG_SYNC_RESPONSE_INVALID: maxTs must be a finite advancing cursor');
  }
  if (value.maxTs > Date.now() + MAX_CURSOR_CLOCK_SKEW_MS) {
    throw new Error('CKG_SYNC_RESPONSE_INVALID: maxTs is unreasonably far in the future');
  }
  const entries: CkgSyncEntry[] = [];
  for (const rawEntry of value.entries) {
    const entry = parseEntry(rawEntry);
    if (!entry || !localAllowed.has(entry.type) || isRemoteProvenance(entry)) {
      throw new Error('CKG_SYNC_RESPONSE_INVALID: peer returned a disallowed or malformed entry');
    }
    entries.push(defangEntry(entry));
  }
  if (entries.length > 0) {
    const newest = Math.max(...entries.map((entry) => Date.parse(entry.recordedAt)));
    if (value.maxTs !== newest) {
      throw new Error('CKG_SYNC_RESPONSE_INVALID: maxTs must equal the newest returned entry');
    }
  }
  return { entries, maxTs: value.maxTs };
}

/**
 * Neutralize control tokens in the free-form fields of an entry received from a
 * peer, at the door — before it reaches `ckg.remember()`.
 *
 * A synced entry is not read once and discarded: it is appended to the local
 * collective ledger and injected into later prompts when
 * `CODEBUDDY_COLLECTIVE_MEMORY` is on. Left as-is, `<|im_start|>system …` sent
 * by another machine becomes a persistent, cross-machine role-injection channel
 * — the same vector closed on the council path, but this one survives restarts.
 *
 * The size caps in `parseEntry` run BEFORE this: defanging only inserts spaces,
 * so it can grow a field by a few percent at most. That is deliberate — the caps
 * exist to stop ledger bloat, and refusing an entry for one inserted space would
 * turn a hardening pass into a sync failure.
 */
function defangEntry(entry: CkgSyncEntry): CkgSyncEntry {
  const name = defangPeerKnowledgeText(entry.name);
  const text = entry.text === undefined ? undefined : defangPeerKnowledgeText(entry.text);
  if (name === entry.name && text === entry.text) return entry;
  logger.warn('[peer-ckg-bridge] neutralised control tokens in a synced entry', {
    id: entry.id,
    type: entry.type,
  });
  return {
    ...entry,
    name,
    ...(text !== undefined ? { text } : {}),
  };
}

function toPeerRememberInput(
  entry: CkgSyncEntry,
  peerId: string,
  ckg: CollectiveKnowledgeGraph,
): CkgRememberInput {
  const provenance = `peer:${peerId}`;
  const text = entry.text ?? entry.name;
  // First-hand local knowledge is never superseded by a peer: when the current
  // local entity was asserted by a non-peer contributor with different content,
  // the remote entry coexists under a disambiguated name (mirrors the
  // rememberFact coexist verdict) instead of becoming the current version.
  let name = entry.name;
  const current = ckg.getCurrentEntity(entry.type, entry.name);
  const hasLocalContributor =
    current !== null &&
    current.contributors.some((contributor) => !contributor.startsWith('peer:'));
  if (current && hasLocalContributor && current.text !== text) {
    const disambiguator = createHash('sha256').update(`${entry.type}|${text}`).digest('hex').slice(0, 8);
    name = `${entry.name}#peer-${disambiguator}`;
  }
  return {
    text,
    type: entry.type,
    name,
    agentId: provenance,
    source: provenance,
    ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
  };
}

function loadSyncState(statePath: string): CkgSyncState {
  if (!existsSync(statePath)) return { version: 1, peers: emptyPeerCursors() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `CKG_SYNC_STATE_INVALID: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.peers)) {
    throw new Error('CKG_SYNC_STATE_INVALID: expected version 1 with a peers object');
  }
  const peers = emptyPeerCursors();
  for (const [peerId, rawCursor] of Object.entries(parsed.peers)) {
    if (
      !isRecord(rawCursor) ||
      typeof rawCursor.sinceTs !== 'number' ||
      !Number.isFinite(rawCursor.sinceTs) ||
      rawCursor.sinceTs < 0 ||
      !Array.isArray(rawCursor.seenEntryIds) ||
      !rawCursor.seenEntryIds.every((id) => typeof id === 'string')
    ) {
      throw new Error(`CKG_SYNC_STATE_INVALID: invalid cursor for peer ${peerId}`);
    }
    peers[peerId] = {
      sinceTs: rawCursor.sinceTs,
      seenEntryIds: [...new Set(rawCursor.seenEntryIds)],
    };
  }
  return { version: 1, peers };
}

function emptyPeerCursors(): Record<string, PeerSyncCursor> {
  return Object.create(null) as Record<string, PeerSyncCursor>;
}

function saveSyncState(statePath: string, state: CkgSyncState): void {
  const directory = dirname(statePath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, statePath);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* best effort cleanup */
    }
    throw new Error(
      `CKG_SYNC_STATE_WRITE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function resolveDefaultPeerConnection(peerId: string): Promise<{
  request: PeerCkgRequest;
  close: () => Promise<void>;
}> {
  const active = getFleetRegistry().get(peerId);
  if (active) {
    return {
      request: (method, params) => active.listener.request(method, params),
      close: async () => undefined,
    };
  }

  if (!/^wss?:\/\//u.test(peerId)) {
    throw new Error(
      `CKG_SYNC_PEER_NOT_CONNECTED: no active fleet peer named "${peerId}"; pass a ws:// URL or connect the peer first`,
    );
  }
  const apiKey = process.env.CODEBUDDY_FLEET_API_KEY;
  const jwt = process.env.CODEBUDDY_FLEET_JWT;
  if (!apiKey && !jwt) {
    throw new Error(
      'CKG_SYNC_AUTH_REQUIRED: set CODEBUDDY_FLEET_API_KEY or CODEBUDDY_FLEET_JWT for direct peer URLs',
    );
  }
  const { FleetListener } = await import('./fleet-listener.js');
  const listener = new FleetListener({
    url: peerId,
    ...(apiKey ? { apiKey } : {}),
    ...(jwt ? { jwt } : {}),
  });
  await listener.connect();
  return {
    request: (method, params) => listener.request(method, params),
    close: () => listener.disconnect(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
