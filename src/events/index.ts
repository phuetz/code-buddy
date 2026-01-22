/**
 * Events Module - Unified Type-Safe Event System
 *
 * This module provides a centralized, type-safe event system for the entire application.
 * It replaces the scattered use of native Node.js EventEmitter with a unified approach.
 *
 * ## Key Features
 *
 * - **Type-safe events**: Full TypeScript support with auto-completion
 * - **Event filtering**: Pattern matching and predicate-based filtering
 * - **Priority handling**: Control execution order of listeners
 * - **Once-only listeners**: Automatically removed after first call
 * - **Event history**: Track recent events for debugging
 * - **Wildcard listeners**: Subscribe to all events
 * - **Backward compatibility**: TypedEventEmitterAdapter for gradual migration
 *
 * ## Usage Examples
 *
 * ### Using TypedEventEmitter directly
 * ```typescript
 * import { TypedEventEmitter, ToolEvents } from './events/index.js';
 *
 * const emitter = new TypedEventEmitter<ToolEvents>();
 *
 * // Type-safe listener
 * emitter.on('tool:started', (event) => {
 *   console.log(`Tool ${event.toolName} started`);
 * });
 *
 * // Emit with auto-completion
 * emitter.emit('tool:started', { toolName: 'bash', args: { command: 'ls' } });
 * ```
 *
 * ### Using TypedEventEmitterAdapter for migration
 * ```typescript
 * import { TypedEventEmitterAdapter, ToolEvents } from './events/index.js';
 *
 * class MyClass extends TypedEventEmitterAdapter<ToolEvents> {
 *   doSomething() {
 *     // New type-safe API
 *     this.emitTyped('tool:started', { toolName: 'search' });
 *
 *     // Old API still works for backward compatibility
 *     this.emit('legacy-event', { data: 'value' });
 *   }
 * }
 * ```
 *
 * ### Using the global EventBus
 * ```typescript
 * import { getGlobalEventBus, AllEvents } from './events/index.js';
 *
 * const bus = getGlobalEventBus();
 * bus.on('agent:started', (event) => console.log('Agent started'));
 * bus.on('tool:completed', (event) => console.log(`Tool ${event.toolName} done`));
 * ```
 *
 * ## Event Categories
 *
 * - Agent events (`agent:*`): Agent lifecycle events
 * - Tool events (`tool:*`): Tool execution events
 * - Session events (`session:*`): User session events
 * - File events (`file:*`): File operation events
 * - Cache events (`cache:*`): Caching system events
 * - Sync events (`sync:*`): Cloud synchronization events
 * - Plugin events (`plugin:*`): Plugin system events
 * - MCP events (`mcp:*`): Model Context Protocol events
 * - Security events (`security:*`): Security-related events
 * - And many more...
 *
 * See the `AllEvents` interface for the complete list of available events.
 */

import { logger } from "../utils/logger.js";
import { EventEmitter } from 'events';

/**
 * Base event interface that all events must extend
 */
export interface BaseEvent {
  type: string;
  timestamp: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Event listener callback type
 * Note: Returns unknown to allow flexible listener implementations (e.g., array.push in tests)
 */
export type EventListener<T extends BaseEvent = BaseEvent> = (event: T) => unknown;

/**
 * Event filter predicate
 */
export type EventFilter<T extends BaseEvent = BaseEvent> = (event: T) => boolean;

/**
 * Listener options
 */
export interface ListenerOptions<T extends BaseEvent = BaseEvent> {
  once?: boolean;
  priority?: number;
  filter?: EventFilter<T>;
}

/**
 * Internal listener wrapper with metadata
 */
interface ListenerWrapper<T extends BaseEvent = BaseEvent> {
  listener: EventListener<T>;
  options: ListenerOptions<T>;
  id: string;
}

/**
 * Event history entry
 */
export interface EventHistoryEntry<T extends BaseEvent = BaseEvent> {
  event: T;
  timestamp: number;
  listenerCount: number;
}

/**
 * Event statistics
 */
export interface EventStats {
  totalEmitted: number;
  totalListeners: number;
  eventCounts: Record<string, number>;
  lastEmitted?: BaseEvent;
}

/**
 * TypedEventEmitter - A type-safe event emitter with advanced features
 */
export class TypedEventEmitter<TEvents extends Record<string, BaseEvent> = Record<string, BaseEvent>> {
  private emitter: EventEmitter;
  private listeners: Map<string, ListenerWrapper[]> = new Map();
  private wildcardListeners: ListenerWrapper[] = [];
  private eventHistory: EventHistoryEntry[] = [];
  private maxHistorySize: number;
  private stats: EventStats;
  private listenerIdCounter: number = 0;
  private enabled: boolean = true;

  constructor(options: { maxHistorySize?: number } = {}) {
    this.emitter = new EventEmitter();
    this.maxHistorySize = options.maxHistorySize ?? 100;
    this.stats = {
      totalEmitted: 0,
      totalListeners: 0,
      eventCounts: {},
    };
  }

  /**
   * Generate a unique listener ID
   */
  private generateListenerId(): string {
    return `listener_${++this.listenerIdCounter}_${Date.now()}`;
  }

  /**
   * Enable or disable the event emitter
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if the emitter is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Emit an event
   */
  emit<K extends keyof TEvents>(type: K, event: Omit<TEvents[K], 'type' | 'timestamp'>): boolean {
    if (!this.enabled) {
      return false;
    }

    const fullEvent = {
      ...event,
      type: type as string,
      timestamp: Date.now(),
    } as TEvents[K];

    // Update stats
    this.stats.totalEmitted++;
    this.stats.eventCounts[type as string] = (this.stats.eventCounts[type as string] || 0) + 1;
    this.stats.lastEmitted = fullEvent;

    // Get listeners for this event type
    const typeListeners = this.listeners.get(type as string) || [];

    // Combine with wildcard listeners
    const allListeners = [...typeListeners, ...this.wildcardListeners];

    // Sort by priority (higher priority first)
    allListeners.sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0));

    // Track history
    this.addToHistory(fullEvent, allListeners.length);

    // Execute listeners
    const listenersToRemove: string[] = [];

    for (const wrapper of allListeners) {
      // Apply filter if present
      if (wrapper.options.filter && !wrapper.options.filter(fullEvent)) {
        continue;
      }

      try {
        const result = wrapper.listener(fullEvent);
        // Handle async listeners
        if (result instanceof Promise) {
          result.catch((error) => {
            // Emit error if there are listeners, otherwise log
            if (this.emitter.listenerCount('error') > 0) {
              this.emitter.emit('error', error);
            } else {
              logger.error('Unhandled async listener error:', error as Error);
            }
          });
        }
      } catch (error) {
        // Emit error if there are listeners, otherwise log silently
        // This allows emit() to continue without throwing
        if (this.emitter.listenerCount('error') > 0) {
          this.emitter.emit('error', error);
        } else {
          logger.error('Unhandled listener error:', error as Error);
        }
      }

      // Mark once listeners for removal
      if (wrapper.options.once) {
        listenersToRemove.push(wrapper.id);
      }
    }

    // Remove once listeners
    for (const id of listenersToRemove) {
      this.removeListenerById(id);
    }

    return allListeners.length > 0;
  }

  /**
   * Add an event listener
   */
  on<K extends keyof TEvents>(
    type: K,
    listener: EventListener<TEvents[K]>,
    options: ListenerOptions<TEvents[K]> = {}
  ): string {
    const id = this.generateListenerId();
    const wrapper: ListenerWrapper<TEvents[K]> = {
      listener,
      options,
      id,
    };

    const typeKey = type as string;
    if (!this.listeners.has(typeKey)) {
      this.listeners.set(typeKey, []);
    }
    this.listeners.get(typeKey)!.push(wrapper as ListenerWrapper);

    this.stats.totalListeners++;

    return id;
  }

  /**
   * Add a one-time event listener
   */
  once<K extends keyof TEvents>(
    type: K,
    listener: EventListener<TEvents[K]>,
    options: Omit<ListenerOptions<TEvents[K]>, 'once'> = {}
  ): string {
    return this.on(type, listener, { ...options, once: true });
  }

  /**
   * Add a wildcard listener that receives all events
   */
  onAny(listener: EventListener<BaseEvent>, options: ListenerOptions<BaseEvent> = {}): string {
    const id = this.generateListenerId();
    const wrapper: ListenerWrapper = {
      listener,
      options,
      id,
    };

    this.wildcardListeners.push(wrapper);
    this.stats.totalListeners++;

    return id;
  }

  /**
   * Remove an event listener by ID
   */
  off(listenerId: string): boolean {
    return this.removeListenerById(listenerId);
  }

  /**
   * Remove all listeners for a specific event type
   */
  offAll<K extends keyof TEvents>(type?: K): void {
    if (type) {
      const typeKey = type as string;
      const count = this.listeners.get(typeKey)?.length ?? 0;
      this.listeners.delete(typeKey);
      this.stats.totalListeners -= count;
    } else {
      // Remove all listeners
      let _totalRemoved = 0;
      for (const listeners of this.listeners.values()) {
        _totalRemoved += listeners.length;
      }
      _totalRemoved += this.wildcardListeners.length;

      this.listeners.clear();
      this.wildcardListeners = [];
      this.stats.totalListeners = 0;
    }
  }

  /**
   * Remove a listener by ID
   */
  private removeListenerById(id: string): boolean {
    // Check type-specific listeners
    for (const [type, listeners] of this.listeners.entries()) {
      const index = listeners.findIndex((w) => w.id === id);
      if (index !== -1) {
        listeners.splice(index, 1);
        this.stats.totalListeners--;
        if (listeners.length === 0) {
          this.listeners.delete(type);
        }
        return true;
      }
    }

    // Check wildcard listeners
    const wildcardIndex = this.wildcardListeners.findIndex((w) => w.id === id);
    if (wildcardIndex !== -1) {
      this.wildcardListeners.splice(wildcardIndex, 1);
      this.stats.totalListeners--;
      return true;
    }

    return false;
  }

  /**
   * Add event to history
   */
  private addToHistory<T extends BaseEvent>(event: T, listenerCount: number): void {
    this.eventHistory.push({
      event,
      timestamp: event.timestamp,
      listenerCount,
    });

    // Trim history if needed
    while (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Get event history
   */
  getHistory(): EventHistoryEntry[] {
    return [...this.eventHistory];
  }

  /**
   * Get filtered event history
   */
  getFilteredHistory<T extends BaseEvent>(filter: EventFilter<T>): EventHistoryEntry<T>[] {
    return this.eventHistory.filter((entry) => filter(entry.event as T)) as EventHistoryEntry<T>[];
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get listener count for a specific event type
   */
  listenerCount<K extends keyof TEvents>(type?: K): number {
    if (type) {
      return (this.listeners.get(type as string)?.length ?? 0) + this.wildcardListeners.length;
    }
    return this.stats.totalListeners;
  }

  /**
   * Get event names that have listeners
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Get event statistics
   */
  getStats(): EventStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalEmitted: 0,
      totalListeners: this.stats.totalListeners,
      eventCounts: {},
    };
  }

  /**
   * Wait for a specific event (returns a Promise)
   */
  waitFor<K extends keyof TEvents>(
    type: K,
    options: { timeout?: number; filter?: EventFilter<TEvents[K]> } = {}
  ): Promise<TEvents[K]> {
    return new Promise((resolve, reject) => {
      const { timeout, filter } = options;
      let timeoutId: NodeJS.Timeout | undefined;

      const listenerId = this.once(
        type,
        (event) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          resolve(event);
        },
        { filter }
      );

      if (timeout) {
        timeoutId = setTimeout(() => {
          this.off(listenerId);
          reject(new Error(`Timeout waiting for event: ${String(type)}`));
        }, timeout);
      }
    });
  }

  /**
   * Pipe events to another emitter
   */
  pipe<K extends keyof TEvents>(
    type: K,
    target: TypedEventEmitter<TEvents>,
    options: { transform?: (event: TEvents[K]) => TEvents[K] } = {}
  ): string {
    return this.on(type, (event) => {
      const transformedEvent = options.transform ? options.transform(event) : event;
      target.emit(type, transformedEvent as Omit<TEvents[K], 'type' | 'timestamp'>);
    });
  }

  /**
   * Create a filtered view of this emitter
   */
  filter<K extends keyof TEvents>(type: K, predicate: EventFilter<TEvents[K]>): FilteredEventEmitter<TEvents, K> {
    return new FilteredEventEmitter(this, type, predicate);
  }

  /**
   * Dispose the emitter and clean up resources
   */
  dispose(): void {
    this.offAll();
    this.clearHistory();
    this.emitter.removeAllListeners();
  }
}

/**
 * FilteredEventEmitter - A view of an event emitter that only passes events matching a filter
 */
export class FilteredEventEmitter<
  TEvents extends Record<string, BaseEvent>,
  K extends keyof TEvents
> {
  private source: TypedEventEmitter<TEvents>;
  private type: K;
  private predicate: EventFilter<TEvents[K]>;
  private listenerIds: string[] = [];

  constructor(source: TypedEventEmitter<TEvents>, type: K, predicate: EventFilter<TEvents[K]>) {
    this.source = source;
    this.type = type;
    this.predicate = predicate;
  }

  /**
   * Add a listener that only receives filtered events
   */
  on(listener: EventListener<TEvents[K]>, options: Omit<ListenerOptions<TEvents[K]>, 'filter'> = {}): string {
    const id = this.source.on(this.type, listener, {
      ...options,
      filter: this.predicate,
    });
    this.listenerIds.push(id);
    return id;
  }

  /**
   * Add a one-time listener that only receives filtered events
   */
  once(listener: EventListener<TEvents[K]>, options: Omit<ListenerOptions<TEvents[K]>, 'filter' | 'once'> = {}): string {
    const id = this.source.once(this.type, listener, {
      ...options,
      filter: this.predicate,
    });
    this.listenerIds.push(id);
    return id;
  }

  /**
   * Remove a specific listener
   */
  off(listenerId: string): boolean {
    const index = this.listenerIds.indexOf(listenerId);
    if (index !== -1) {
      this.listenerIds.splice(index, 1);
    }
    return this.source.off(listenerId);
  }

  /**
   * Remove all listeners created through this filtered emitter
   */
  offAll(): void {
    for (const id of this.listenerIds) {
      this.source.off(id);
    }
    this.listenerIds = [];
  }

  /**
   * Wait for a filtered event
   */
  waitFor(options: { timeout?: number } = {}): Promise<TEvents[K]> {
    return this.source.waitFor(this.type, {
      ...options,
      filter: this.predicate,
    });
  }
}

/**
 * EventBus - A global event bus for application-wide events
 */
export class EventBus<TEvents extends Record<string, BaseEvent> = Record<string, BaseEvent>> extends TypedEventEmitter<TEvents> {
  // Using unknown to allow flexible typing for singleton pattern
  private static instance: unknown = null;

  /**
   * Get the singleton instance
   */
  static getInstance<T extends Record<string, BaseEvent> = Record<string, BaseEvent>>(): EventBus<T> {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus<T>();
    }
    return EventBus.instance as EventBus<T>;
  }

  /**
   * Reset the singleton instance (mainly for testing)
   */
  static resetInstance(): void {
    if (EventBus.instance) {
      (EventBus.instance as EventBus).dispose();
      EventBus.instance = null;
    }
  }
}

// Common event types for the application
export interface AgentEvent extends BaseEvent {
  type: 'agent:started' | 'agent:stopped' | 'agent:error';
  agentId?: string;
  error?: Error;
}

export interface ToolEvent extends BaseEvent {
  type: 'tool:started' | 'tool:completed' | 'tool:error';
  toolName: string;
  args?: Record<string, unknown>;
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
  duration?: number;
}

export interface SessionEvent extends BaseEvent {
  type: 'session:started' | 'session:ended' | 'session:paused' | 'session:resumed';
  sessionId: string;
  userId?: string;
}

export interface MessageEvent extends BaseEvent {
  type: 'message:sent' | 'message:received' | 'message:error';
  messageId?: string;
  content?: string;
  role?: 'user' | 'assistant' | 'system';
}

export interface FileEvent extends BaseEvent {
  type: 'file:created' | 'file:modified' | 'file:deleted' | 'file:read';
  filePath: string;
  operation?: string;
}

// Combined application events map with index signature for compatibility
export interface ApplicationEvents extends Record<string, BaseEvent> {
  'agent:started': AgentEvent;
  'agent:stopped': AgentEvent;
  'agent:error': AgentEvent;
  'tool:started': ToolEvent;
  'tool:completed': ToolEvent;
  'tool:error': ToolEvent;
  'session:started': SessionEvent;
  'session:ended': SessionEvent;
  'session:paused': SessionEvent;
  'session:resumed': SessionEvent;
  'message:sent': MessageEvent;
  'message:received': MessageEvent;
  'message:error': MessageEvent;
  'file:created': FileEvent;
  'file:modified': FileEvent;
  'file:deleted': FileEvent;
  'file:read': FileEvent;
}

// ============================================================================
// Checkpoint Events
// ============================================================================

export interface CheckpointCreatedEvent extends BaseEvent {
  type: 'checkpoint:created';
  checkpoint: {
    id: string;
    name: string;
    timestamp: Date;
    files: Array<{ relativePath: string }>;
  };
}

export interface CheckpointDeletedEvent extends BaseEvent {
  type: 'checkpoint:deleted';
  id: string;
}

export interface UndoNoopEvent extends BaseEvent {
  type: 'undo:noop';
  reason: string;
}

export interface RedoNoopEvent extends BaseEvent {
  type: 'redo:noop';
  reason: string;
}

export interface UndoCompleteEvent extends BaseEvent {
  type: 'undo:complete';
  success: boolean;
  checkpoint: { id: string; name: string };
  restoredFiles: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface RedoCompleteEvent extends BaseEvent {
  type: 'redo:complete';
  success: boolean;
  checkpoint: { id: string; name: string };
  restoredFiles: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface RestoreCompleteEvent extends BaseEvent {
  type: 'restore:complete';
  success: boolean;
  checkpoint: { id: string; name: string };
  restoredFiles: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface CheckpointEvents extends Record<string, BaseEvent> {
  'checkpoint:created': CheckpointCreatedEvent;
  'checkpoint:deleted': CheckpointDeletedEvent;
  'undo:noop': UndoNoopEvent;
  'redo:noop': RedoNoopEvent;
  'undo:complete': UndoCompleteEvent;
  'redo:complete': RedoCompleteEvent;
  'restore:complete': RestoreCompleteEvent;
}

// ============================================================================
// Database Events
// ============================================================================

export interface DatabaseInitializedEvent extends BaseEvent {
  type: 'db:initialized';
}

export interface DatabaseErrorEvent extends BaseEvent {
  type: 'db:error';
  error: Error;
}

export interface DatabaseMigrationEvent extends BaseEvent {
  type: 'db:migration';
  version: number;
  applied: boolean;
}

export interface DatabaseVacuumEvent extends BaseEvent {
  type: 'db:vacuum';
}

export interface DatabaseBackupEvent extends BaseEvent {
  type: 'db:backup';
  path: string;
}

export interface DatabaseClosedEvent extends BaseEvent {
  type: 'db:closed';
}

export interface DatabaseClearedEvent extends BaseEvent {
  type: 'db:cleared';
}

export interface DatabaseEvents extends Record<string, BaseEvent> {
  'db:initialized': DatabaseInitializedEvent;
  'db:error': DatabaseErrorEvent;
  'db:migration': DatabaseMigrationEvent;
  'db:vacuum': DatabaseVacuumEvent;
  'db:backup': DatabaseBackupEvent;
  'db:closed': DatabaseClosedEvent;
  'db:cleared': DatabaseClearedEvent;
}

// ============================================================================
// Sync Events
// ============================================================================

export interface SyncStartedEvent extends BaseEvent {
  type: 'sync:started';
  direction?: 'push' | 'pull' | 'bidirectional';
}

export interface SyncCompletedEvent extends BaseEvent {
  type: 'sync:completed';
  result: {
    success: boolean;
    itemsSynced: number;
    bytesUploaded: number;
    bytesDownloaded: number;
    duration: number;
  };
}

export interface SyncFailedEvent extends BaseEvent {
  type: 'sync:failed';
  error: string;
}

export interface SyncProgressEvent extends BaseEvent {
  type: 'sync:progress';
  progress: number;
}

export interface SyncItemUploadedEvent extends BaseEvent {
  type: 'sync:item_uploaded';
  path: string;
  size: number;
}

export interface SyncItemDownloadedEvent extends BaseEvent {
  type: 'sync:item_downloaded';
  path: string;
  size: number;
}

export interface SyncConflictDetectedEvent extends BaseEvent {
  type: 'sync:conflict_detected';
  conflict: {
    path: string;
    local: { version: string; modifiedAt: Date; size: number };
    remote: { version: string; modifiedAt: Date; size: number };
  };
}

export interface SyncConflictResolvedEvent extends BaseEvent {
  type: 'sync:conflict_resolved';
  conflict: {
    path: string;
    resolution?: 'local' | 'remote' | 'merged';
  };
}

export interface CloudSyncEvents extends Record<string, BaseEvent> {
  'sync:started': SyncStartedEvent;
  'sync:completed': SyncCompletedEvent;
  'sync:failed': SyncFailedEvent;
  'sync:progress': SyncProgressEvent;
  'sync:item_uploaded': SyncItemUploadedEvent;
  'sync:item_downloaded': SyncItemDownloadedEvent;
  'sync:conflict_detected': SyncConflictDetectedEvent;
  'sync:conflict_resolved': SyncConflictResolvedEvent;
}

// ============================================================================
// Tool Events (Extended)
// ============================================================================

export interface ToolRegisteredEvent extends BaseEvent {
  type: 'tool:registered';
  toolName: string;
  description?: string;
}

export interface ToolInstantiatedEvent extends BaseEvent {
  type: 'tool:instantiated';
  toolName: string;
}

export interface ToolDisabledEvent extends BaseEvent {
  type: 'tool:disabled';
  toolName: string;
  reason?: string;
}

export interface ToolEvents extends Record<string, BaseEvent> {
  'tool:started': ToolEvent;
  'tool:completed': ToolEvent;
  'tool:error': ToolEvent;
  'tool:registered': ToolRegisteredEvent;
  'tool:instantiated': ToolInstantiatedEvent;
  'tool:disabled': ToolDisabledEvent;
}

// ============================================================================
// Cache Events
// ============================================================================

export interface CacheHitEvent extends BaseEvent {
  type: 'cache:hit';
  key: string;
  cacheType?: string;
}

export interface CacheMissEvent extends BaseEvent {
  type: 'cache:miss';
  key: string;
  cacheType?: string;
}

export interface CacheSetEvent extends BaseEvent {
  type: 'cache:set';
  key: string;
  size?: number;
  ttl?: number;
}

export interface CacheDeleteEvent extends BaseEvent {
  type: 'cache:delete';
  key: string;
}

export interface CacheClearEvent extends BaseEvent {
  type: 'cache:clear';
  entriesRemoved?: number;
}

export interface CacheExpiredEvent extends BaseEvent {
  type: 'cache:expired';
  key: string;
}

export interface CacheEvictedEvent extends BaseEvent {
  type: 'cache:evicted';
  key: string;
  reason: 'size' | 'ttl' | 'manual';
}

export interface CacheEvents extends Record<string, BaseEvent> {
  'cache:hit': CacheHitEvent;
  'cache:miss': CacheMissEvent;
  'cache:set': CacheSetEvent;
  'cache:delete': CacheDeleteEvent;
  'cache:clear': CacheClearEvent;
  'cache:expired': CacheExpiredEvent;
  'cache:evicted': CacheEvictedEvent;
}

// ============================================================================
// Plugin Events
// ============================================================================

export interface PluginLoadedEvent extends BaseEvent {
  type: 'plugin:loaded';
  pluginId: string;
  pluginName: string;
  version?: string;
}

export interface PluginUnloadedEvent extends BaseEvent {
  type: 'plugin:unloaded';
  pluginId: string;
}

export interface PluginErrorEvent extends BaseEvent {
  type: 'plugin:error';
  pluginId: string;
  error: string;
}

export interface PluginInstalledEvent extends BaseEvent {
  type: 'plugin:installed';
  pluginId: string;
  source: string;
}

export interface PluginUninstalledEvent extends BaseEvent {
  type: 'plugin:uninstalled';
  pluginId: string;
}

export interface PluginEvents extends Record<string, BaseEvent> {
  'plugin:loaded': PluginLoadedEvent;
  'plugin:unloaded': PluginUnloadedEvent;
  'plugin:error': PluginErrorEvent;
  'plugin:installed': PluginInstalledEvent;
  'plugin:uninstalled': PluginUninstalledEvent;
}

// ============================================================================
// MCP Events
// ============================================================================

export interface MCPConnectedEvent extends BaseEvent {
  type: 'mcp:connected';
  serverId: string;
  serverName?: string;
}

export interface MCPDisconnectedEvent extends BaseEvent {
  type: 'mcp:disconnected';
  serverId: string;
  reason?: string;
}

export interface MCPErrorEvent extends BaseEvent {
  type: 'mcp:error';
  serverId: string;
  error: string;
}

export interface MCPToolCallEvent extends BaseEvent {
  type: 'mcp:tool_call';
  serverId: string;
  toolName: string;
  args?: Record<string, unknown>;
}

export interface MCPToolResultEvent extends BaseEvent {
  type: 'mcp:tool_result';
  serverId: string;
  toolName: string;
  success: boolean;
  duration?: number;
}

export interface MCPEvents extends Record<string, BaseEvent> {
  'mcp:connected': MCPConnectedEvent;
  'mcp:disconnected': MCPDisconnectedEvent;
  'mcp:error': MCPErrorEvent;
  'mcp:tool_call': MCPToolCallEvent;
  'mcp:tool_result': MCPToolResultEvent;
}

// ============================================================================
// Provider Events
// ============================================================================

export interface ProviderConnectedEvent extends BaseEvent {
  type: 'provider:connected';
  providerId: string;
  providerName: string;
}

export interface ProviderDisconnectedEvent extends BaseEvent {
  type: 'provider:disconnected';
  providerId: string;
}

export interface ProviderErrorEvent extends BaseEvent {
  type: 'provider:error';
  providerId: string;
  error: string;
}

export interface ProviderSwitchedEvent extends BaseEvent {
  type: 'provider:switched';
  fromProvider?: string;
  toProvider: string;
}

export interface ProviderFallbackEvent extends BaseEvent {
  type: 'provider:fallback';
  fromProvider: string;
  toProvider: string;
  reason: string;
}

export interface ProviderEvents extends Record<string, BaseEvent> {
  'provider:connected': ProviderConnectedEvent;
  'provider:disconnected': ProviderDisconnectedEvent;
  'provider:error': ProviderErrorEvent;
  'provider:switched': ProviderSwitchedEvent;
  'provider:fallback': ProviderFallbackEvent;
}

// ============================================================================
// Security Events
// ============================================================================

export interface SecurityPermissionGrantedEvent extends BaseEvent {
  type: 'security:permission_granted';
  permission: string;
  resource?: string;
}

export interface SecurityPermissionDeniedEvent extends BaseEvent {
  type: 'security:permission_denied';
  permission: string;
  resource?: string;
  reason?: string;
}

export interface SecurityModeChangedEvent extends BaseEvent {
  type: 'security:mode_changed';
  fromMode: string;
  toMode: string;
}

export interface SecurityViolationEvent extends BaseEvent {
  type: 'security:violation';
  violationType: string;
  details: string;
}

export interface SecurityEvents extends Record<string, BaseEvent> {
  'security:permission_granted': SecurityPermissionGrantedEvent;
  'security:permission_denied': SecurityPermissionDeniedEvent;
  'security:mode_changed': SecurityModeChangedEvent;
  'security:violation': SecurityViolationEvent;
}

// ============================================================================
// Workflow Events
// ============================================================================

export interface WorkflowStartedEvent extends BaseEvent {
  type: 'workflow:started';
  workflowId: string;
  workflowName: string;
}

export interface WorkflowCompletedEvent extends BaseEvent {
  type: 'workflow:completed';
  workflowId: string;
  success: boolean;
  duration?: number;
}

export interface WorkflowStepStartedEvent extends BaseEvent {
  type: 'workflow:step_started';
  workflowId: string;
  stepId: string;
  stepName: string;
}

export interface WorkflowStepCompletedEvent extends BaseEvent {
  type: 'workflow:step_completed';
  workflowId: string;
  stepId: string;
  success: boolean;
}

export interface WorkflowErrorEvent extends BaseEvent {
  type: 'workflow:error';
  workflowId: string;
  stepId?: string;
  error: string;
}

export interface WorkflowEvents extends Record<string, BaseEvent> {
  'workflow:started': WorkflowStartedEvent;
  'workflow:completed': WorkflowCompletedEvent;
  'workflow:step_started': WorkflowStepStartedEvent;
  'workflow:step_completed': WorkflowStepCompletedEvent;
  'workflow:error': WorkflowErrorEvent;
}

// ============================================================================
// Streaming Events
// ============================================================================

export interface StreamStartedEvent extends BaseEvent {
  type: 'stream:started';
  streamId: string;
}

export interface StreamChunkEvent extends BaseEvent {
  type: 'stream:chunk';
  streamId: string;
  chunkSize: number;
  totalReceived?: number;
}

export interface StreamCompletedEvent extends BaseEvent {
  type: 'stream:completed';
  streamId: string;
  totalSize: number;
  duration?: number;
}

export interface StreamErrorEvent extends BaseEvent {
  type: 'stream:error';
  streamId: string;
  error: string;
}

export interface StreamEvents extends Record<string, BaseEvent> {
  'stream:started': StreamStartedEvent;
  'stream:chunk': StreamChunkEvent;
  'stream:completed': StreamCompletedEvent;
  'stream:error': StreamErrorEvent;
}

// ============================================================================
// Memory Events
// ============================================================================

export interface MemoryStoredEvent extends BaseEvent {
  type: 'memory:stored';
  memoryId: string;
  memoryType: string;
}

export interface MemoryRetrievedEvent extends BaseEvent {
  type: 'memory:retrieved';
  memoryId: string;
  memoryType: string;
}

export interface MemoryDeletedEvent extends BaseEvent {
  type: 'memory:deleted';
  memoryId: string;
}

export interface MemoryClearedEvent extends BaseEvent {
  type: 'memory:cleared';
  entriesRemoved: number;
}

export interface MemoryEvents extends Record<string, BaseEvent> {
  'memory:stored': MemoryStoredEvent;
  'memory:retrieved': MemoryRetrievedEvent;
  'memory:deleted': MemoryDeletedEvent;
  'memory:cleared': MemoryClearedEvent;
}

// ============================================================================
// Context Events
// ============================================================================

export interface ContextLoadedEvent extends BaseEvent {
  type: 'context:loaded';
  contextType: string;
  size?: number;
}

export interface ContextUpdatedEvent extends BaseEvent {
  type: 'context:updated';
  contextType: string;
  changeType: 'add' | 'remove' | 'modify';
}

export interface ContextCompressedEvent extends BaseEvent {
  type: 'context:compressed';
  originalSize: number;
  compressedSize: number;
}

export interface ContextEvents extends Record<string, BaseEvent> {
  'context:loaded': ContextLoadedEvent;
  'context:updated': ContextUpdatedEvent;
  'context:compressed': ContextCompressedEvent;
}

// ============================================================================
// Performance Events
// ============================================================================

export interface PerformanceMetricEvent extends BaseEvent {
  type: 'perf:metric';
  metricName: string;
  value: number;
  unit?: string;
}

export interface PerformanceThresholdEvent extends BaseEvent {
  type: 'perf:threshold';
  metricName: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

export interface PerformanceEvents extends Record<string, BaseEvent> {
  'perf:metric': PerformanceMetricEvent;
  'perf:threshold': PerformanceThresholdEvent;
}

// ============================================================================
// Sandbox Events
// ============================================================================

export interface SandboxCreatedEvent extends BaseEvent {
  type: 'sandbox:created';
  sandboxId: string;
  sandboxType: 'docker' | 'os' | 'process';
}

export interface SandboxDestroyedEvent extends BaseEvent {
  type: 'sandbox:destroyed';
  sandboxId: string;
}

export interface SandboxExecutionEvent extends BaseEvent {
  type: 'sandbox:execution';
  sandboxId: string;
  command: string;
  exitCode?: number;
}

export interface SandboxEvents extends Record<string, BaseEvent> {
  'sandbox:created': SandboxCreatedEvent;
  'sandbox:destroyed': SandboxDestroyedEvent;
  'sandbox:execution': SandboxExecutionEvent;
}

// ============================================================================
// Cost Events
// ============================================================================

export interface CostUpdatedEvent extends BaseEvent {
  type: 'cost:updated';
  currentCost: number;
  sessionLimit: number;
}

export interface CostLimitReachedEvent extends BaseEvent {
  type: 'cost:limit_reached';
  currentCost: number;
  limit: number;
}

export interface CostWarningEvent extends BaseEvent {
  type: 'cost:warning';
  currentCost: number;
  threshold: number;
  percentUsed: number;
}

export interface CostEvents extends Record<string, BaseEvent> {
  'cost:updated': CostUpdatedEvent;
  'cost:limit_reached': CostLimitReachedEvent;
  'cost:warning': CostWarningEvent;
}

// ============================================================================
// All Events Map (Unified)
// ============================================================================

/**
 * Complete map of all application events.
 * This is the master type for the unified event system.
 */
export interface AllEvents extends Record<string, BaseEvent> {
  // Agent Events
  'agent:started': AgentEvent;
  'agent:stopped': AgentEvent;
  'agent:error': AgentEvent;

  // Tool Events
  'tool:started': ToolEvent;
  'tool:completed': ToolEvent;
  'tool:error': ToolEvent;
  'tool:registered': ToolRegisteredEvent;
  'tool:instantiated': ToolInstantiatedEvent;
  'tool:disabled': ToolDisabledEvent;

  // Session Events
  'session:started': SessionEvent;
  'session:ended': SessionEvent;
  'session:paused': SessionEvent;
  'session:resumed': SessionEvent;

  // Message Events
  'message:sent': MessageEvent;
  'message:received': MessageEvent;
  'message:error': MessageEvent;

  // File Events
  'file:created': FileEvent;
  'file:modified': FileEvent;
  'file:deleted': FileEvent;
  'file:read': FileEvent;

  // Checkpoint Events
  'checkpoint:created': CheckpointCreatedEvent;
  'checkpoint:deleted': CheckpointDeletedEvent;
  'undo:noop': UndoNoopEvent;
  'redo:noop': RedoNoopEvent;
  'undo:complete': UndoCompleteEvent;
  'redo:complete': RedoCompleteEvent;
  'restore:complete': RestoreCompleteEvent;

  // Database Events
  'db:initialized': DatabaseInitializedEvent;
  'db:error': DatabaseErrorEvent;
  'db:migration': DatabaseMigrationEvent;
  'db:vacuum': DatabaseVacuumEvent;
  'db:backup': DatabaseBackupEvent;
  'db:closed': DatabaseClosedEvent;
  'db:cleared': DatabaseClearedEvent;

  // Sync Events
  'sync:started': SyncStartedEvent;
  'sync:completed': SyncCompletedEvent;
  'sync:failed': SyncFailedEvent;
  'sync:progress': SyncProgressEvent;
  'sync:item_uploaded': SyncItemUploadedEvent;
  'sync:item_downloaded': SyncItemDownloadedEvent;
  'sync:conflict_detected': SyncConflictDetectedEvent;
  'sync:conflict_resolved': SyncConflictResolvedEvent;

  // Cache Events
  'cache:hit': CacheHitEvent;
  'cache:miss': CacheMissEvent;
  'cache:set': CacheSetEvent;
  'cache:delete': CacheDeleteEvent;
  'cache:clear': CacheClearEvent;
  'cache:expired': CacheExpiredEvent;
  'cache:evicted': CacheEvictedEvent;

  // Plugin Events
  'plugin:loaded': PluginLoadedEvent;
  'plugin:unloaded': PluginUnloadedEvent;
  'plugin:error': PluginErrorEvent;
  'plugin:installed': PluginInstalledEvent;
  'plugin:uninstalled': PluginUninstalledEvent;

  // MCP Events
  'mcp:connected': MCPConnectedEvent;
  'mcp:disconnected': MCPDisconnectedEvent;
  'mcp:error': MCPErrorEvent;
  'mcp:tool_call': MCPToolCallEvent;
  'mcp:tool_result': MCPToolResultEvent;

  // Provider Events
  'provider:connected': ProviderConnectedEvent;
  'provider:disconnected': ProviderDisconnectedEvent;
  'provider:error': ProviderErrorEvent;
  'provider:switched': ProviderSwitchedEvent;
  'provider:fallback': ProviderFallbackEvent;

  // Security Events
  'security:permission_granted': SecurityPermissionGrantedEvent;
  'security:permission_denied': SecurityPermissionDeniedEvent;
  'security:mode_changed': SecurityModeChangedEvent;
  'security:violation': SecurityViolationEvent;

  // Workflow Events
  'workflow:started': WorkflowStartedEvent;
  'workflow:completed': WorkflowCompletedEvent;
  'workflow:step_started': WorkflowStepStartedEvent;
  'workflow:step_completed': WorkflowStepCompletedEvent;
  'workflow:error': WorkflowErrorEvent;

  // Stream Events
  'stream:started': StreamStartedEvent;
  'stream:chunk': StreamChunkEvent;
  'stream:completed': StreamCompletedEvent;
  'stream:error': StreamErrorEvent;

  // Memory Events
  'memory:stored': MemoryStoredEvent;
  'memory:retrieved': MemoryRetrievedEvent;
  'memory:deleted': MemoryDeletedEvent;
  'memory:cleared': MemoryClearedEvent;

  // Context Events
  'context:loaded': ContextLoadedEvent;
  'context:updated': ContextUpdatedEvent;
  'context:compressed': ContextCompressedEvent;

  // Performance Events
  'perf:metric': PerformanceMetricEvent;
  'perf:threshold': PerformanceThresholdEvent;

  // Sandbox Events
  'sandbox:created': SandboxCreatedEvent;
  'sandbox:destroyed': SandboxDestroyedEvent;
  'sandbox:execution': SandboxExecutionEvent;

  // Cost Events
  'cost:updated': CostUpdatedEvent;
  'cost:limit_reached': CostLimitReachedEvent;
  'cost:warning': CostWarningEvent;
}

// ============================================================================
// EventEmitter Adapter
// ============================================================================

/**
 * Adapter that wraps native EventEmitter to provide TypedEventEmitter interface.
 * This allows gradual migration from EventEmitter to TypedEventEmitter.
 *
 * Usage:
 * ```typescript
 * // Old code (EventEmitter)
 * class MyClass extends EventEmitter {
 *   doSomething() {
 *     this.emit('event', { data: 'value' });
 *   }
 * }
 *
 * // New code (TypedEventEmitterAdapter)
 * class MyClass extends TypedEventEmitterAdapter<MyEvents> {
 *   doSomething() {
 *     this.emitTyped('event', { data: 'value' });
 *   }
 * }
 * ```
 */
export class TypedEventEmitterAdapter<TEvents extends Record<string, BaseEvent> = AllEvents> extends EventEmitter {
  private typedEmitter: TypedEventEmitter<TEvents>;

  constructor(options: { maxHistorySize?: number } = {}) {
    super();
    this.typedEmitter = new TypedEventEmitter<TEvents>(options);
  }

  /**
   * Type-safe emit (new API)
   */
  emitTyped<K extends keyof TEvents>(
    type: K,
    event: Omit<TEvents[K], 'type' | 'timestamp'>
  ): boolean {
    // Emit through both systems for backward compatibility
    const fullEvent = {
      ...event,
      type: type as string,
      timestamp: Date.now(),
    } as TEvents[K];

    // Emit through native EventEmitter (for old listeners)
    super.emit(type as string, fullEvent);

    // Emit through TypedEventEmitter (for new listeners)
    return this.typedEmitter.emit(type, event);
  }

  /**
   * Type-safe listener (new API)
   */
  onTyped<K extends keyof TEvents>(
    type: K,
    listener: EventListener<TEvents[K]>,
    options?: ListenerOptions<TEvents[K]>
  ): string {
    return this.typedEmitter.on(type, listener, options);
  }

  /**
   * Type-safe once listener (new API)
   */
  onceTyped<K extends keyof TEvents>(
    type: K,
    listener: EventListener<TEvents[K]>,
    options?: Omit<ListenerOptions<TEvents[K]>, 'once'>
  ): string {
    return this.typedEmitter.once(type, listener, options);
  }

  /**
   * Remove typed listener by ID
   */
  offTyped(listenerId: string): boolean {
    return this.typedEmitter.off(listenerId);
  }

  /**
   * Wait for a typed event
   */
  waitForTyped<K extends keyof TEvents>(
    type: K,
    options?: { timeout?: number; filter?: EventFilter<TEvents[K]> }
  ): Promise<TEvents[K]> {
    return this.typedEmitter.waitFor(type, options);
  }

  /**
   * Get the underlying TypedEventEmitter
   */
  getTypedEmitter(): TypedEventEmitter<TEvents> {
    return this.typedEmitter;
  }

  /**
   * Get event statistics
   */
  getEventStats(): EventStats {
    return this.typedEmitter.getStats();
  }

  /**
   * Get event history
   */
  getEventHistory(): EventHistoryEntry[] {
    return this.typedEmitter.getHistory();
  }

  /**
   * Dispose both emitters
   */
  dispose(): void {
    this.typedEmitter.dispose();
    this.removeAllListeners();
  }
}

// ============================================================================
// Global Event Bus (Unified)
// ============================================================================

/**
 * Get the global typed event bus with all events
 */
export function getGlobalEventBus(): EventBus<AllEvents> {
  return EventBus.getInstance<AllEvents>();
}

// Export a default event bus instance (backward compatible)
export function getEventBus(): EventBus<ApplicationEvents> {
  return EventBus.getInstance<ApplicationEvents>();
}

// Export convenience function to reset the event bus (for testing)
export function resetEventBus(): void {
  EventBus.resetInstance();
}

// ============================================================================
// Event Type Guards
// ============================================================================

/**
 * Type guard for checking event types
 */
export function isEventType<K extends keyof AllEvents>(
  event: BaseEvent,
  type: K
): event is AllEvents[K] {
  return event.type === type;
}

/**
 * Type guard for agent events
 */
export function isAgentEvent(event: BaseEvent): event is AgentEvent {
  return event.type.startsWith('agent:');
}

/**
 * Type guard for tool events
 */
export function isToolEvent(event: BaseEvent): event is ToolEvent {
  return event.type.startsWith('tool:');
}

/**
 * Type guard for session events
 */
export function isSessionEvent(event: BaseEvent): event is SessionEvent {
  return event.type.startsWith('session:');
}

/**
 * Type guard for file events
 */
export function isFileEvent(event: BaseEvent): event is FileEvent {
  return event.type.startsWith('file:');
}

/**
 * Type guard for cache events
 */
export function isCacheEvent(event: BaseEvent): event is CacheHitEvent | CacheMissEvent | CacheSetEvent | CacheDeleteEvent | CacheClearEvent | CacheExpiredEvent | CacheEvictedEvent {
  return event.type.startsWith('cache:');
}

/**
 * Type guard for sync events
 */
export function isSyncEvent(event: BaseEvent): event is SyncStartedEvent | SyncCompletedEvent | SyncFailedEvent | SyncProgressEvent {
  return event.type.startsWith('sync:');
}

// ============================================================================
// Event Documentation
// ============================================================================

/**
 * Event Categories and Their Purposes:
 *
 * AGENT EVENTS (agent:*)
 * - agent:started   - Agent has started processing
 * - agent:stopped   - Agent has stopped
 * - agent:error     - Agent encountered an error
 *
 * TOOL EVENTS (tool:*)
 * - tool:started      - Tool execution started
 * - tool:completed    - Tool execution completed
 * - tool:error        - Tool execution failed
 * - tool:registered   - New tool registered
 * - tool:instantiated - Tool instance created
 * - tool:disabled     - Tool disabled
 *
 * SESSION EVENTS (session:*)
 * - session:started - New session started
 * - session:ended   - Session ended
 * - session:paused  - Session paused
 * - session:resumed - Session resumed
 *
 * MESSAGE EVENTS (message:*)
 * - message:sent     - Message sent to LLM
 * - message:received - Message received from LLM
 * - message:error    - Message handling error
 *
 * FILE EVENTS (file:*)
 * - file:created  - File created
 * - file:modified - File modified
 * - file:deleted  - File deleted
 * - file:read     - File read
 *
 * CHECKPOINT EVENTS (checkpoint:*, undo:*, redo:*, restore:*)
 * - checkpoint:created - Checkpoint created
 * - checkpoint:deleted - Checkpoint deleted
 * - undo:noop          - Undo had no effect
 * - redo:noop          - Redo had no effect
 * - undo:complete      - Undo completed
 * - redo:complete      - Redo completed
 * - restore:complete   - Restore completed
 *
 * DATABASE EVENTS (db:*)
 * - db:initialized - Database initialized
 * - db:error       - Database error
 * - db:migration   - Migration applied
 * - db:vacuum      - Vacuum completed
 * - db:backup      - Backup created
 * - db:closed      - Database closed
 * - db:cleared     - Database cleared
 *
 * SYNC EVENTS (sync:*)
 * - sync:started           - Sync started
 * - sync:completed         - Sync completed
 * - sync:failed            - Sync failed
 * - sync:progress          - Sync progress update
 * - sync:item_uploaded     - Item uploaded
 * - sync:item_downloaded   - Item downloaded
 * - sync:conflict_detected - Conflict detected
 * - sync:conflict_resolved - Conflict resolved
 *
 * CACHE EVENTS (cache:*)
 * - cache:hit     - Cache hit
 * - cache:miss    - Cache miss
 * - cache:set     - Cache entry set
 * - cache:delete  - Cache entry deleted
 * - cache:clear   - Cache cleared
 * - cache:expired - Cache entry expired
 * - cache:evicted - Cache entry evicted
 *
 * PLUGIN EVENTS (plugin:*)
 * - plugin:loaded      - Plugin loaded
 * - plugin:unloaded    - Plugin unloaded
 * - plugin:error       - Plugin error
 * - plugin:installed   - Plugin installed
 * - plugin:uninstalled - Plugin uninstalled
 *
 * MCP EVENTS (mcp:*)
 * - mcp:connected    - MCP server connected
 * - mcp:disconnected - MCP server disconnected
 * - mcp:error        - MCP error
 * - mcp:tool_call    - MCP tool called
 * - mcp:tool_result  - MCP tool result
 *
 * PROVIDER EVENTS (provider:*)
 * - provider:connected    - Provider connected
 * - provider:disconnected - Provider disconnected
 * - provider:error        - Provider error
 * - provider:switched     - Provider switched
 * - provider:fallback     - Provider fallback triggered
 *
 * SECURITY EVENTS (security:*)
 * - security:permission_granted - Permission granted
 * - security:permission_denied  - Permission denied
 * - security:mode_changed       - Security mode changed
 * - security:violation          - Security violation detected
 *
 * WORKFLOW EVENTS (workflow:*)
 * - workflow:started        - Workflow started
 * - workflow:completed      - Workflow completed
 * - workflow:step_started   - Workflow step started
 * - workflow:step_completed - Workflow step completed
 * - workflow:error          - Workflow error
 *
 * STREAM EVENTS (stream:*)
 * - stream:started   - Stream started
 * - stream:chunk     - Stream chunk received
 * - stream:completed - Stream completed
 * - stream:error     - Stream error
 *
 * MEMORY EVENTS (memory:*)
 * - memory:stored    - Memory stored
 * - memory:retrieved - Memory retrieved
 * - memory:deleted   - Memory deleted
 * - memory:cleared   - Memory cleared
 *
 * CONTEXT EVENTS (context:*)
 * - context:loaded     - Context loaded
 * - context:updated    - Context updated
 * - context:compressed - Context compressed
 *
 * PERFORMANCE EVENTS (perf:*)
 * - perf:metric    - Performance metric recorded
 * - perf:threshold - Performance threshold exceeded
 *
 * SANDBOX EVENTS (sandbox:*)
 * - sandbox:created   - Sandbox created
 * - sandbox:destroyed - Sandbox destroyed
 * - sandbox:execution - Sandbox command executed
 *
 * COST EVENTS (cost:*)
 * - cost:updated       - Cost updated
 * - cost:limit_reached - Cost limit reached
 * - cost:warning       - Cost warning threshold
 */
