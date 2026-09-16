/**
 * Gateway device pairing.
 *
 * Transport-agnostic, file-backed registry of paired and pending devices,
 * modelled on the OpenClaw `~/.openclaw/devices/{paired,pending}.json` shape and
 * Hermes' pairing flow (pending -> approve/reject -> scoped device token).
 *
 * Security notes:
 * - Tokens are issued once on approval and returned to the caller; the store
 *   persists only a SHA-256 hash, so the plaintext token never touches disk.
 * - Read/list methods return token-free views; the secret is only comparable via
 *   {@link DevicePairingStore.verifyToken}.
 * - Files are written 0600.
 *
 * Pure of any WebSocket/transport concern so it can back either the production
 * `src/server/websocket` auth path or the `src/gateway` handshake.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export type DeviceRole = 'operator' | 'node' | 'control' | 'webchat';

const DEVICE_ROLES: readonly DeviceRole[] = ['operator', 'node', 'control', 'webchat'];

export function isDeviceRole(value: unknown): value is DeviceRole {
  return typeof value === 'string' && (DEVICE_ROLES as readonly string[]).includes(value);
}

export interface PendingDevice {
  deviceId: string;
  displayName?: string;
  clientId?: string;
  role: DeviceRole;
  requestedScopes: string[];
  requestedAtMs: number;
  publicKey?: string;
}

/** A paired device as stored on disk — holds the token hash, never the token. */
export interface PairedDevice {
  deviceId: string;
  displayName?: string;
  clientId?: string;
  role: DeviceRole;
  scopes: string[];
  /** SHA-256 hex of the issued token. */
  tokenHash: string;
  createdAtMs: number;
  approvedAtMs: number;
  approvedBy?: string;
  lastSeenAtMs?: number;
  lastSeenReason?: string;
}

/** Token-free view returned by list/get/approve so secrets never leak through surfaces. */
export type PairedDeviceView = Omit<PairedDevice, 'tokenHash'>;

export interface DevicePairingStoreConfig {
  /** Directory holding paired.json + pending.json (default ~/.codebuddy/gateway/devices). */
  dir?: string;
  /** Injectable clock (epoch ms) for deterministic tests. */
  now?: () => number;
  /** Injectable token generator for deterministic tests. */
  generateToken?: () => string;
}

export interface PairingRequestInput {
  deviceId: string;
  displayName?: string;
  clientId?: string;
  role?: DeviceRole;
  requestedScopes?: string[];
  publicKey?: string;
}

export interface ApproveInput {
  scopes?: string[];
  role?: DeviceRole;
  approvedBy?: string;
}

export interface PairingRequestResult {
  status: 'paired' | 'pending';
  device: PairedDeviceView | PendingDevice;
}

export interface ApproveResult {
  device: PairedDeviceView;
  /** Plaintext token — shown once; only its hash is persisted. */
  token: string;
}

interface DeviceFile<T> {
  version: number;
  updatedAt: string;
  devices: Record<string, T>;
}

const STORE_VERSION = 1;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

function stripToken(device: PairedDevice): PairedDeviceView {
  const { tokenHash: _tokenHash, ...view } = device;
  return view;
}

function sanitizeScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return [];
  return [...new Set(scopes.filter((s): s is string => typeof s === 'string' && s.trim().length > 0))].sort();
}

export class DevicePairingStore {
  private readonly dir: string;
  private readonly pairedPath: string;
  private readonly pendingPath: string;
  private readonly now: () => number;
  private readonly generateToken: () => string;

  constructor(config: DevicePairingStoreConfig = {}) {
    this.dir = config.dir ?? path.join(os.homedir(), '.codebuddy', 'gateway', 'devices');
    this.pairedPath = path.join(this.dir, 'paired.json');
    this.pendingPath = path.join(this.dir, 'pending.json');
    this.now = config.now ?? (() => Date.now());
    this.generateToken = config.generateToken ?? (() => randomBytes(32).toString('hex'));
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  listPaired(): PairedDeviceView[] {
    return Object.values(this.readFile<PairedDevice>(this.pairedPath).devices).map(stripToken);
  }

  listPending(): PendingDevice[] {
    return Object.values(this.readFile<PendingDevice>(this.pendingPath).devices).map((d) => ({ ...d }));
  }

  getPaired(deviceId: string): PairedDeviceView | null {
    const device = this.readFile<PairedDevice>(this.pairedPath).devices[deviceId];
    return device ? stripToken(device) : null;
  }

  isPaired(deviceId: string): boolean {
    return Boolean(this.readFile<PairedDevice>(this.pairedPath).devices[deviceId]);
  }

  /** Constant-time-ish token check against the stored hash. */
  verifyToken(deviceId: string, token: string): boolean {
    const device = this.readFile<PairedDevice>(this.pairedPath).devices[deviceId];
    if (!device || typeof token !== 'string' || token.length === 0) return false;
    const candidate = Buffer.from(sha256Hex(token));
    const stored = Buffer.from(device.tokenHash);
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  }

  // ── Mutations ───────────────────────────────────────────────────────────────

  /**
   * Record a device's pairing request. Already-paired devices short-circuit to
   * `paired`; everything else is upserted into the pending queue for approval.
   */
  requestPairing(input: PairingRequestInput): PairingRequestResult {
    const deviceId = this.requireDeviceId(input.deviceId);
    const paired = this.readFile<PairedDevice>(this.pairedPath);
    const existing = paired.devices[deviceId];
    if (existing) {
      return { status: 'paired', device: stripToken(existing) };
    }

    const pendingFile = this.readFile<PendingDevice>(this.pendingPath);
    const prior = pendingFile.devices[deviceId];
    const pending: PendingDevice = {
      deviceId,
      role: isDeviceRole(input.role) ? input.role : (prior?.role ?? 'control'),
      requestedScopes: sanitizeScopes(input.requestedScopes ?? prior?.requestedScopes),
      requestedAtMs: prior?.requestedAtMs ?? this.now(),
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : prior?.displayName ? { displayName: prior.displayName } : {}),
      ...(input.clientId?.trim() ? { clientId: input.clientId.trim() } : prior?.clientId ? { clientId: prior.clientId } : {}),
      ...(input.publicKey?.trim() ? { publicKey: input.publicKey.trim() } : prior?.publicKey ? { publicKey: prior.publicKey } : {}),
    };
    pendingFile.devices[deviceId] = pending;
    this.writeFile(this.pendingPath, pendingFile);
    return { status: 'pending', device: { ...pending } };
  }

  /**
   * Approve a device: mint a scoped token, move it from pending to paired, and
   * return the plaintext token exactly once.
   */
  approve(deviceId: string, input: ApproveInput = {}): ApproveResult {
    const id = this.requireDeviceId(deviceId);
    const pendingFile = this.readFile<PendingDevice>(this.pendingPath);
    const pending = pendingFile.devices[id];
    const pairedFile = this.readFile<PairedDevice>(this.pairedPath);
    const prior = pairedFile.devices[id];

    if (!pending && !prior) {
      throw new Error(`Cannot approve unknown device '${id}': no pending request and not already paired.`);
    }

    const token = this.generateToken();
    const role = isDeviceRole(input.role) ? input.role : (pending?.role ?? prior?.role ?? 'control');
    const scopes = sanitizeScopes(
      input.scopes ?? pending?.requestedScopes ?? prior?.scopes ?? [],
    );
    const nowMs = this.now();

    const paired: PairedDevice = {
      deviceId: id,
      role,
      scopes,
      tokenHash: sha256Hex(token),
      createdAtMs: prior?.createdAtMs ?? pending?.requestedAtMs ?? nowMs,
      approvedAtMs: nowMs,
      ...(input.approvedBy?.trim() ? { approvedBy: input.approvedBy.trim() } : {}),
      ...(pending?.displayName ?? prior?.displayName ? { displayName: (pending?.displayName ?? prior?.displayName) as string } : {}),
      ...(pending?.clientId ?? prior?.clientId ? { clientId: (pending?.clientId ?? prior?.clientId) as string } : {}),
      ...(prior?.lastSeenAtMs !== undefined ? { lastSeenAtMs: prior.lastSeenAtMs } : {}),
      ...(prior?.lastSeenReason ? { lastSeenReason: prior.lastSeenReason } : {}),
    };

    pairedFile.devices[id] = paired;
    this.writeFile(this.pairedPath, pairedFile);

    if (pending) {
      delete pendingFile.devices[id];
      this.writeFile(this.pendingPath, pendingFile);
    }

    return { device: stripToken(paired), token };
  }

  /** Reject (remove) a pending pairing request. Returns false if it was not pending. */
  reject(deviceId: string, _reason?: string): boolean {
    const id = this.requireDeviceId(deviceId);
    const pendingFile = this.readFile<PendingDevice>(this.pendingPath);
    if (!pendingFile.devices[id]) return false;
    delete pendingFile.devices[id];
    this.writeFile(this.pendingPath, pendingFile);
    return true;
  }

  /** Revoke a paired device (e.g. lost/compromised). Returns false if not paired. */
  revoke(deviceId: string): boolean {
    const id = this.requireDeviceId(deviceId);
    const pairedFile = this.readFile<PairedDevice>(this.pairedPath);
    if (!pairedFile.devices[id]) return false;
    delete pairedFile.devices[id];
    this.writeFile(this.pairedPath, pairedFile);
    return true;
  }

  /** Record last-seen metadata for a paired device (no-op if unknown). */
  touch(deviceId: string, reason?: string): void {
    const id = this.requireDeviceId(deviceId);
    const pairedFile = this.readFile<PairedDevice>(this.pairedPath);
    const device = pairedFile.devices[id];
    if (!device) return;
    device.lastSeenAtMs = this.now();
    if (reason) device.lastSeenReason = reason;
    this.writeFile(this.pairedPath, pairedFile);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private requireDeviceId(deviceId: string): string {
    const trimmed = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (!trimmed) throw new Error('A non-empty deviceId is required.');
    return trimmed;
  }

  private readFile<T>(filePath: string): DeviceFile<T> {
    const parsed = readJsonAtomicSync<Partial<DeviceFile<T>> | null>(filePath, null, { mode: 0o600 });
    if (parsed?.version === STORE_VERSION && parsed.devices && typeof parsed.devices === 'object') {
      return { version: STORE_VERSION, updatedAt: parsed.updatedAt ?? '', devices: parsed.devices };
    }
    return { version: STORE_VERSION, updatedAt: '', devices: {} };
  }

  private writeFile<T>(filePath: string, file: DeviceFile<T>): void {
    const payload: DeviceFile<T> = {
      version: STORE_VERSION,
      updatedAt: new Date(this.now()).toISOString(),
      devices: file.devices,
    };
    writeJsonAtomicSync(filePath, payload, { mode: 0o600 });
  }

  /** Directory backing this store (for diagnostics/CLI). */
  getDir(): string {
    return this.dir;
  }
}

// ── Production gateway integration (shared singleton + auth helper) ───────────

let sharedStore: DevicePairingStore | null = null;

/**
 * Shared pairing store for the running gateway + the operator CLI, so both read
 * and write the same `~/.codebuddy/gateway/devices` files.
 */
export function getGatewayPairingStore(config?: DevicePairingStoreConfig): DevicePairingStore {
  if (!sharedStore) {
    sharedStore = new DevicePairingStore(config);
  }
  return sharedStore;
}

/** Reset the shared store (tests). */
export function resetGatewayPairingStore(): void {
  sharedStore = null;
}

/** Opt-in gate: device pairing is only enforced when explicitly enabled. */
export function isDevicePairingRequired(): boolean {
  return process.env['CODEBUDDY_GATEWAY_REQUIRE_PAIRING'] === 'true';
}

export interface DeviceAuthInput {
  deviceId?: string;
  deviceToken?: string;
  displayName?: string;
  clientId?: string;
  requestedScopes?: string[];
}

export interface DeviceAuthOutcome {
  /**
   * - `skip`: pairing not required, or no device identity offered → fall through
   *   to the gateway's existing JWT/api-key auth (existing paths stay intact).
   * - `authenticated`: a paired device presented a valid token.
   * - `pending`: an unknown device was queued for operator approval.
   * - `rejected`: an already-paired device presented a missing/invalid token —
   *   an auth failure, not re-queued (it is already approved).
   */
  outcome: 'skip' | 'authenticated' | 'pending' | 'rejected';
  deviceId?: string;
  scopes?: string[];
  message?: string;
}

/**
 * Layer device pairing over the existing gateway auth without replacing it.
 * Returns `skip` (the default, when pairing is off) so callers leave their
 * JWT/api-key flow untouched.
 */
export function authenticateDevice(
  store: DevicePairingStore,
  input: DeviceAuthInput,
  required: boolean = isDevicePairingRequired(),
): DeviceAuthOutcome {
  if (!required) return { outcome: 'skip' };
  const deviceId = input.deviceId?.trim();
  if (!deviceId) return { outcome: 'skip' };

  if (input.deviceToken && store.verifyToken(deviceId, input.deviceToken)) {
    const device = store.getPaired(deviceId);
    store.touch(deviceId, 'authenticate');
    return { outcome: 'authenticated', deviceId, scopes: device?.scopes ?? [] };
  }

  // Already-paired device with a missing/invalid token is an auth failure, not a
  // new pairing request — never re-queue an approved device.
  if (store.isPaired(deviceId)) {
    return { outcome: 'rejected', deviceId, message: 'Invalid device token for a paired device.' };
  }

  store.requestPairing({
    deviceId,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.requestedScopes ? { requestedScopes: input.requestedScopes } : {}),
  });
  return {
    outcome: 'pending',
    deviceId,
    message: 'Device pairing required — request recorded, awaiting operator approval.',
  };
}
