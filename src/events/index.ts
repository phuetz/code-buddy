/**
 * Events Module
 *
 * Provides a centralized event system for the application with support for:
 * - Type-safe event emitting and listening
 * - Event filtering with patterns and predicates
 * - Event priority handling
 * - Once-only listeners
 * - Event history tracking
 * - Wildcard listeners
 */

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
              console.error('Unhandled async listener error:', error);
            }
          });
        }
      } catch (error) {
        // Emit error if there are listeners, otherwise log silently
        // This allows emit() to continue without throwing
        if (this.emitter.listenerCount('error') > 0) {
          this.emitter.emit('error', error);
        } else {
          console.error('Unhandled listener error:', error);
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
      let totalRemoved = 0;
      for (const listeners of this.listeners.values()) {
        totalRemoved += listeners.length;
      }
      totalRemoved += this.wildcardListeners.length;

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

// Export a default event bus instance
export function getEventBus(): EventBus<ApplicationEvents> {
  return EventBus.getInstance<ApplicationEvents>();
}

// Export convenience function to reset the event bus (for testing)
export function resetEventBus(): void {
  EventBus.resetInstance();
}
