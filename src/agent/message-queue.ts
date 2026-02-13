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

export type MessageQueueMode = 'steer' | 'followup' | 'collect';

export interface QueuedMessage {
  /** Message content */
  content: string;
  /** Source identifier (e.g., 'user', 'telegram', 'discord') */
  source: string;
  /** When the message was enqueued */
  timestamp: Date;
}

// ============================================================================
// Message Queue
// ============================================================================

export class MessageQueue extends EventEmitter {
  private mode: MessageQueueMode = 'followup';
  private queue: QueuedMessage[] = [];
  private processing = false;

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
   * Enqueue a message
   */
  enqueue(msg: QueuedMessage): void {
    this.queue.push(msg);
    this.emit('message-enqueued', msg);

    if (this.mode === 'steer' && this.processing) {
      this.emit('steering-available');
    }
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
