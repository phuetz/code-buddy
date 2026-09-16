/**
 * Gateway Lifecycle Manager
 *
 * Unified lifecycle management (start/stop/restart/status) for the
 * messaging gateway subsystem. Tracks which channel adapters are
 * currently active and provides per-channel readiness information.
 */

import { EventEmitter } from 'events';
import type { ChannelType, ChannelConfig, BaseChannel } from './core.js';
import { ChannelManager, getChannelManager, resetChannelManager } from './core.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Per-channel readiness state
 */
export type ChannelReadiness = 'connected' | 'disconnected' | 'error' | 'not-configured';

/**
 * Per-channel status entry in the gateway status report
 */
export interface GatewayChannelStatus {
  /** Channel type identifier */
  channelId: ChannelType;
  /** Current readiness state */
  readiness: ChannelReadiness;
  /** Whether the channel is authenticated */
  authenticated: boolean;
  /** Last activity timestamp (ISO string) */
  lastActivity?: string;
  /** Last successful long-poll timestamp (ISO string) */
  lastSuccessfulPoll?: string;
  /** Error message if readiness is 'error' */
  error?: string;
  /** Additional platform-specific info */
  info?: Record<string, unknown>;
}

/**
 * Full gateway status report
 */
export interface GatewayStatus {
  /** Overall gateway health */
  ok: boolean;
  /** Timestamp of this report */
  generatedAt: string;
  /** Total number of registered channels */
  totalChannels: number;
  /** Number of connected channels */
  connectedCount: number;
  /** Number of channels in error state */
  errorCount: number;
  /** Number of disconnected channels */
  disconnectedCount: number;
  /** Per-channel status entries */
  channels: GatewayChannelStatus[];
}

/**
 * Events emitted by the GatewayLifecycleManager
 */
export interface GatewayLifecycleEvents {
  'channel:started': (channelId: ChannelType) => void;
  'channel:stopped': (channelId: ChannelType) => void;
  'channel:error': (channelId: ChannelType, error: Error) => void;
  'gateway:started': () => void;
  'gateway:stopped': () => void;
}

// ============================================================================
// Gateway Lifecycle Manager
// ============================================================================

/**
 * Manages the lifecycle of the messaging gateway and its channel adapters.
 *
 * Wraps the existing ChannelManager with explicit start/stop/restart/status
 * semantics for individual channels and the entire gateway.
 */
export class GatewayLifecycleManager extends EventEmitter {
  private manager: ChannelManager;
  private activeChannels: Set<ChannelType> = new Set();
  private channelErrors: Map<ChannelType, string> = new Map();

  constructor(manager?: ChannelManager) {
    super();
    this.manager = manager ?? getChannelManager();
  }

  /**
   * Get the underlying ChannelManager.
   */
  getManager(): ChannelManager {
    return this.manager;
  }

  /**
   * Start a single channel adapter by its channel type.
   *
   * The channel must already be registered with the ChannelManager.
   * This calls connect() on the adapter and marks it as active.
   *
   * @param channelId - The channel type to start
   * @throws Error if the channel is not registered
   */
  async start(channelId: ChannelType): Promise<void> {
    const channel = this.manager.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel '${channelId}' is not registered`);
    }

    try {
      await channel.connect();
      this.activeChannels.add(channelId);
      this.channelErrors.delete(channelId);
      this.emit('channel:started', channelId);
      logger.debug('Gateway: channel started', { channelId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.channelErrors.set(channelId, message);
      this.emit('channel:error', channelId, err instanceof Error ? err : new Error(message));
      throw err;
    }
  }

  /**
   * Stop a single channel adapter by its channel type.
   *
   * Calls disconnect() on the adapter and removes it from the active set.
   *
   * @param channelId - The channel type to stop
   * @throws Error if the channel is not registered
   */
  async stop(channelId: ChannelType): Promise<void> {
    const channel = this.manager.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel '${channelId}' is not registered`);
    }

    try {
      await channel.disconnect();
    } catch (err) {
      logger.debug('Gateway: error during channel disconnect', {
        channelId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.activeChannels.delete(channelId);
    this.channelErrors.delete(channelId);
    this.emit('channel:stopped', channelId);
    logger.debug('Gateway: channel stopped', { channelId });
  }

  /**
   * Restart a single channel adapter (stop + start).
   *
   * @param channelId - The channel type to restart
   */
  async restart(channelId: ChannelType): Promise<void> {
    if (this.activeChannels.has(channelId)) {
      await this.stop(channelId);
    }
    await this.start(channelId);
  }

  /**
   * Start all registered channel adapters.
   */
  async startAll(): Promise<void> {
    const channels = this.manager.getAllChannels();
    const errors: Array<{ channelId: ChannelType; error: string }> = [];

    for (const channel of channels) {
      try {
        await this.start(channel.type);
      } catch (err) {
        errors.push({
          channelId: channel.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.emit('gateway:started');

    if (errors.length > 0) {
      logger.debug('Gateway: some channels failed to start', { errors });
    }
  }

  /**
   * Stop all active channel adapters.
   */
  async stopAll(): Promise<void> {
    const activeIds = [...this.activeChannels];

    for (const channelId of activeIds) {
      try {
        await this.stop(channelId);
      } catch (err) {
        logger.debug('Gateway: error stopping channel', {
          channelId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.emit('gateway:stopped');
  }

  /**
   * Get the full gateway status report.
   *
   * Aggregates per-channel readiness from the ChannelManager's status,
   * the active set, and any recorded errors.
   */
  status(): GatewayStatus {
    const channels = this.manager.getAllChannels();
    const channelStatuses: GatewayChannelStatus[] = [];

    let connectedCount = 0;
    let errorCount = 0;
    let disconnectedCount = 0;

    for (const channel of channels) {
      const s = channel.getStatus();
      const errorMsg = this.channelErrors.get(channel.type) ?? s.error;

      let readiness: ChannelReadiness;
      if (errorMsg) {
        readiness = 'error';
        errorCount++;
      } else if (s.connected) {
        readiness = 'connected';
        connectedCount++;
      } else {
        readiness = 'disconnected';
        disconnectedCount++;
      }

      channelStatuses.push({
        channelId: channel.type,
        readiness,
        authenticated: s.authenticated,
        lastActivity: s.lastActivity?.toISOString(),
        lastSuccessfulPoll: s.lastSuccessfulPoll?.toISOString(),
        error: errorMsg,
        info: s.info,
      });
    }

    return {
      ok: errorCount === 0 && channels.length > 0,
      generatedAt: new Date().toISOString(),
      totalChannels: channels.length,
      connectedCount,
      errorCount,
      disconnectedCount,
      channels: channelStatuses,
    };
  }

  /**
   * Check whether a specific channel is currently active.
   */
  isActive(channelId: ChannelType): boolean {
    return this.activeChannels.has(channelId);
  }

  /**
   * Get the set of currently active channel IDs.
   */
  getActiveChannels(): ChannelType[] {
    return [...this.activeChannels];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let lifecycleInstance: GatewayLifecycleManager | null = null;

/**
 * Get the singleton GatewayLifecycleManager instance.
 */
export function getGatewayLifecycle(): GatewayLifecycleManager {
  if (!lifecycleInstance) {
    lifecycleInstance = new GatewayLifecycleManager();
  }
  return lifecycleInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetGatewayLifecycle(): void {
  lifecycleInstance = null;
}
