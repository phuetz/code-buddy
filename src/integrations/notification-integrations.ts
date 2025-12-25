/**
 * Notification Integrations
 *
 * Send notifications to external services:
 * - Slack webhooks
 * - Discord webhooks
 * - Microsoft Teams
 * - Generic webhooks
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface NotificationConfig {
  /** Slack webhook URL */
  slackWebhook?: string;
  /** Discord webhook URL */
  discordWebhook?: string;
  /** Teams webhook URL */
  teamsWebhook?: string;
  /** Custom webhook URLs */
  customWebhooks?: string[];
  /** Default channel/username */
  defaultChannel?: string;
  /** Default username for bot */
  botName?: string;
  /** Default icon/avatar URL */
  iconUrl?: string;
  /** Rate limit (notifications per minute) */
  rateLimit?: number;
  /** Enable notification batching */
  batchNotifications?: boolean;
  /** Batch interval in ms */
  batchInterval?: number;
}

export interface Notification {
  title: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  fields?: NotificationField[];
  timestamp?: Date;
  footer?: string;
  url?: string;
  imageUrl?: string;
}

export interface NotificationField {
  name: string;
  value: string;
  inline?: boolean;
}

interface SlackMessage {
  text?: string;
  channel?: string;
  username?: string;
  icon_url?: string;
  attachments?: SlackAttachment[];
  blocks?: SlackBlock[];
}

interface SlackAttachment {
  color: string;
  title?: string;
  text?: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
  footer?: string;
  ts?: number;
  title_link?: string;
  image_url?: string;
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text: string }>;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
  url?: string;
  image?: { url: string };
}

interface DiscordMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

interface TeamsMessage {
  '@type': string;
  '@context': string;
  themeColor: string;
  summary: string;
  sections: Array<{
    activityTitle: string;
    activitySubtitle?: string;
    facts?: Array<{ name: string; value: string }>;
    markdown: boolean;
  }>;
  potentialAction?: Array<{
    '@type': string;
    name: string;
    targets: Array<{ os: string; uri: string }>;
  }>;
}

/**
 * Notification Manager
 */
export class NotificationManager extends EventEmitter {
  private config: Required<NotificationConfig>;
  private notificationQueue: Notification[] = [];
  private lastNotificationTime: number = 0;
  private notificationCount: number = 0;
  private batchTimer: NodeJS.Timeout | null = null;

  constructor(config: NotificationConfig = {}) {
    super();
    this.config = {
      slackWebhook: config.slackWebhook || '',
      discordWebhook: config.discordWebhook || '',
      teamsWebhook: config.teamsWebhook || '',
      customWebhooks: config.customWebhooks || [],
      defaultChannel: config.defaultChannel || '',
      botName: config.botName || 'Code Buddy',
      iconUrl: config.iconUrl || '',
      rateLimit: config.rateLimit ?? 30,
      batchNotifications: config.batchNotifications ?? false,
      batchInterval: config.batchInterval ?? 5000,
    };

    // Reset rate limit counter every minute
    setInterval(() => {
      this.notificationCount = 0;
    }, 60000);
  }

  /**
   * Send a notification to all configured services
   */
  async notify(notification: Notification): Promise<void> {
    // Rate limiting
    if (this.notificationCount >= this.config.rateLimit) {
      logger.warn('Notification rate limit exceeded');
      return;
    }

    if (this.config.batchNotifications) {
      this.queueNotification(notification);
    } else {
      await this.sendNotification(notification);
    }
  }

  /**
   * Queue notification for batching
   */
  private queueNotification(notification: Notification): void {
    this.notificationQueue.push(notification);

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushNotifications().catch(() => {});
        this.batchTimer = null;
      }, this.config.batchInterval);
    }
  }

  /**
   * Flush queued notifications
   */
  private async flushNotifications(): Promise<void> {
    if (this.notificationQueue.length === 0) return;

    const notifications = [...this.notificationQueue];
    this.notificationQueue = [];

    // Send as a batch or individually
    if (notifications.length === 1) {
      await this.sendNotification(notifications[0]);
    } else {
      await this.sendBatchNotification(notifications);
    }
  }

  /**
   * Send a single notification
   */
  private async sendNotification(notification: Notification): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.config.slackWebhook) {
      promises.push(this.sendSlack(notification));
    }

    if (this.config.discordWebhook) {
      promises.push(this.sendDiscord(notification));
    }

    if (this.config.teamsWebhook) {
      promises.push(this.sendTeams(notification));
    }

    for (const webhook of this.config.customWebhooks) {
      promises.push(this.sendCustom(webhook, notification));
    }

    await Promise.allSettled(promises);
    this.notificationCount++;
    this.emit('notification', notification);
  }

  /**
   * Send batch notification
   */
  private async sendBatchNotification(notifications: Notification[]): Promise<void> {
    // Create a summary notification
    const summary: Notification = {
      title: `${notifications.length} Notifications`,
      message: notifications.map(n => `• ${n.title}: ${n.message}`).join('\n'),
      level: this.getHighestLevel(notifications),
      fields: [
        { name: 'Count', value: String(notifications.length), inline: true },
        { name: 'Period', value: `${this.config.batchInterval / 1000}s`, inline: true },
      ],
    };

    await this.sendNotification(summary);
  }

  /**
   * Get highest severity level
   */
  private getHighestLevel(notifications: Notification[]): Notification['level'] {
    const levels: Notification['level'][] = ['info', 'success', 'warning', 'error'];
    let highest = 0;
    for (const n of notifications) {
      const index = levels.indexOf(n.level);
      if (index > highest) highest = index;
    }
    return levels[highest];
  }

  /**
   * Send notification to Slack
   */
  private async sendSlack(notification: Notification): Promise<void> {
    const color = this.getLevelColor(notification.level);

    const message: SlackMessage = {
      channel: this.config.defaultChannel || undefined,
      username: this.config.botName,
      icon_url: this.config.iconUrl || undefined,
      attachments: [{
        color,
        title: notification.title,
        title_link: notification.url,
        text: notification.message,
        fields: notification.fields?.map(f => ({
          title: f.name,
          value: f.value,
          short: f.inline ?? true,
        })),
        footer: notification.footer,
        ts: Math.floor((notification.timestamp || new Date()).getTime() / 1000),
        image_url: notification.imageUrl,
      }],
    };

    await this.sendWebhook(this.config.slackWebhook, message);
  }

  /**
   * Send notification to Discord
   */
  private async sendDiscord(notification: Notification): Promise<void> {
    const color = this.getDiscordColor(notification.level);

    const message: DiscordMessage = {
      username: this.config.botName,
      avatar_url: this.config.iconUrl || undefined,
      embeds: [{
        title: notification.title,
        description: notification.message,
        color,
        url: notification.url,
        fields: notification.fields?.map(f => ({
          name: f.name,
          value: f.value,
          inline: f.inline ?? true,
        })),
        footer: notification.footer ? { text: notification.footer } : undefined,
        timestamp: (notification.timestamp || new Date()).toISOString(),
        image: notification.imageUrl ? { url: notification.imageUrl } : undefined,
      }],
    };

    await this.sendWebhook(this.config.discordWebhook, message);
  }

  /**
   * Send notification to Microsoft Teams
   */
  private async sendTeams(notification: Notification): Promise<void> {
    const color = this.getLevelColor(notification.level).replace('#', '');

    const message: TeamsMessage = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: color,
      summary: notification.title,
      sections: [{
        activityTitle: notification.title,
        activitySubtitle: notification.message,
        facts: notification.fields?.map(f => ({
          name: f.name,
          value: f.value,
        })),
        markdown: true,
      }],
      potentialAction: notification.url ? [{
        '@type': 'OpenUri',
        name: 'View Details',
        targets: [{ os: 'default', uri: notification.url }],
      }] : undefined,
    };

    await this.sendWebhook(this.config.teamsWebhook, message);
  }

  /**
   * Send notification to custom webhook
   */
  private async sendCustom(webhook: string, notification: Notification): Promise<void> {
    const payload = {
      title: notification.title,
      message: notification.message,
      level: notification.level,
      fields: notification.fields,
      timestamp: (notification.timestamp || new Date()).toISOString(),
      footer: notification.footer,
      url: notification.url,
      source: this.config.botName,
    };

    await this.sendWebhook(webhook, payload);
  }

  /**
   * Send webhook request
   */
  private async sendWebhook(url: string, payload: object): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn('Webhook request failed', { url, status: response.status });
      }
    } catch (error) {
      logger.error('Failed to send webhook', { url, error });
    }
  }

  /**
   * Get color for level (hex)
   */
  private getLevelColor(level: Notification['level']): string {
    const colors: Record<Notification['level'], string> = {
      info: '#2196F3',
      success: '#4CAF50',
      warning: '#FF9800',
      error: '#F44336',
    };
    return colors[level];
  }

  /**
   * Get Discord color (decimal)
   */
  private getDiscordColor(level: Notification['level']): number {
    const colors: Record<Notification['level'], number> = {
      info: 0x2196F3,
      success: 0x4CAF50,
      warning: 0xFF9800,
      error: 0xF44336,
    };
    return colors[level];
  }

  /**
   * Convenience methods for different levels
   */
  async info(title: string, message: string, fields?: NotificationField[]): Promise<void> {
    await this.notify({ title, message, level: 'info', fields });
  }

  async success(title: string, message: string, fields?: NotificationField[]): Promise<void> {
    await this.notify({ title, message, level: 'success', fields });
  }

  async warning(title: string, message: string, fields?: NotificationField[]): Promise<void> {
    await this.notify({ title, message, level: 'warning', fields });
  }

  async error(title: string, message: string, fields?: NotificationField[]): Promise<void> {
    await this.notify({ title, message, level: 'error', fields });
  }

  /**
   * Notify session events
   */
  async notifySessionStart(sessionId: string): Promise<void> {
    await this.info('Session Started', `New session: ${sessionId}`, [
      { name: 'Session ID', value: sessionId.slice(0, 8) },
      { name: 'Time', value: new Date().toLocaleTimeString() },
    ]);
  }

  async notifySessionEnd(sessionId: string, stats: { messages: number; cost: number; duration: number }): Promise<void> {
    await this.success('Session Completed', `Session ${sessionId.slice(0, 8)} finished`, [
      { name: 'Messages', value: String(stats.messages), inline: true },
      { name: 'Cost', value: `$${stats.cost.toFixed(4)}`, inline: true },
      { name: 'Duration', value: `${Math.round(stats.duration / 60)}m`, inline: true },
    ]);
  }

  async notifyError(error: Error, context?: string): Promise<void> {
    await this.error('Error Occurred', error.message, [
      { name: 'Type', value: error.name, inline: true },
      { name: 'Context', value: context || 'Unknown', inline: true },
    ]);
  }

  async notifyCostThreshold(current: number, threshold: number): Promise<void> {
    await this.warning('Cost Threshold Reached', `Session cost: $${current.toFixed(4)}`, [
      { name: 'Current', value: `$${current.toFixed(4)}`, inline: true },
      { name: 'Threshold', value: `$${threshold.toFixed(2)}`, inline: true },
      { name: 'Percentage', value: `${((current / threshold) * 100).toFixed(0)}%`, inline: true },
    ]);
  }

  /**
   * Close notification manager
   */
  close(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.flushNotifications().catch(() => {});
  }
}

// Singleton instance
let notificationManager: NotificationManager | null = null;

/**
 * Get or create notification manager
 */
export function getNotificationManager(config?: NotificationConfig): NotificationManager {
  if (!notificationManager) {
    notificationManager = new NotificationManager(config);
  }
  return notificationManager;
}

/**
 * Quick notify helper
 */
export async function notify(notification: Notification): Promise<void> {
  const manager = getNotificationManager();
  await manager.notify(notification);
}

export default NotificationManager;
