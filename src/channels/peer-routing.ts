/**
 * Agent Peer Routing
 *
 * OpenClaw-inspired message routing system that binds inbound messages
 * to specific agent configurations by (channel, accountId, peer).
 *
 * Peer matches always take priority over channel-wide rules.
 *
 * Usage:
 * ```typescript
 * const router = getPeerRouter();
 *
 * // Route a specific user's WhatsApp messages to Claude Opus
 * router.addRoute({
 *   channelType: 'whatsapp',
 *   peerId: 'user-123',
 *   agent: { model: 'claude-3-opus', systemPrompt: 'Be helpful' }
 * });
 *
 * // Route all Discord messages to Grok
 * router.addRoute({
 *   channelType: 'discord',
 *   agent: { model: 'grok-3' }
 * });
 *
 * // Resolve route for a message
 * const route = router.resolve(message);
 * ```
 */

import { EventEmitter } from 'events';
import type { ChannelType, InboundMessage } from './index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Agent configuration for a route
 */
export interface RouteAgentConfig {
  /** Agent ID (for multi-agent setups) */
  agentId?: string;
  /** Model to use */
  model?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Max tool rounds */
  maxToolRounds?: number;
  /** Temperature */
  temperature?: number;
  /** Tools allowlist */
  allowedTools?: string[];
  /** Tools denylist */
  deniedTools?: string[];
  /** Custom agent metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A routing rule
 */
export interface PeerRoute {
  /** Unique route ID */
  id: string;
  /** Route name/label */
  name: string;
  /** Route description */
  description?: string;
  /** Channel type to match (undefined = all channels) */
  channelType?: ChannelType;
  /** Account ID to match (for multi-account setups) */
  accountId?: string;
  /** Peer ID to match (undefined = all peers on channel) */
  peerId?: string;
  /** Channel ID to match (for specific groups/DMs) */
  channelId?: string;
  /** Agent configuration for this route */
  agent: RouteAgentConfig;
  /** Priority (higher = checked first) */
  priority: number;
  /** Whether this route is active */
  enabled: boolean;
  /** Conditions for matching */
  conditions?: RouteCondition[];
  /** Creation timestamp */
  createdAt: Date;
}

/**
 * Additional conditions for route matching
 */
export interface RouteCondition {
  /** Condition type */
  type: 'time-range' | 'message-pattern' | 'content-type' | 'is-dm' | 'is-group';
  /** Condition value */
  value: string | boolean;
}

/**
 * Result of route resolution
 */
export interface ResolvedRoute {
  /** Matched route */
  route: PeerRoute;
  /** Match type (how the route was matched) */
  matchType: 'peer' | 'channel-id' | 'channel-type' | 'account' | 'default';
  /** Match specificity (higher = more specific) */
  specificity: number;
  /** Agent config from the route */
  agent: RouteAgentConfig;
}

/**
 * Peer router configuration
 */
export interface PeerRouterConfig {
  /** Default agent config when no route matches */
  defaultAgent: RouteAgentConfig;
  /** Enable logging of routing decisions */
  logDecisions: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_ROUTER_CONFIG: PeerRouterConfig = {
  defaultAgent: {},
  logDecisions: false,
};

// ============================================================================
// Peer Router
// ============================================================================

export class PeerRouter extends EventEmitter {
  private config: PeerRouterConfig;
  private routes: Map<string, PeerRoute> = new Map();
  private routeCounter = 0;
  private routingHistory: Array<{
    messageId: string;
    timestamp: Date;
    route: ResolvedRoute | null;
  }> = [];

  constructor(config: Partial<PeerRouterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config };
  }

  // ==========================================================================
  // Route Management
  // ==========================================================================

  /**
   * Add a routing rule
   */
  addRoute(route: Omit<PeerRoute, 'id' | 'createdAt'> & { id?: string }): PeerRoute {
    const fullRoute: PeerRoute = {
      ...route,
      id: route.id || `route-${++this.routeCounter}`,
      createdAt: new Date(),
    };

    this.routes.set(fullRoute.id, fullRoute);
    this.emit('route:added', fullRoute);
    return fullRoute;
  }

  /**
   * Remove a routing rule
   */
  removeRoute(routeId: string): boolean {
    const route = this.routes.get(routeId);
    if (route) {
      this.routes.delete(routeId);
      this.emit('route:removed', route);
      return true;
    }
    return false;
  }

  /**
   * Update a routing rule
   */
  updateRoute(routeId: string, updates: Partial<PeerRoute>): PeerRoute | null {
    const route = this.routes.get(routeId);
    if (!route) return null;

    const updated = { ...route, ...updates, id: route.id, createdAt: route.createdAt };
    this.routes.set(routeId, updated);
    this.emit('route:updated', updated);
    return updated;
  }

  /**
   * Enable/disable a route
   */
  toggleRoute(routeId: string, enabled: boolean): boolean {
    const route = this.routes.get(routeId);
    if (!route) return false;
    route.enabled = enabled;
    this.emit('route:toggled', route, enabled);
    return true;
  }

  /**
   * Get a route by ID
   */
  getRoute(routeId: string): PeerRoute | undefined {
    return this.routes.get(routeId);
  }

  /**
   * List all routes (sorted by priority descending)
   */
  listRoutes(): PeerRoute[] {
    return Array.from(this.routes.values())
      .sort((a, b) => b.priority - a.priority);
  }

  // ==========================================================================
  // Route Resolution
  // ==========================================================================

  /**
   * Resolve the best route for an inbound message.
   * Peer matches take priority over channel-wide rules.
   *
   * Resolution order (highest to lowest priority):
   * 1. Exact peer match (channel + accountId + peer)
   * 2. Channel ID match (specific group/DM)
   * 3. Channel type + account match
   * 4. Channel type match (all peers on channel)
   * 5. Default agent config
   */
  resolve(message: InboundMessage, accountId?: string): ResolvedRoute | null {
    const candidates: ResolvedRoute[] = [];

    for (const route of this.routes.values()) {
      if (!route.enabled) continue;

      const match = this.matchRoute(route, message, accountId);
      if (match) {
        candidates.push(match);
      }
    }

    // Sort by specificity (highest first), then by priority
    candidates.sort((a, b) => {
      if (a.specificity !== b.specificity) return b.specificity - a.specificity;
      return b.route.priority - a.route.priority;
    });

    const result = candidates[0] || null;

    // Track routing history
    this.routingHistory.push({
      messageId: message.id,
      timestamp: new Date(),
      route: result,
    });

    // Keep only last 1000 routing decisions
    if (this.routingHistory.length > 1000) {
      this.routingHistory = this.routingHistory.slice(-500);
    }

    if (result) {
      this.emit('route:matched', result, message);
    } else {
      this.emit('route:unmatched', message);
    }

    return result;
  }

  /**
   * Get effective agent config for a message (resolves route + applies defaults)
   */
  getAgentConfig(message: InboundMessage, accountId?: string): RouteAgentConfig {
    const resolved = this.resolve(message, accountId);
    if (resolved) {
      return { ...this.config.defaultAgent, ...resolved.agent };
    }
    return { ...this.config.defaultAgent };
  }

  // ==========================================================================
  // Matching Logic
  // ==========================================================================

  /**
   * Check if a route matches a message
   */
  private matchRoute(
    route: PeerRoute,
    message: InboundMessage,
    accountId?: string
  ): ResolvedRoute | null {
    let specificity = 0;
    let matchType: ResolvedRoute['matchType'] = 'default';

    // Check channel type
    if (route.channelType) {
      if (route.channelType !== message.channel.type) return null;
      specificity += 10;
      matchType = 'channel-type';
    }

    // Check account ID
    if (route.accountId) {
      if (route.accountId !== accountId) return null;
      specificity += 20;
      matchType = 'account';
    }

    // Check channel ID (specific group/DM)
    if (route.channelId) {
      if (route.channelId !== message.channel.id) return null;
      specificity += 30;
      matchType = 'channel-id';
    }

    // Check peer ID (most specific)
    if (route.peerId) {
      if (route.peerId !== message.sender.id) return null;
      specificity += 50;
      matchType = 'peer';
    }

    // Check additional conditions
    if (route.conditions) {
      for (const condition of route.conditions) {
        if (!this.checkCondition(condition, message)) return null;
      }
      specificity += route.conditions.length * 5;
    }

    // If no criteria specified, it's a catch-all (lowest specificity)
    if (specificity === 0) {
      specificity = 1;
    }

    return {
      route,
      matchType,
      specificity,
      agent: route.agent,
    };
  }

  /**
   * Check a single route condition
   */
  private checkCondition(condition: RouteCondition, message: InboundMessage): boolean {
    switch (condition.type) {
      case 'is-dm':
        return message.channel.isDM === condition.value;

      case 'is-group':
        return message.channel.isGroup === condition.value;

      case 'content-type':
        return message.contentType === condition.value;

      case 'message-pattern': {
        const pattern = new RegExp(condition.value as string, 'i');
        return pattern.test(message.content);
      }

      case 'time-range': {
        const [start, end] = (condition.value as string).split('-').map(Number);
        const hour = new Date().getHours();
        return hour >= start && hour <= end;
      }

      default:
        return true;
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getStats(): {
    totalRoutes: number;
    activeRoutes: number;
    routesByChannel: Record<string, number>;
    routingDecisions: number;
    matchRate: number;
  } {
    const routesByChannel: Record<string, number> = {};
    let activeRoutes = 0;

    for (const route of this.routes.values()) {
      if (route.enabled) activeRoutes++;
      const channel = route.channelType || 'any';
      routesByChannel[channel] = (routesByChannel[channel] || 0) + 1;
    }

    const matched = this.routingHistory.filter(h => h.route !== null).length;
    const total = this.routingHistory.length;

    return {
      totalRoutes: this.routes.size,
      activeRoutes,
      routesByChannel,
      routingDecisions: total,
      matchRate: total > 0 ? matched / total : 0,
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  dispose(): void {
    this.routes.clear();
    this.routingHistory = [];
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let routerInstance: PeerRouter | null = null;

export function getPeerRouter(config?: Partial<PeerRouterConfig>): PeerRouter {
  if (!routerInstance) {
    routerInstance = new PeerRouter(config);
  }
  return routerInstance;
}

export function resetPeerRouter(): void {
  if (routerInstance) {
    routerInstance.dispose();
  }
  routerInstance = null;
}
