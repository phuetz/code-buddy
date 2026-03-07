/**
 * Niche Channels & Misc
 * Lightweight stubs for Twitch, Tlon, Gmail, and docs search.
 */

import { logger } from '../utils/logger.js';

export class TwitchAdapter {
  private running: boolean = false;
  private channels: Set<string> = new Set();
  private config: Record<string, unknown>;

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
  }

  start(): void {
    this.running = true;
    logger.debug('TwitchAdapter started');
  }

  stop(): void {
    this.running = false;
    this.channels.clear();
    logger.debug('TwitchAdapter stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  sendMessage(channel: string, text: string): { sent: boolean; channel: string } {
    if (!this.running) throw new Error('Adapter not running');
    logger.debug(`Twitch [${channel}]: ${text}`);
    return { sent: true, channel };
  }

  joinChannel(channel: string): void {
    this.channels.add(channel);
  }

  leaveChannel(channel: string): void {
    this.channels.delete(channel);
  }

  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }
}

export class TlonAdapter {
  private running: boolean = false;
  private config: Record<string, unknown>;

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
  }

  start(): void {
    this.running = true;
    logger.debug('TlonAdapter started');
  }

  stop(): void {
    this.running = false;
    logger.debug('TlonAdapter stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  sendMessage(shipName: string, text: string): { sent: boolean; ship: string } {
    if (!this.running) throw new Error('Adapter not running');
    logger.debug(`Tlon [${shipName}]: ${text}`);
    return { sent: true, ship: shipName };
  }

  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }
}

export interface GmailPubSubConfig {
  projectId?: string;
  topicName?: string;
  subscriptionName?: string;
  labelFilter?: string[];
  serviceAccountKeyPath?: string;
}

export class GmailWebhookAdapter {
  private running: boolean = false;
  private messages: Array<{ id: string; subject: string; from: string; read: boolean; receivedAt: Date }> = [];
  private config: Record<string, unknown>;
  private pubsubConfig: GmailPubSubConfig;
  private watchExpiry: Date | null = null;
  private callbacks: Array<(msg: { id: string; subject: string; from: string }) => void> = [];

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
    this.pubsubConfig = {
      projectId: config.projectId as string,
      topicName: config.topicName as string || 'projects/my-project/topics/gmail-notifications',
      subscriptionName: config.subscriptionName as string,
      labelFilter: config.labelFilter as string[],
      serviceAccountKeyPath: config.serviceAccountKeyPath as string,
    };
  }

  start(): void {
    this.running = true;
    logger.debug('GmailWebhookAdapter started with Pub/Sub', {
      projectId: this.pubsubConfig.projectId,
      topicName: this.pubsubConfig.topicName,
    });
  }

  stop(): void {
    this.running = false;
    this.callbacks = [];
    logger.debug('GmailWebhookAdapter stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Set up Gmail push notifications via Pub/Sub.
   * In production, this calls the Gmail API watch() endpoint.
   */
  async setupWatch(labelIds?: string[]): Promise<{ historyId: string; expiration: string }> {
    if (!this.running) throw new Error('Adapter not running');
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    this.watchExpiry = expiry;
    logger.debug('Gmail Pub/Sub watch set up', { labelIds, expiry: expiry.toISOString() });
    return {
      historyId: `history_${Date.now()}`,
      expiration: expiry.getTime().toString(),
    };
  }

  /**
   * Process incoming Pub/Sub notification.
   * Called by the webhook endpoint when Google pushes a notification.
   */
  async handlePubSubNotification(data: { emailAddress: string; historyId: string }): Promise<void> {
    if (!this.running) return;
    logger.debug('Gmail Pub/Sub notification received', data);
    // In production, this would call Gmail API to fetch new messages since historyId
  }

  getMessages(limit?: number): Array<{ id: string; subject: string; from: string; read: boolean; receivedAt: Date }> {
    const msgs = [...this.messages];
    return limit ? msgs.slice(0, limit) : msgs;
  }

  getUnreadCount(): number {
    return this.messages.filter(m => !m.read).length;
  }

  markRead(messageId: string): boolean {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) {
      msg.read = true;
      return true;
    }
    return false;
  }

  markAllRead(): number {
    let count = 0;
    for (const msg of this.messages) {
      if (!msg.read) {
        msg.read = true;
        count++;
      }
    }
    return count;
  }

  onNewMessage(callback: (msg: { id: string; subject: string; from: string }) => void): void {
    this.callbacks.push(callback);
  }

  getWatchExpiry(): Date | null {
    return this.watchExpiry;
  }

  isWatchActive(): boolean {
    return this.watchExpiry !== null && this.watchExpiry > new Date();
  }

  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }

  getPubSubConfig(): GmailPubSubConfig {
    return { ...this.pubsubConfig };
  }

  // Test helper to add messages
  _addMessage(id: string, subject: string, from: string = 'test@example.com'): void {
    const msg = { id, subject, from, read: false, receivedAt: new Date() };
    this.messages.push(msg);
    for (const cb of this.callbacks) {
      cb({ id, subject, from });
    }
  }
}

export class DocsSearchTool {
  private docs: Map<string, { content: string; url: string }> = new Map();

  constructor() {
    // Pre-populate with some default topics
    this.docs.set('getting-started', { content: 'Install and configure Code Buddy', url: '/docs/getting-started' });
    this.docs.set('tools', { content: 'Available tools and their usage', url: '/docs/tools' });
    this.docs.set('configuration', { content: 'Configuration options and environment variables', url: '/docs/configuration' });
  }

  search(query: string): Array<{ topic: string; snippet: string; url: string }> {
    const results: Array<{ topic: string; snippet: string; url: string }> = [];
    const queryLower = query.toLowerCase();

    for (const [topic, doc] of this.docs) {
      if (topic.includes(queryLower) || doc.content.toLowerCase().includes(queryLower)) {
        results.push({ topic, snippet: doc.content, url: doc.url });
      }
    }

    return results;
  }

  getTopics(): string[] {
    return Array.from(this.docs.keys());
  }

  getDocUrl(topic: string): string | undefined {
    return this.docs.get(topic)?.url;
  }
}
