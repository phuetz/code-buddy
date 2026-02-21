/**
 * Message Queue with Steer/Followup/Collect Modes
 *
 * OpenClaw-inspired message handling during agent execution.
 *
 * Modes:
 * - steer: New messages interrupt the current execution (injected as user message)
 * - followup: Messages are queued and processed after the current turn completes
 * - collect: Messages are batched into a single string for the next turn
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type MessageQueueMode = 'steer' | 'followup' | 'collect' | 'steer-backlog';

export interface QueuedMessage {
  /** Message content */
  content: string;
  /** Source identifier (e.g., 'user', 'telegram', 'discord') */
  source: string;
  /** When the message was enqueued */
  timestamp: Date;
}

export interface MessageQueueOptions {
  /**
   * Wait for this many ms of silence before starting a followup turn.
   * Prevents rapid "continue continue" bursts from spamming turns.
   * Default: 1000 ms.
   */
  debounceMs?: number;
  /**
   * Maximum queued messages before overflow handling kicks in.
   * Default: 20.
   */
  cap?: number;
  /**
   * How to handle overflow when `cap` is exceeded.
   * 'drop'      — silently drop the oldest message
   * 'summarize' — replace the queue with a single synthetic bullet-list prompt
   * Default: 'drop'.
   */
  drop?: 'drop' | 'summarize';
}

// ============================================================================
// Message Queue
// ============================================================================

export class MessageQueue extends EventEmitter {
  private mode: MessageQueueMode = 'followup';
  private queue: QueuedMessage[] = [];
  private processing = false;
  private opts: Required<MessageQueueOptions>;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MessageQueueOptions = {}) {
    super();
    this.opts = {
      debounceMs: options.debounceMs ?? 1000,
      cap: options.cap ?? 20,
      drop: options.drop ?? 'drop',
    };
  }

  /**
   * Set the queue mode
   */
  setMode(mode: MessageQueueMode): void {
    this.mode = mode;
    this.emit('mode-changed', mode);
  }

  /**
   * Get current mode
   */
  getMode(): MessageQueueMode {
    return this.mode;
  }

  /**
   * Enqueue a message.
   * Handles debounce (followup mode), cap enforcement with overflow policy,
   * and steer-backlog mode.
   */
  enqueue(msg: QueuedMessage): void {
    // Enforce capacity cap
    if (this.queue.length >= this.opts.cap) {
      if (this.opts.drop === 'summarize') {
        this._summarizeOverflow(msg);
        return;
      } else {
        // Drop oldest
        this.queue.shift();
      }
    }

    this.queue.push(msg);
    this.emit('message-enqueued', msg);

    if ((this.mode === 'steer' || this.mode === 'steer-backlog') && this.processing) {
      this.emit('steering-available');
    }

    // Debounce: reset timer on each new message in followup/collect mode
    if ((this.mode === 'followup' || this.mode === 'collect') && !this.processing) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.emit('debounce-ready');
      }, this.opts.debounceMs);
    }
  }

  /**
   * Collapse all queued messages + incoming overflow into a single synthetic prompt.
   */
  private _summarizeOverflow(incoming: QueuedMessage): void {
    const all = [...this.queue, incoming];
    this.queue = [];
    const bullets = all.map(m => `- [${m.source}] ${m.content}`).join('\n');
    const synthetic: QueuedMessage = {
      content: `Multiple queued messages (summarized due to overflow):\n${bullets}`,
      source: 'queue-summary',
      timestamp: new Date(),
    };
    this.queue.push(synthetic);
    this.emit('message-enqueued', synthetic);
    this.emit('overflow-summarized', { count: all.length });
  }

  /**
   * Update queue options at runtime (e.g. from /queue steer debounce:2s cap:25)
   */
  configure(options: Partial<MessageQueueOptions>): void {
    if (options.debounceMs !== undefined) this.opts.debounceMs = options.debounceMs;
    if (options.cap !== undefined) this.opts.cap = options.cap;
    if (options.drop !== undefined) this.opts.drop = options.drop;
  }

  /**
   * Get current queue options
   */
  getOptions(): Readonly<Required<MessageQueueOptions>> {
    return { ...this.opts };
  }

  /**
   * Check if a steering message is available (steer mode)
   */
  hasSteeringMessage(): boolean {
    return this.mode === 'steer' && this.queue.length > 0;
  }

  /**
   * Consume the first steering message (steer mode)
   */
  consumeSteeringMessage(): QueuedMessage | null {
    if (this.mode !== 'steer' || this.queue.length === 0) {
      return null;
    }
    return this.queue.shift() || null;
  }

  /**
   * Drain all queued messages (followup mode)
   */
  drain(): QueuedMessage[] {
    const messages = [...this.queue];
    this.queue = [];
    return messages;
  }

  /**
   * Collect all queued messages into a single string (collect mode)
   */
  collect(): string {
    if (this.queue.length === 0) return '';

    const combined = this.queue
      .map(m => `[${m.source}] ${m.content}`)
      .join('\n');

    this.queue = [];
    return combined;
  }

  /**
   * Signal that agent is starting processing
   */
  startProcessing(): void {
    this.processing = true;
    this.emit('processing-started');
  }

  /**
   * Signal that agent has finished processing
   */
  endProcessing(): void {
    this.processing = false;
    this.emit('processing-ended');
  }

  /**
   * Check if there are pending messages
   */
  hasPendingMessages(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Get the number of pending messages
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if the agent is currently processing
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
  }
}
