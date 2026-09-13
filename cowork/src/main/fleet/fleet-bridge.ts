/**
 * FleetBridge — multi-host Code Buddy listener (GAP 3)
 *
 * Wraps the core `FleetListener` from `src/fleet/fleet-listener.ts` so
 * Cowork can subscribe to `fleet:*` events broadcast by remote Code Buddy
 * peers over the Tailscale mesh (e.g. a Linux hub at
 * `ws://203.0.113.10:3000/ws`, an address of the RFC 5737 documentation range).
 *
 * Design choices
 * - Reuses the core listener via `loadCoreModule` rather than reimplementing
 *   the WS protocol (auth, reconnect, ring buffer, presence already handled).
 * - One `FleetListener` instance per peer, kept in a `Map<peerId, ...>`.
 * - Peer registry persisted to `<userData>/fleet-peers.json` (apiKey
 *   stored locally — V1 trade-off, harden with keytar later).
 * - Every event flows out as a Cowork `ServerEvent` via `sendToRenderer`.
 *
 * @module main/fleet/fleet-bridge
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { app } from 'electron';
import { log, logError, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import type { ActivityFeed } from '../activity/activity-feed';
import type {
  ServerEvent,
  FleetPeer,
  FleetPeerStatus,
  FleetEventRecord,
} from '../../renderer/types';

type FleetCapability = NonNullable<FleetPeer['capability']>;
type FleetPeerChatProvider = NonNullable<FleetPeer['peerChatProvider']>;

interface CoreFleetListener {
  connect(): Promise<void>;
  disconnect(): Promise<void> | void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  request(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number; traceId?: string; depth?: number },
  ): Promise<unknown>;
}

interface CoreFleetListenerOptions {
  url: string;
  apiKey?: string;
  jwt?: string;
  autoReconnect?: boolean;
  historyCapacity?: number;
}

interface CoreFleetModule {
  FleetListener: new (options: CoreFleetListenerOptions) => CoreFleetListener;
}

type ConnectOutcome = { success: true } | { success: false; error: string };

interface PeerEntry {
  meta: FleetPeer;
  apiKey?: string;
  jwt?: string;
  listener: CoreFleetListener | null;
  /** Attempt in flight, shared by concurrent callers so no listener is ever orphaned. */
  pendingConnect?: Promise<ConnectOutcome>;
  /** Bridge-level retry for the failures the core listener never retries itself. */
  recoveryTimer?: ReturnType<typeof setTimeout>;
  recoveryAttempt: number;
  /** The server refused the credentials: retrying cannot help until the user acts. */
  credentialsRejected: boolean;
  /** Bumped on every status change; an async answer only applies to the state it was asked in. */
  statusGeneration: number;
}

export interface FleetBridgeOptions {
  /** Delays between bridge-level recovery attempts; the last one repeats. */
  recoveryDelaysMs?: number[];
}

interface PersistedPeer {
  id: string;
  url: string;
  label?: string;
  addedAt: number;
  apiKey?: string;
  jwt?: string;
}

interface PersistedFile {
  peers: PersistedPeer[];
}

const EVENT_RING_CAPACITY = 200;
const CAPABILITY_REFRESH_INTERVAL_MS = 60_000;
const PEER_DESCRIBE_TIMEOUT_MS = 5_000;
const DEFAULT_RECOVERY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
const CREDENTIAL_REJECTION_CODES = new Set(['AUTH_FAILED', 'INVALID_TOKEN']);
const BRIDGE_STOPPED = 'Fleet bridge is stopped';

function isCredentialRejection(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CREDENTIAL_REJECTION_CODES.has(code);
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

let cachedModule: CoreFleetModule | null = null;
async function loadFleetModule(): Promise<CoreFleetModule | null> {
  if (cachedModule) return cachedModule;
  const mod = await loadCoreModule<CoreFleetModule>('fleet/fleet-listener.js');
  if (mod) {
    cachedModule = mod;
    log('[FleetBridge] Core fleet-listener module loaded');
  } else {
    logWarn('[FleetBridge] Core fleet-listener module unavailable');
  }
  return mod;
}

export class FleetBridge {
  private readonly registryPath: string;
  private readonly sendToRenderer: (event: ServerEvent) => void;
  private peers: Map<string, PeerEntry> = new Map();
  private events: FleetEventRecord[] = [];
  private capabilityRefreshedAt: Map<string, number> = new Map();
  private loaded = false;
  private stopped = false;
  private activityFeed: ActivityFeed | null = null;
  private readonly recoveryDelaysMs: number[];

  constructor(
    sendToRenderer: (event: ServerEvent) => void,
    activityFeed: ActivityFeed | null = null,
    options: FleetBridgeOptions = {},
  ) {
    this.sendToRenderer = sendToRenderer;
    this.activityFeed = activityFeed;
    this.recoveryDelaysMs = options.recoveryDelaysMs?.length
      ? options.recoveryDelaysMs
      : DEFAULT_RECOVERY_DELAYS_MS;
    const userData = app.isReady()
      ? app.getPath('userData')
      : path.join(os.homedir(), '.codebuddy-cowork');
    this.registryPath = path.join(userData, 'fleet-peers.json');
  }

  setActivityFeed(activityFeed: ActivityFeed | null): void {
    this.activityFeed = activityFeed;
  }

  /** Load persisted peers and connect each one. Safe to call multiple times. */
  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.registryPath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedFile;
      for (const p of parsed.peers ?? []) {
        const meta: FleetPeer = {
          id: p.id,
          url: p.url,
          label: p.label,
          addedAt: p.addedAt,
          status: 'disconnected',
        };
        this.peers.set(p.id, newPeerEntry(meta, p.apiKey, p.jwt));
      }
      log(`[FleetBridge] Loaded ${this.peers.size} persisted peer(s)`);
    } catch {
      // First launch — no registry yet
    }
    // Best-effort connect all peers in parallel; failures are recorded on the peer.
    await Promise.all(Array.from(this.peers.keys()).map((id) => this.connectPeer(id)));
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
      const file: PersistedFile = {
        peers: Array.from(this.peers.values()).map((entry) => ({
          id: entry.meta.id,
          url: entry.meta.url,
          label: entry.meta.label,
          addedAt: entry.meta.addedAt,
          apiKey: entry.apiKey,
          jwt: entry.jwt,
        })),
      };
      await fs.writeFile(this.registryPath, JSON.stringify(file, null, 2), 'utf-8');
    } catch (err) {
      logError('[FleetBridge] save failed:', err);
    }
  }

  /**
   * `lastError` holds the cause of the last failure. Transitional states keep it
   * visible (the close that follows an AUTH_FAILED must not hide the refusal);
   * only a successful authentication clears it.
   */
  private updateStatus(peerId: string, status: FleetPeerStatus, error?: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.meta.status = status;
    entry.statusGeneration += 1;
    if (error !== undefined) {
      entry.meta.lastError = error;
    } else if (status === 'authenticated') {
      entry.meta.lastError = undefined;
    }
    this.emitPeerUpdate(peerId);
  }

  private emitPeerUpdate(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    this.sendToRenderer({ type: 'fleet.peer.update', payload: { peer: { ...entry.meta } } });
  }

  private async refreshPeerCapabilities(
    peerId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const entry = this.peers.get(peerId);
    // peer.describe needs an authenticated socket; asking earlier would only
    // replace the real connection cause with NOT_AUTHENTICATED.
    if (this.stopped || !entry?.listener || entry.meta.status !== 'authenticated') return;
    const now = Date.now();
    const last = this.capabilityRefreshedAt.get(peerId) ?? 0;
    if (!options.force && now - last < CAPABILITY_REFRESH_INTERVAL_MS) return;

    const listener = entry.listener;
    const generation = entry.statusGeneration;
    // The answer belongs to the connection state it was asked in: a reconnect,
    // an AUTH_FAILED or a removal in between makes it stale either way.
    const stillAsked = () =>
      !this.stopped &&
      this.peers.get(peerId) === entry &&
      entry.listener === listener &&
      entry.statusGeneration === generation;
    try {
      const raw = (await listener.request(
        'peer.describe',
        {},
        { timeoutMs: PEER_DESCRIBE_TIMEOUT_MS },
      )) as { capabilities?: unknown; peerChatProvider?: unknown };
      if (!stillAsked()) return;
      entry.meta.capability = normalizeCapability(raw.capabilities);
      entry.meta.peerChatProvider = normalizePeerChatProvider(raw.peerChatProvider);
      entry.meta.lastError = undefined;
      this.capabilityRefreshedAt.set(peerId, now);
      this.emitPeerUpdate(peerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!stillAsked()) return;
      entry.meta.lastError = `peer.describe failed: ${message}`;
      this.emitPeerUpdate(peerId);
      logWarn(`[FleetBridge] peer.describe failed for ${peerId}:`, message);
    }
  }

  private async refreshAllCapabilities(options: { force?: boolean } = {}): Promise<void> {
    await Promise.all(
      Array.from(this.peers.keys()).map((id) =>
        this.refreshPeerCapabilities(id, options).catch((err) =>
          logWarn(`[FleetBridge] refreshPeerCapabilities(${id}) failed:`, err),
        ),
      ),
    );
  }

  /** Connect (or reconnect) a peer. Concurrent callers share the attempt in flight. */
  private connectPeer(peerId: string): Promise<ConnectOutcome> {
    const entry = this.peers.get(peerId);
    if (!entry) return Promise.resolve({ success: false, error: 'Peer not found' });
    if (!entry.pendingConnect) {
      entry.pendingConnect = this.openListener(peerId, entry).finally(() => {
        entry.pendingConnect = undefined;
      });
    }
    return entry.pendingConnect;
  }

  private async openListener(peerId: string, entry: PeerEntry): Promise<ConnectOutcome> {
    this.cancelRecovery(entry);
    // Every await below can straddle shutdown() or removePeer(): re-check both
    // before touching the entry, so neither can be followed by a new socket.
    const abandoned = (): ConnectOutcome | null => {
      if (this.stopped) return { success: false, error: BRIDGE_STOPPED };
      if (this.peers.get(peerId) !== entry) return { success: false, error: 'Peer removed' };
      return null;
    };
    const early = abandoned();
    if (early) return early;
    const mod = await loadFleetModule();
    const afterLoad = abandoned();
    if (afterLoad) return afterLoad;
    if (!mod) {
      const error = 'Fleet listener module unavailable';
      this.updateStatus(peerId, 'error', error);
      return { success: false, error };
    }
    const previous = entry.listener;
    if (previous) {
      // Detach before tearing down so the old socket's close/error events are ignored.
      entry.listener = null;
      try {
        await previous.disconnect();
      } catch {
        /* ignore */
      }
      const afterTeardown = abandoned();
      if (afterTeardown) return afterTeardown;
    }

    const listener = new mod.FleetListener({
      url: entry.meta.url,
      apiKey: entry.apiKey,
      jwt: entry.jwt,
      autoReconnect: true,
      historyCapacity: 0, // we keep our own ring on the bridge level
    });
    entry.listener = listener;
    entry.credentialsRejected = false;
    this.updateStatus(peerId, 'connecting');
    // A replaced or removed listener can still emit late events; they must not
    // repaint the peer or duplicate its event stream.
    const isCurrent = () =>
      !this.stopped && this.peers.get(peerId) === entry && entry.listener === listener;

    listener.on('connected', () => {
      if (isCurrent()) this.updateStatus(peerId, 'connected');
    });
    listener.on('authenticated', () => {
      if (!isCurrent()) return;
      entry.recoveryAttempt = 0;
      this.updateStatus(peerId, 'authenticated');
      void this.refreshPeerCapabilities(peerId, { force: true });
    });
    listener.on('disconnected', () => {
      if (isCurrent()) this.updateStatus(peerId, 'disconnected');
    });
    listener.on('reconnecting', () => {
      if (isCurrent()) this.updateStatus(peerId, 'reconnecting');
    });
    listener.on('reconnected', () => {
      if (!isCurrent()) return;
      this.updateStatus(peerId, 'authenticated');
      void this.refreshPeerCapabilities(peerId, { force: true });
    });
    listener.on('exhausted', (...args: unknown[]) => {
      if (!isCurrent()) return;
      const total = (args[0] as { totalAttempts?: unknown } | undefined)?.totalAttempts;
      const attempts = typeof total === 'number' ? `${total} attempts` : 'repeated attempts';
      const cause = entry.meta.lastError ? `: ${entry.meta.lastError}` : '';
      this.updateStatus(peerId, 'error', `Auto-reconnect gave up after ${attempts}${cause}`);
      this.scheduleRecovery(peerId, entry);
    });
    listener.on('error', (...args: unknown[]) => {
      if (!isCurrent()) return;
      const err = args[0];
      if (isCredentialRejection(err)) entry.credentialsRejected = true;
      const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
      this.updateStatus(peerId, 'error', msg);
    });
    listener.on('fleet:event', (...args: unknown[]) => {
      if (!isCurrent()) return;
      const data = args[0] as { type?: string; payload?: Record<string, unknown> } | undefined;
      if (!data || typeof data.type !== 'string') return;
      const payload = data.payload ?? {};
      const source = payload.source as { hostname?: string; agentId?: string } | undefined;
      const record: FleetEventRecord = {
        peerId,
        type: data.type,
        payload,
        receivedAt: Date.now(),
        hostname: source?.hostname,
        agentId: source?.agentId,
      };
      this.events.push(record);
      while (this.events.length > EVENT_RING_CAPACITY) {
        this.events.shift();
      }
      const peerMeta = this.peers.get(peerId)?.meta;
      if (peerMeta) {
        peerMeta.lastSeenAt = record.receivedAt;
        peerMeta.lastEventType = record.type;
        this.applyChatSessionEvent(peerMeta, record);
        this.applyHeartbeatLoad(peerMeta, record);
        this.sendToRenderer({ type: 'fleet.peer.update', payload: { peer: { ...peerMeta } } });
      }
      this.sendToRenderer({ type: 'fleet.event', payload: record });
    });

    try {
      await listener.connect();
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isCurrent()) return { success: false, error: msg };
      if (isCredentialRejection(err)) entry.credentialsRejected = true;
      this.updateStatus(peerId, 'error', msg);
      logWarn(`[FleetBridge] Connect failed for ${peerId}: ${msg}`);
      // The core listener only auto-reconnects after a first authentication, so a
      // peer that is down when the attempt starts is ours to retry.
      this.scheduleRecovery(peerId, entry);
      return { success: false, error: msg };
    }
  }

  private scheduleRecovery(peerId: string, entry: PeerEntry): void {
    if (this.stopped || entry.credentialsRejected || entry.recoveryTimer) return;
    if (this.peers.get(peerId) !== entry) return;
    const delays = this.recoveryDelaysMs;
    const delayMs = delays[Math.min(entry.recoveryAttempt, delays.length - 1)];
    entry.recoveryAttempt += 1;
    entry.recoveryTimer = setTimeout(() => {
      entry.recoveryTimer = undefined;
      if (this.stopped || this.peers.get(peerId) !== entry) return;
      void this.connectPeer(peerId);
    }, delayMs);
    entry.recoveryTimer.unref?.();
  }

  private cancelRecovery(entry: PeerEntry): void {
    if (!entry.recoveryTimer) return;
    clearTimeout(entry.recoveryTimer);
    entry.recoveryTimer = undefined;
  }

  async listPeers(): Promise<FleetPeer[]> {
    await this.refreshAllCapabilities();
    return Array.from(this.peers.values()).map((e) => ({ ...e.meta }));
  }

  /**
   * Keep the cached capability's load fields live from the 30s
   * heartbeat beacons, so the router's load term and the utilization
   * strip don't wait for the next (5-min) capability refresh.
   */
  private applyHeartbeatLoad(peer: FleetPeer, record: FleetEventRecord): void {
    if (record.type !== 'fleet:peer:heartbeat' || !peer.capability) return;
    const payload = record.payload;
    if (typeof payload.activeRequests === 'number' && payload.activeRequests >= 0) {
      peer.capability.activeRequests = payload.activeRequests;
    }
    if (typeof payload.maxConcurrency === 'number' && payload.maxConcurrency > 0) {
      peer.capability.maxConcurrency = payload.maxConcurrency;
    }
  }

  private applyChatSessionEvent(peer: FleetPeer, record: FleetEventRecord): void {
    if (!record.type.startsWith('fleet:chat-session:')) return;
    const payload = record.payload;
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
    if (!sessionId) return;
    this.recordChatSessionActivity(peer, record);

    if (record.type === 'fleet:chat-session:end') {
      peer.chatSessions = (peer.chatSessions ?? []).filter((s) => s.sessionId !== sessionId);
      return;
    }

    const existing = (peer.chatSessions ?? []).find((s) => s.sessionId === sessionId);
    const model = typeof payload.model === 'string' ? payload.model : existing?.model;
    const dispatchProfile =
      typeof payload.dispatchProfile === 'string'
        ? payload.dispatchProfile
        : existing?.dispatchProfile;
    const turnCount =
      typeof payload.turnCount === 'number' && Number.isFinite(payload.turnCount)
        ? Math.max(0, Math.floor(payload.turnCount))
        : existing?.turnCount ?? 0;
    const next = {
      sessionId,
      model,
      dispatchProfile,
      turnCount,
      startedAt: existing?.startedAt ?? record.receivedAt,
      lastTurnAt:
        record.type === 'fleet:chat-session:turn'
          ? record.receivedAt
          : existing?.lastTurnAt,
    };

    const withoutCurrent = (peer.chatSessions ?? []).filter((s) => s.sessionId !== sessionId);
    peer.chatSessions = [...withoutCurrent, next].slice(-8);
  }

  private recordChatSessionActivity(peer: FleetPeer, record: FleetEventRecord): void {
    if (!this.activityFeed) return;
    if (!record.type.startsWith('fleet:chat-session:')) return;
    const payload = record.payload;
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
    if (!sessionId) return;

    const peerLabel = peer.label || peer.id;
    const dispatchProfile =
      typeof payload.dispatchProfile === 'string' ? payload.dispatchProfile : undefined;
    const model = typeof payload.model === 'string' ? payload.model : undefined;
    const turnCount =
      typeof payload.turnCount === 'number' && Number.isFinite(payload.turnCount)
        ? Math.max(0, Math.floor(payload.turnCount))
        : undefined;
    const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
    const source = payload.source as { hostname?: unknown; agentId?: unknown } | undefined;
    const baseMetadata = {
      peerId: record.peerId,
      peerLabel,
      sessionId,
      sessionShortId: shortSessionId(sessionId),
      ...(dispatchProfile ? { dispatchProfile } : {}),
      ...(model ? { model } : {}),
      ...(turnCount !== undefined ? { turnCount } : {}),
      ...(reason ? { reason } : {}),
      ...(typeof source?.hostname === 'string' ? { hostname: source.hostname } : {}),
      ...(typeof source?.agentId === 'string' ? { agentId: source.agentId } : {}),
    };

    if (record.type === 'fleet:chat-session:start') {
      this.activityFeed.record({
        type: 'fleet.chatSession.started',
        title: 'Fleet chat session opened',
        description: `${peerLabel} · ${shortSessionId(sessionId)}`,
        metadata: baseMetadata,
      });
      return;
    }
    if (record.type === 'fleet:chat-session:turn') {
      this.activityFeed.record({
        type: 'fleet.chatSession.turn',
        title: 'Fleet chat turn completed',
        description: `${peerLabel} · turn ${turnCount ?? '?'}`,
        metadata: baseMetadata,
      });
      return;
    }
    if (record.type === 'fleet:chat-session:end') {
      this.activityFeed.record({
        type: 'fleet.chatSession.ended',
        title: 'Fleet chat session closed',
        description: `${peerLabel} · ${reason ?? 'end'}`,
        metadata: baseMetadata,
      });
    }
  }

  async refreshCapabilities(peerId?: string): Promise<{
    success: boolean;
    peer?: FleetPeer;
    peers?: FleetPeer[];
    error?: string;
  }> {
    if (peerId) {
      const target = this.peers.get(peerId);
      if (!target) {
        return { success: false, error: `Unknown peer: ${peerId}` };
      }
      if (target.meta.status !== 'authenticated') {
        return {
          success: false,
          error: `Peer ${peerId} is not connected (${target.meta.status}); reconnect it first`,
          peer: { ...target.meta },
        };
      }
      await this.refreshPeerCapabilities(peerId, { force: true });
      const entry = this.peers.get(peerId);
      return entry
        ? { success: true, peer: { ...entry.meta } }
        : { success: false, error: `Unknown peer: ${peerId}` };
    }

    await this.refreshAllCapabilities({ force: true });
    return {
      success: true,
      peers: Array.from(this.peers.values()).map((e) => ({ ...e.meta })),
    };
  }

  async addPeer(input: {
    url: string;
    apiKey?: string;
    jwt?: string;
    label?: string;
  }): Promise<{ success: boolean; peer?: FleetPeer; error?: string }> {
    if (!input.url) return { success: false, error: 'url required' };
    if (!input.apiKey && !input.jwt) {
      return { success: false, error: 'apiKey or jwt required' };
    }
    const id = sanitizeId(input.label || input.url);
    if (this.peers.has(id)) {
      return { success: false, error: `Peer ${id} already exists` };
    }
    const meta: FleetPeer = {
      id,
      url: input.url,
      label: input.label,
      addedAt: Date.now(),
      status: 'disconnected',
    };
    this.peers.set(id, newPeerEntry(meta, input.apiKey, input.jwt));
    await this.save();
    this.sendToRenderer({ type: 'fleet.peer.update', payload: { peer: { ...meta } } });
    void this.connectPeer(id);
    return { success: true, peer: { ...meta } };
  }

  async removePeer(peerId: string): Promise<{ success: boolean }> {
    const entry = this.peers.get(peerId);
    if (!entry) return { success: false };
    this.cancelRecovery(entry);
    // Forget the peer first so the teardown cannot re-emit it to the renderer.
    this.peers.delete(peerId);
    const listener = entry.listener;
    entry.listener = null;
    if (listener) {
      try {
        await listener.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.capabilityRefreshedAt.delete(peerId);
    this.events = this.events.filter((e) => e.peerId !== peerId);
    await this.save();
    return { success: true };
  }

  /** Resolves once the attempt settles, with the failure cause when it did not authenticate. */
  async reconnectPeer(peerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.peers.has(peerId)) return { success: false, error: 'Peer not found' };
    const outcome = await this.connectPeer(peerId);
    return outcome.success ? { success: true } : { success: false, error: outcome.error };
  }

  async getRecentEvents(peerId?: string, limit = 100): Promise<FleetEventRecord[]> {
    const filtered = peerId ? this.events.filter((e) => e.peerId === peerId) : this.events;
    return filtered.slice(-limit);
  }

  /**
   * Wiring W1 — invoke a peer-rpc method on a connected peer.
   *
   * Throws if the peer is unknown or its listener is not yet
   * authenticated. Caller (saga-runner) is responsible for the retry
   * policy and step bookkeeping.
   */
  async peerRequest(
    peerId: string,
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number; traceId?: string; depth?: number } = {},
  ): Promise<unknown> {
    const entry = this.peers.get(peerId);
    if (!entry) {
      throw new Error(`peer not found: ${peerId}`);
    }
    if (!entry.listener) {
      throw new Error(`peer ${peerId} has no active listener (status=${entry.meta.status})`);
    }
    return entry.listener.request(method, params, options);
  }

  /** Close every socket; resolves once no connection attempt is left in flight. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    const inFlight: Promise<ConnectOutcome>[] = [];
    for (const entry of this.peers.values()) {
      this.cancelRecovery(entry);
      if (entry.pendingConnect) inFlight.push(entry.pendingConnect);
      const listener = entry.listener;
      entry.listener = null;
      if (listener) {
        try {
          await listener.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
    // Attempts see `stopped` at their next checkpoint, or fail on the socket closed above.
    await Promise.allSettled(inFlight);
  }
}

function newPeerEntry(meta: FleetPeer, apiKey?: string, jwt?: string): PeerEntry {
  return {
    meta,
    apiKey,
    jwt,
    listener: null,
    recoveryAttempt: 0,
    credentialsRejected: false,
    statusGeneration: 0,
  };
}

function normalizePeerChatProvider(raw: unknown): FleetPeerChatProvider | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as {
    provider?: unknown;
    model?: unknown;
    isLocal?: unknown;
  };
  if (
    typeof candidate.provider !== 'string' ||
    typeof candidate.model !== 'string' ||
    typeof candidate.isLocal !== 'boolean'
  ) {
    return null;
  }
  return {
    provider: candidate.provider,
    model: candidate.model,
    isLocal: candidate.isLocal,
  };
}

function normalizeCapability(raw: unknown): FleetCapability | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as Partial<FleetCapability>;
  if (!Array.isArray(candidate.models)) return undefined;
  const models = candidate.models.filter((model): model is FleetCapability['models'][number] => (
    Boolean(model) &&
    typeof model.id === 'string' &&
    typeof model.contextWindow === 'number' &&
    Array.isArray(model.strengths) &&
    typeof model.provider === 'string'
  ));
  if (models.length === 0) return undefined;
  const egress = candidate.egress === 'lan' || candidate.egress === 'cloud'
    ? candidate.egress
    : 'local';
  return {
    egress,
    machineLabel: typeof candidate.machineLabel === 'string'
      ? candidate.machineLabel
      : '',
    machineSpec: candidate.machineSpec,
    maxConcurrency: candidate.maxConcurrency,
    activeRequests: candidate.activeRequests,
    models,
  };
}

let singleton: FleetBridge | null = null;

function shortSessionId(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : sessionId.slice(0, 12);
}

export function getFleetBridge(
  sendToRenderer?: (event: ServerEvent) => void,
  activityFeed?: ActivityFeed | null,
): FleetBridge {
  if (!singleton) {
    if (!sendToRenderer) {
      throw new Error('FleetBridge requires sendToRenderer on first init');
    }
    singleton = new FleetBridge(sendToRenderer, activityFeed ?? null);
  } else if (activityFeed !== undefined) {
    singleton.setActivityFeed(activityFeed);
  }
  return singleton;
}
