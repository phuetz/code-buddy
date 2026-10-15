/**
 * Companion Node System
 *
 * Manages companion app nodes (macOS, iOS, Android) that connect
 * to the Gateway via WebSocket for device-level capabilities.
 *
 * Advanced enterprise architecture for node system:
 * - macOS: menu bar control, voice wake, push-to-talk
 * - iOS: voice trigger, canvas, camera
 * - Android: camera, screen capture, location, notifications, contacts
 *
 * Nodes pair via short codes and communicate through the Gateway WS.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

export type NodePlatform = 'macos' | 'ios' | 'android' | 'linux' | 'windows';

export type NodeCapability =
  | 'camera.snap'
  | 'camera.clip'
  | 'screen.record'
  | 'screen.capture'
  | 'location.get'
  | 'notification.send'
  | 'notification.list'
  | 'system.run'
  | 'system.notify'
  | 'contacts.list'
  | 'calendar.list'
  | 'calendar.create'
  | 'sms.send'
  | 'sms.list'
  | 'photos.recent'
  | 'motion.activity'
  | 'voice.wake'
  | 'voice.talk'
  | 'canvas.push'
  | 'canvas.snapshot'
  | 'app.update';

export interface NodeInfo {
  id: string;
  name: string;
  platform: NodePlatform;
  capabilities: NodeCapability[];
  pairedAt: Date;
  lastSeen: Date;
  status: 'online' | 'offline' | 'pairing';
  version?: string;
  osVersion?: string;
  batteryLevel?: number;
}

export interface NodePairingRequest {
  code: string;
  platform: NodePlatform;
  name: string;
  capabilities: NodeCapability[];
  expiresAt: Date;
}

export interface NodeInvocation {
  nodeId: string;
  capability: NodeCapability;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface NodeInvocationRequest extends NodeInvocation {
  id: string;
  requestedAt: string;
}

export interface NodeInvocationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  durationMs?: number;
}

export interface CalendarListParams {
  timeMin?: string;
  timeMax?: string;
  limit?: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
}

export interface CalendarListData {
  events: CalendarEvent[];
  timezone?: string;
}

export interface NodeManagerConfig {
  persistPath?: string;
  pairingCodeLength: number;
  pairingTimeoutMs: number;
  heartbeatIntervalMs: number;
  maxNodes: number;
  invocationTimeoutMs: number;
  maxInvocationTimeoutMs: number;
}

interface PendingInvocation {
  nodeId: string;
  startedAt: number;
  timer: NodeJS.Timeout;
  resolve(result: NodeInvocationResult): void;
}

// ============================================================================
// Platform Capability Maps
// ============================================================================

const PLATFORM_CAPABILITIES: Record<NodePlatform, NodeCapability[]> = {
  macos: [
    'system.run', 'system.notify', 'screen.capture', 'screen.record',
    'voice.wake', 'voice.talk', 'canvas.push', 'canvas.snapshot',
    'notification.send', 'camera.snap',
  ],
  ios: [
    'camera.snap', 'camera.clip', 'location.get', 'voice.wake',
    'voice.talk', 'canvas.push', 'canvas.snapshot', 'notification.send',
    'photos.recent', 'contacts.list', 'motion.activity',
  ],
  android: [
    'camera.snap', 'camera.clip', 'screen.capture', 'screen.record',
    'location.get', 'notification.send', 'notification.list',
    'sms.send', 'sms.list', 'photos.recent', 'contacts.list',
    'calendar.list', 'calendar.create', 'motion.activity',
    'voice.talk', 'canvas.push', 'canvas.snapshot', 'app.update',
  ],
  linux: [
    'system.run', 'system.notify', 'screen.capture', 'screen.record',
    'notification.send',
  ],
  windows: [
    'system.run', 'system.notify', 'screen.capture', 'screen.record',
    'notification.send',
  ],
};

// ============================================================================
// Node Manager
// ============================================================================

export class NodeManager extends EventEmitter {
  private static instance: NodeManager | null = null;
  private nodes: Map<string, NodeInfo> = new Map();
  private pendingPairings: Map<string, NodePairingRequest> = new Map();
  private config: NodeManagerConfig;
  private pendingInvocations = new Map<string, PendingInvocation>();

  constructor(config?: Partial<NodeManagerConfig>) {
    super();
    this.config = {
      pairingCodeLength: config?.pairingCodeLength ?? 6,
      pairingTimeoutMs: config?.pairingTimeoutMs ?? 300_000, // 5 minutes
      heartbeatIntervalMs: config?.heartbeatIntervalMs ?? 30_000,
      maxNodes: config?.maxNodes ?? 10,
      invocationTimeoutMs: config?.invocationTimeoutMs ?? 30_000,
      maxInvocationTimeoutMs: config?.maxInvocationTimeoutMs ?? 120_000,
      ...(config?.persistPath ? { persistPath: config.persistPath } : {}),
    };
    this.loadState();
  }

  private loadState(): void {
    const file = this.config.persistPath;
    if (!file) return;
    const state = readJsonAtomicSync<{ pendingPairings?: NodePairingRequest[]; nodes?: NodeInfo[] } | null>(file, null, {
      mode: 0o600,
      isValid: (value): value is { pendingPairings?: NodePairingRequest[]; nodes?: NodeInfo[] } =>
        Boolean(value && typeof value === 'object' && !Array.isArray(value)),
    });
    const now = Date.now();
    for (const item of state?.pendingPairings ?? []) {
      const expiresAt = new Date(item.expiresAt);
      if (typeof item.code === 'string' && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now) {
        this.pendingPairings.set(item.code, { ...item, expiresAt });
      }
    }
    for (const item of state?.nodes ?? []) {
      if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      this.nodes.set(item.id, {
        ...item, pairedAt: new Date(item.pairedAt), lastSeen: new Date(item.lastSeen), status: 'offline',
      });
    }
  }

  private saveState(): void {
    const file = this.config.persistPath;
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeJsonAtomicSync(file, {
      pendingPairings: [...this.pendingPairings.values()].filter((item) => item.expiresAt.getTime() > Date.now()),
      nodes: [...this.nodes.values()],
    }, { mode: 0o600 });
  }

  static getInstance(config?: Partial<NodeManagerConfig>): NodeManager {
    if (!NodeManager.instance) {
      NodeManager.instance = new NodeManager(config);
    }
    return NodeManager.instance;
  }

  static resetInstance(): void {
    NodeManager.instance?.shutdown();
    NodeManager.instance = null;
  }

  // --------------------------------------------------------------------------
  // Pairing
  // --------------------------------------------------------------------------

  generatePairingCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
    let code = '';
    for (let i = 0; i < this.config.pairingCodeLength; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  requestPairing(platform: NodePlatform, name: string): NodePairingRequest {
    if (this.nodes.size >= this.config.maxNodes) {
      throw new Error(`Maximum number of nodes (${this.config.maxNodes}) reached`);
    }

    const code = this.generatePairingCode();
    const request: NodePairingRequest = {
      code,
      platform,
      name,
      capabilities: PLATFORM_CAPABILITIES[platform] || [],
      expiresAt: new Date(Date.now() + this.config.pairingTimeoutMs),
    };

    this.pendingPairings.set(code, request);
    this.saveState();
    logger.info(`Node pairing requested: ${name} (${platform}) — code: ${code}`);
    this.emit('pairing:requested', request);

    return request;
  }

  approvePairing(code: string): NodeInfo {
    const request = this.pendingPairings.get(code);
    if (!request) {
      throw new Error(`No pending pairing with code: ${code}`);
    }
    if (request.expiresAt < new Date()) {
      this.pendingPairings.delete(code);
      this.saveState();
      throw new Error(`Pairing code ${code} has expired`);
    }

    this.pendingPairings.delete(code);

    const nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const node: NodeInfo = {
      id: nodeId,
      name: request.name,
      platform: request.platform,
      capabilities: request.capabilities,
      pairedAt: new Date(),
      lastSeen: new Date(),
      status: 'online',
    };

    this.nodes.set(nodeId, node);
    this.saveState();
    logger.info(`Node paired: ${node.name} (${node.platform}) — id: ${nodeId}`);
    this.emit('node:paired', node);

    return node;
  }

  // --------------------------------------------------------------------------
  // Node Management
  // --------------------------------------------------------------------------

  listNodes(filter?: { platform?: NodePlatform; status?: NodeInfo['status'] }): NodeInfo[] {
    let nodes = Array.from(this.nodes.values());
    if (filter?.platform) {
      nodes = nodes.filter(n => n.platform === filter.platform);
    }
    if (filter?.status) {
      nodes = nodes.filter(n => n.status === filter.status);
    }
    return nodes;
  }

  getNode(nodeId: string): NodeInfo | undefined {
    return this.nodes.get(nodeId);
  }

  removeNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (node) {
      this.cancelNodeInvocations(nodeId, 'Node was removed');
      this.nodes.delete(nodeId);
      this.saveState();
      logger.info(`Node removed: ${node.name} (${nodeId})`);
      this.emit('node:removed', node);
      return true;
    }
    return false;
  }

  describeNode(nodeId: string): {
    info: NodeInfo;
    capabilities: NodeCapability[];
    platformDefaults: NodeCapability[];
  } | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    return {
      info: { ...node },
      capabilities: [...node.capabilities],
      platformDefaults: PLATFORM_CAPABILITIES[node.platform] || [],
    };
  }

  heartbeat(nodeId: string, meta?: { batteryLevel?: number; version?: string }): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.lastSeen = new Date();
    node.status = 'online';
    if (meta?.batteryLevel !== undefined) node.batteryLevel = meta.batteryLevel;
    if (meta?.version) node.version = meta.version;
  }

  markOffline(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.status = 'offline';
      this.cancelNodeInvocations(nodeId, `Node ${node.name} went offline`);
      this.emit('node:offline', node);
    }
  }

  // --------------------------------------------------------------------------
  // Invocation
  // --------------------------------------------------------------------------

  async invoke(invocation: NodeInvocation): Promise<NodeInvocationResult> {
    const node = this.nodes.get(invocation.nodeId);
    if (!node) {
      return { success: false, error: `Node not found: ${invocation.nodeId}` };
    }
    if (node.status !== 'online') {
      return { success: false, error: `Node ${node.name} is ${node.status}` };
    }
    if (!node.capabilities.includes(invocation.capability)) {
      return {
        success: false,
        error: `Node ${node.name} does not support: ${invocation.capability}`,
      };
    }

    const start = Date.now();
    logger.debug(`Node invoke: ${node.name} → ${invocation.capability}`, invocation.params);
    if (this.listenerCount('node:invoke') === 0) {
      return {
        success: false,
        error: `No transport is connected for node ${node.name}`,
        durationMs: Date.now() - start,
      };
    }

    const request: NodeInvocationRequest = {
      ...invocation,
      id: randomUUID(),
      requestedAt: new Date(start).toISOString(),
    };
    const requestedTimeout = invocation.timeoutMs ?? this.config.invocationTimeoutMs;
    const safeRequestedTimeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout
      : this.config.invocationTimeoutMs;
    const safeMaximumTimeout = Number.isFinite(this.config.maxInvocationTimeoutMs) &&
      this.config.maxInvocationTimeoutMs > 0
      ? this.config.maxInvocationTimeoutMs
      : 120_000;
    const timeoutMs = Math.max(1, Math.min(safeMaximumTimeout, safeRequestedTimeout));

    return new Promise<NodeInvocationResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingInvocations.delete(request.id);
        resolve({
          success: false,
          error: `Node invocation timed out after ${timeoutMs}ms`,
          durationMs: Date.now() - start,
        });
      }, timeoutMs);
      timer.unref?.();
      this.pendingInvocations.set(request.id, {
        nodeId: node.id,
        startedAt: start,
        timer,
        resolve,
      });

      try {
        this.emit('node:invoke', { node: { ...node }, invocation: request });
      } catch (error) {
        const pending = this.pendingInvocations.get(request.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingInvocations.delete(request.id);
        resolve({
          success: false,
          error: `Node transport failed: ${error instanceof Error ? error.message : String(error)}`,
          durationMs: Date.now() - start,
        });
      }
    });
  }

  /** Complete a correlated invocation. The responding node must match the request owner. */
  completeInvocation(
    nodeId: string,
    invocationId: string,
    result: Omit<NodeInvocationResult, 'durationMs'>,
  ): boolean {
    const pending = this.pendingInvocations.get(invocationId);
    if (!pending || pending.nodeId !== nodeId) return false;
    clearTimeout(pending.timer);
    this.pendingInvocations.delete(invocationId);
    pending.resolve({
      success: result.success,
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.error ? { error: result.error } : {}),
      durationMs: Math.max(0, Date.now() - pending.startedAt),
    });
    return true;
  }

  getPendingInvocationCount(): number {
    return this.pendingInvocations.size;
  }

  // --------------------------------------------------------------------------
  // Convenience Methods
  // --------------------------------------------------------------------------

  async cameraSnap(nodeId: string): Promise<NodeInvocationResult> {
    return this.invoke({ nodeId, capability: 'camera.snap' });
  }

  async getLocation(nodeId: string): Promise<NodeInvocationResult> {
    return this.invoke({ nodeId, capability: 'location.get' });
  }

  async listCalendar(
    nodeId: string,
    params: CalendarListParams = {},
  ): Promise<NodeInvocationResult<CalendarListData>> {
    const invalidRange = validateCalendarRange(params);
    if (invalidRange) return { success: false, error: invalidRange };
    const limit = Math.max(1, Math.min(200, Math.trunc(params.limit ?? 50)));
    const result = await this.invoke({
      nodeId,
      capability: 'calendar.list',
      params: {
        ...(params.timeMin ? { timeMin: params.timeMin } : {}),
        ...(params.timeMax ? { timeMax: params.timeMax } : {}),
        limit,
      },
    });
    if (!result.success) {
      return {
        success: false,
        ...(result.error ? { error: result.error } : {}),
        ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      };
    }
    try {
      return {
        success: true,
        data: normalizeCalendarListData(result.data, limit),
        ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      };
    } catch (error) {
      return {
        success: false,
        error: `Invalid calendar.list response: ${error instanceof Error ? error.message : String(error)}`,
        ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      };
    }
  }

  async sendNotification(
    nodeId: string,
    title: string,
    body: string
  ): Promise<NodeInvocationResult> {
    return this.invoke({
      nodeId,
      capability: 'notification.send',
      params: { title, body },
    });
  }

  async captureScreen(nodeId: string): Promise<NodeInvocationResult> {
    return this.invoke({ nodeId, capability: 'screen.capture' });
  }

  async systemRun(nodeId: string, command: string): Promise<NodeInvocationResult> {
    return this.invoke({
      nodeId,
      capability: 'system.run',
      params: { command },
    });
  }

  getPlatformCapabilities(platform: NodePlatform): NodeCapability[] {
    return PLATFORM_CAPABILITIES[platform] || [];
  }

  getPendingPairings(): NodePairingRequest[] {
    const now = new Date();
    // Clean up expired
    for (const [code, req] of this.pendingPairings) {
      if (req.expiresAt < now) {
        this.pendingPairings.delete(code);
      }
    }
    return Array.from(this.pendingPairings.values());
  }

  shutdown(): void {
    for (const nodeId of this.nodes.keys()) {
      this.cancelNodeInvocations(nodeId, 'Node manager shut down');
    }
    this.removeAllListeners();
  }

  private cancelNodeInvocations(nodeId: string, error: string): void {
    for (const [id, pending] of this.pendingInvocations) {
      if (pending.nodeId !== nodeId) continue;
      clearTimeout(pending.timer);
      this.pendingInvocations.delete(id);
      pending.resolve({
        success: false,
        error,
        durationMs: Math.max(0, Date.now() - pending.startedAt),
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isIsoInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function validateCalendarRange(params: CalendarListParams): string | null {
  if (params.timeMin && !isIsoInstant(params.timeMin)) return 'timeMin must be an ISO instant with an explicit offset';
  if (params.timeMax && !isIsoInstant(params.timeMax)) return 'timeMax must be an ISO instant with an explicit offset';
  if (params.timeMin && params.timeMax && Date.parse(params.timeMax) <= Date.parse(params.timeMin)) {
    return 'timeMax must be later than timeMin';
  }
  if (params.limit !== undefined && (!Number.isFinite(params.limit) || params.limit < 1)) {
    return 'limit must be a positive number';
  }
  return null;
}

function normalizeCalendarListData(value: unknown, limit: number): CalendarListData {
  const root = Array.isArray(value) ? { events: value } : value;
  if (!isRecord(root) || !Array.isArray(root.events)) throw new Error('events must be an array');
  const timezone = nonEmptyString(root.timezone);
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new Error('timezone must be a valid IANA identifier');
    }
  }
  const events = root.events.slice(0, limit).map((raw, index): CalendarEvent => {
    if (!isRecord(raw)) throw new Error(`event ${index + 1} must be an object`);
    const id = nonEmptyString(raw.id);
    const title = nonEmptyString(raw.title) ?? nonEmptyString(raw.summary);
    const start = nonEmptyString(raw.start);
    const end = nonEmptyString(raw.end);
    const allDay = raw.allDay === true || (start ? isCivilDate(start) : false);
    if (!id) throw new Error(`event ${index + 1} has no id`);
    if (!title) throw new Error(`event ${index + 1} has no title`);
    if (!start || !(allDay ? isCivilDate(start) : isIsoInstant(start))) {
      throw new Error(`event ${index + 1} has an invalid start`);
    }
    if (end && !(allDay ? isCivilDate(end) : isIsoInstant(end))) {
      throw new Error(`event ${index + 1} has an invalid end`);
    }
    if (end && Date.parse(end) < Date.parse(start)) {
      throw new Error(`event ${index + 1} ends before it starts`);
    }
    return {
      id,
      title,
      start,
      ...(end ? { end } : {}),
      allDay,
      ...(nonEmptyString(raw.location) ? { location: nonEmptyString(raw.location) } : {}),
    };
  });
  events.sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
  return { events, ...(timezone ? { timezone } : {}) };
}

// ============================================================================
// CLI Tool Definitions
// ============================================================================

export const NODE_COMMANDS = {
  list: 'buddy nodes list [--platform <platform>] [--status <status>]',
  describe: 'buddy nodes describe <nodeId>',
  pair: 'buddy nodes pair <platform> <name>',
  approve: 'buddy nodes approve <code>',
  remove: 'buddy nodes remove <nodeId>',
  invoke: 'buddy nodes invoke <nodeId> <capability> [--params <json>]',
} as const;
