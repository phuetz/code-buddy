/**
 * Observer Coordinator
 *
 * Wires ScreenObserver + FileWatcher + TriggerRegistry together.
 * Aggregates events and deduplicates.
 */

import { EventEmitter } from 'events';
import { ScreenObserver, type ScreenDiff } from './screen-observer.js';
import { EventTriggerManager, type TriggerEvent } from './event-trigger.js';
import { TriggerRegistry } from './trigger-registry.js';
import { logger } from '../../utils/logger.js';

export interface CoordinatorConfig {
  /** Enable screen observation */
  enableScreenObserver: boolean;
  /** Enable file watching */
  enableFileWatcher: boolean;
  /** Screen observation interval (ms) */
  screenIntervalMs: number;
  /** Deduplication window (ms) */
  deduplicationWindowMs: number;
}

const DEFAULT_CONFIG: CoordinatorConfig = {
  enableScreenObserver: false,
  enableFileWatcher: true,
  screenIntervalMs: 10000,
  deduplicationWindowMs: 1000,
};

export class ObserverCoordinator extends EventEmitter {
  private config: CoordinatorConfig;
  private screenObserver: ScreenObserver;
  private triggerManager: EventTriggerManager;
  private triggerRegistry: TriggerRegistry;
  private recentEvents: Map<string, number> = new Map(); // eventKey -> timestamp
  private running: boolean = false;

  constructor(
    screenObserver: ScreenObserver,
    triggerManager: EventTriggerManager,
    config: Partial<CoordinatorConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.screenObserver = screenObserver;
    this.triggerManager = triggerManager;
    this.triggerRegistry = new TriggerRegistry(triggerManager);
  }

  /**
   * Start all observers
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Load persisted triggers
    await this.triggerRegistry.load();

    // Wire screen observer
    if (this.config.enableScreenObserver) {
      this.screenObserver.on('change', (diff: ScreenDiff) => {
        this.handleScreenChange(diff);
      });
      this.screenObserver.start(this.config.screenIntervalMs);
    }

    // Wire trigger actions
    this.triggerManager.on('trigger:fired', ({ trigger, event }) => {
      this.emit('action', { trigger, event });
    });

    this.running = true;
    this.emit('started');
    logger.info('Observer coordinator started');
  }

  /**
   * Stop all observers
   */
  async stop(): Promise<void> {
    this.screenObserver.stop();
    await this.triggerRegistry.save();
    this.running = false;
    this.emit('stopped');
  }

  /**
   * Handle screen change event
   */
  private handleScreenChange(diff: ScreenDiff): void {
    const eventKey = `screen_change:${diff.currentHash}`;
    if (this.isDuplicate(eventKey)) return;

    const event: TriggerEvent = {
      triggerId: '',
      type: 'screen_change',
      data: {
        changePercentage: diff.changePercentage,
        regions: diff.changedRegions,
      },
      timestamp: diff.timestamp,
    };

    this.triggerManager.evaluate(event);
    this.emit('event', event);
  }

  /**
   * Handle file change event (called externally)
   */
  handleFileChange(filePath: string, changeType: 'add' | 'change' | 'unlink'): void {
    const eventKey = `file_change:${filePath}:${changeType}`;
    if (this.isDuplicate(eventKey)) return;

    const event: TriggerEvent = {
      triggerId: '',
      type: 'file_change',
      data: { path: filePath, changeType },
      timestamp: new Date(),
    };

    this.triggerManager.evaluate(event);
    this.emit('event', event);
  }

  /**
   * Handle webhook event
   */
  handleWebhook(data: Record<string, unknown>): void {
    const event: TriggerEvent = {
      triggerId: '',
      type: 'webhook',
      data,
      timestamp: new Date(),
    };

    this.triggerManager.evaluate(event);
    this.emit('event', event);
  }

  /**
   * Check for duplicate events within deduplication window
   */
  private isDuplicate(key: string): boolean {
    const lastSeen = this.recentEvents.get(key);
    const now = Date.now();

    if (lastSeen && (now - lastSeen) < this.config.deduplicationWindowMs) {
      return true;
    }

    this.recentEvents.set(key, now);

    // Clean old entries
    if (this.recentEvents.size > 1000) {
      const cutoff = now - this.config.deduplicationWindowMs * 2;
      const toDelete: string[] = [];
      for (const [k, t] of this.recentEvents) {
        if (t < cutoff) toDelete.push(k);
      }
      for (const k of toDelete) {
        this.recentEvents.delete(k);
      }
    }

    return false;
  }

  /**
   * Get registry for CRUD operations
   */
  getRegistry(): TriggerRegistry {
    return this.triggerRegistry;
  }

  isRunning(): boolean {
    return this.running;
  }
}
