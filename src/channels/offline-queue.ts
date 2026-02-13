/**
 * Offline Queue
 *
 * Buffers outbound messages when a channel is disconnected.
 * Messages can be drained and sent when the channel reconnects.
 *
 * Features:
 * - FIFO message buffering
 * - Configurable maximum queue size
 * - Oldest messages dropped when queue is full
 * - Drain returns all queued messages in order
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A queued message waiting to be delivered
 */
export interface QueuedMessage {
  /** Target channel/conversation ID */
  channelId: string;
  /** Message content */
  content: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp when the message was queued */
  queuedAt: Date;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Buffers messages for later delivery when a channel is offline.
 *
 * Usage:
 * ```typescript
 * const queue = new OfflineQueue(50);
 *
 * // When disconnected, queue outgoing messages
 * queue.enqueue({ channelId: '123', content: 'Hello' });
 *
 * // When reconnected, drain and send
 * const messages = queue.drain();
 * for (const msg of messages) {
 *   await channel.send(msg);
 * }
 * ```
 */
export class OfflineQueue {
  private readonly maxSize: number;
  private queue: QueuedMessage[] = [];

  /**
   * @param maxSize - Maximum number of messages to buffer (default: 100).
   *                  When exceeded, oldest messages are dropped.
   */
  constructor(maxSize = 100) {
    this.maxSize = Math.max(1, maxSize);
  }

  /**
   * Queue a message for later delivery.
   *
   * @param message - The message to enqueue (channelId, content, optional metadata)
   * @returns true if the message was queued, false if it replaced an older message
   */
  enqueue(message: {
    channelId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): boolean {
    const entry: QueuedMessage = {
      channelId: message.channelId,
      content: message.content,
      metadata: message.metadata,
      queuedAt: new Date(),
    };

    if (this.queue.length >= this.maxSize) {
      // Drop oldest message to make room
      this.queue.shift();
      this.queue.push(entry);
      return false;
    }

    this.queue.push(entry);
    return true;
  }

  /**
   * Drain all queued messages.
   *
   * Returns all queued messages in FIFO order and clears the queue.
   */
  drain(): QueuedMessage[] {
    const messages = this.queue;
    this.queue = [];
    return messages;
  }

  /**
   * Get the current queue size.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear all queued messages without returning them.
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Peek at the next message without removing it.
   */
  peek(): QueuedMessage | undefined {
    return this.queue[0];
  }

  /**
   * Check if the queue is empty.
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Check if the queue is full.
   */
  isFull(): boolean {
    return this.queue.length >= this.maxSize;
  }

  /**
   * Get the maximum queue size.
   */
  getMaxSize(): number {
    return this.maxSize;
  }
}
