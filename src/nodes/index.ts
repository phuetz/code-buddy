/**
 * Companion Node System
 *
 * Manages companion app nodes (macOS, iOS, Android) that connect
 * to the Gateway via WebSocket for device-level capabilities.
 *
 * Inspired by OpenClaw's node system:
 * - macOS: menu bar control, voice wake, push-to-talk
 * - iOS: voice trigger, canvas, camera
 * - Android: camera, screen capture, location, notifications, contacts
 *
 * Nodes pair via short codes and communicate through the Gateway WS.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

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

export interface NodeInvocationResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

export interface NodeManagerConfig {
  pairingCodeLength: number;
  pairingTimeoutMs: number;
  heartbeatIntervalMs: number;
  maxNodes: number;
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

  constructor(config?: Partial<NodeManagerConfig>) {
    super();
    this.config = {
      pairingCodeLength: config?.pairingCodeLength ?? 6,
      pairingTimeoutMs: config?.pairingTimeoutMs ?? 300_000, // 5 minutes
      heartbeatIntervalMs: config?.heartbeatIntervalMs ?? 30_000,
      maxNodes: config?.maxNodes ?? 10,
    };
  }

  static getInstance(config?: Partial<NodeManagerConfig>): NodeManager {
    if (!NodeManager.instance) {
      NodeManager.instance = new NodeManager(config);
    }
    return NodeManager.instance;
  }

  static resetInstance(): void {
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
      this.nodes.delete(nodeId);
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

    // In production, this would send a WS message to the node and await response.
    // For now, return a placeholder indicating the capability was dispatched.
    this.emit('node:invoke', { node, invocation });

    return {
      success: true,
      data: { dispatched: true, capability: invocation.capability },
      durationMs: Date.now() - start,
    };
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
