/**
 * WhatsApp Channel Adapter
 *
 * WhatsApp integration via Baileys (@whiskeysockets/baileys).
 * Supports QR code pairing, text/media messaging, and group chats.
 * Baileys is an optional dependency loaded dynamically at runtime.
 */

import type {
  ChannelConfig,
  ChannelUser,
  ChannelInfo,
  InboundMessage,
  OutboundMessage,
  DeliveryResult,
  ContentType,
  MessageAttachment,
} from '../index.js';
import { BaseChannel, getSessionKey, checkDMPairing } from '../index.js';
import { ReconnectionManager } from '../reconnection-manager.js';
import { logger } from '../../utils/logger.js';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * WhatsApp-specific configuration
 */
export interface WhatsAppConfig extends ChannelConfig {
  type: 'whatsapp';
  /** Phone number to register (with country code, e.g. +1234567890) */
  phoneNumber?: string;
  /** Directory to store session data (auth keys, etc.) */
  sessionDataPath?: string;
  /** Timeout for QR code pairing in ms (default: 60000) */
  qrTimeout?: number;
  /** Print QR code to terminal (default: true) */
  printQrInTerminal?: boolean;
  /** Browser name shown in WhatsApp linked devices */
  browserName?: string;
  /** Whether to mark messages as read automatically */
  markOnlineOnConnect?: boolean;
}

/**
 * WhatsApp message types from Baileys
 */
interface BaileysMessage {
  key: {
    remoteJid?: string | null;
    fromMe?: boolean | null;
    id?: string | null;
    participant?: string | null;
  };
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | Long | null;
  pushName?: string | null;
  status?: number;
}

/** Baileys long integer type */
interface Long {
  toNumber(): number;
}

/**
 * WhatsApp contact info
 */
export interface WhatsAppContact {
  id: string;
  name?: string;
  notify?: string;
  imgUrl?: string;
}

// ============================================================================
// Channel Implementation
// ============================================================================

/**
 * WhatsApp channel using Baileys (WhatsApp Web multi-device)
 */
export class WhatsAppChannel extends BaseChannel {
  private socket: unknown = null;
  private authState: unknown = null;
  private qrTimeout: NodeJS.Timeout | null = null;
  private reconnecting = false;
  private reconnectionManager: ReconnectionManager;

  constructor(config: WhatsAppConfig) {
    super('whatsapp', config);
    // Apply defaults
    if (!config.sessionDataPath) {
      (this.config as WhatsAppConfig).sessionDataPath = path.join(process.cwd(), '.codebuddy', 'whatsapp-session');
    }
    if (config.qrTimeout === undefined) {
      (this.config as WhatsAppConfig).qrTimeout = 60000;
    }
    if (config.printQrInTerminal === undefined) {
      (this.config as WhatsAppConfig).printQrInTerminal = true;
    }
    if (!config.browserName) {
      (this.config as WhatsAppConfig).browserName = 'Code Buddy';
    }
    this.reconnectionManager = new ReconnectionManager('whatsapp', {
      maxRetries: 10,
      initialDelayMs: 2000,
      maxDelayMs: 60000,
    });
  }

  private get waConfig(): WhatsAppConfig {
    return this.config as WhatsAppConfig;
  }

  /**
   * Connect to WhatsApp via Baileys
   */
  async connect(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let baileys: any;
    try {
      // @ts-expect-error -- optional dependency, loaded dynamically
      baileys = await import('@whiskeysockets/baileys');
    } catch {
      throw new Error(
        'WhatsApp channel requires @whiskeysockets/baileys. Install it with: npm install @whiskeysockets/baileys'
      );
    }

    const sessionPath = this.waConfig.sessionDataPath!;
    if (!existsSync(sessionPath)) {
      mkdirSync(sessionPath, { recursive: true });
    }

    // Load or initialize auth state
    try {
      const { state, saveCreds } = await this.loadAuthState(baileys, sessionPath);
      this.authState = { state, saveCreds };
    } catch (err) {
      logger.debug('WhatsApp: failed to load auth state, starting fresh', {
        error: err instanceof Error ? err.message : String(err),
      });
      const { state, saveCreds } = await this.initFreshAuthState(baileys, sessionPath);
      this.authState = { state, saveCreds };
    }

    const { state, saveCreds } = this.authState as {
      state: unknown;
      saveCreds: () => Promise<void>;
    };

    // Create the Baileys socket
    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: this.waConfig.printQrInTerminal,
      browser: [this.waConfig.browserName ?? 'Code Buddy', 'Chrome', '120.0'],
      markOnlineOnConnect: this.waConfig.markOnlineOnConnect ?? true,
    });

    this.socket = sock;

    // Register event handlers
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: Record<string, unknown>) => {
      this.handleConnectionUpdate(update);
    });

    sock.ev.on('messages.upsert', (upsert: { messages: BaileysMessage[]; type: string }) => {
      this.handleMessagesUpsert(upsert);
    });

    // Wait for connection or QR timeout
    return new Promise<void>((resolve, reject) => {
      const onConnected = () => {
        cleanup();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        this.removeListener('connected', onConnected);
        this.removeListener('error', onError);
        if (this.qrTimeout) {
          clearTimeout(this.qrTimeout);
          this.qrTimeout = null;
        }
      };

      this.once('connected', onConnected);
      this.once('error', onError);

      // QR timeout fallback
      this.qrTimeout = setTimeout(() => {
        if (!this.status.connected) {
          cleanup();
          reject(new Error(`WhatsApp QR pairing timed out after ${this.waConfig.qrTimeout}ms`));
        }
      }, this.waConfig.qrTimeout ?? 60000);
    });
  }

  /**
   * Disconnect from WhatsApp
   */
  async disconnect(): Promise<void> {
    this.reconnectionManager.cancel();
    if (this.qrTimeout) {
      clearTimeout(this.qrTimeout);
      this.qrTimeout = null;
    }

    if (this.socket) {
      try {
        const sock = this.socket as { end: (reason?: unknown) => void };
        sock.end(undefined);
      } catch (err) {
        logger.debug('WhatsApp disconnect error (ignored)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.socket = null;
    }

    this.status.connected = false;
    this.status.authenticated = false;
    this.emit('disconnected', 'whatsapp');
  }

  /**
   * Send a WhatsApp message
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.socket || !this.status.connected) {
      return {
        success: false,
        error: 'WhatsApp not connected',
        timestamp: new Date(),
      };
    }

    const sock = this.socket as {
      sendMessage: (
        jid: string,
        content: Record<string, unknown>,
        options?: Record<string, unknown>
      ) => Promise<{ key: { id?: string } }>;
    };

    try {
      const jid = this.normalizeJid(message.channelId);
      let content: Record<string, unknown>;

      // Handle attachments
      if (message.attachments && message.attachments.length > 0) {
        content = this.buildMediaContent(message.attachments[0], message.content);
      } else {
        content = { text: message.content };
      }

      const options: Record<string, unknown> = {};
      if (message.replyTo) {
        options.quoted = { key: { id: message.replyTo } };
      }

      const result = await sock.sendMessage(jid, content, options);

      return {
        success: true,
        messageId: result.key.id ?? undefined,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.debug('WhatsApp send error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send a typing indicator
   */
  async sendPresenceUpdate(jid: string, type: 'composing' | 'paused' = 'composing'): Promise<void> {
    if (!this.socket) return;

    const sock = this.socket as {
      sendPresenceUpdate: (type: string, jid: string) => Promise<void>;
    };

    try {
      await sock.sendPresenceUpdate(type, this.normalizeJid(jid));
    } catch {
      // Ignore presence update errors
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Load existing auth state from disk
   */
   
  private async loadAuthState(
    baileys: any,
    sessionPath: string
  ): Promise<{ state: unknown; saveCreds: () => Promise<void> }> {
    const useMultiFileAuthState = baileys.useMultiFileAuthState;
    return useMultiFileAuthState(sessionPath);
  }

  /**
   * Initialize fresh auth state
   */
   
  private async initFreshAuthState(
    baileys: any,
    sessionPath: string
  ): Promise<{ state: unknown; saveCreds: () => Promise<void> }> {
    const useMultiFileAuthState = baileys.useMultiFileAuthState;
    return useMultiFileAuthState(sessionPath);
  }

  /**
   * Handle Baileys connection update
   */
  private handleConnectionUpdate(update: Record<string, unknown>): void {
    const { connection, lastDisconnect, qr } = update as {
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number } } };
      qr?: string;
    };

    if (qr) {
      logger.debug('WhatsApp: QR code received, scan with your phone');
      this.emit('qr', qr);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== 401; // 401 = logged out

      logger.debug('WhatsApp connection closed', { statusCode, shouldReconnect });

      this.status.connected = false;
      this.status.authenticated = false;

      if (shouldReconnect && !this.reconnecting) {
        this.reconnectionManager.scheduleReconnect(async () => {
          this.reconnecting = true;
          try {
            await this.connect();
            this.reconnectionManager.onConnected();
          } catch (err) {
            this.emit('error', 'whatsapp', err instanceof Error ? err : new Error(String(err)));
          } finally {
            this.reconnecting = false;
          }
        });
      } else if (!shouldReconnect) {
        this.emit('disconnected', 'whatsapp', new Error(`Logged out (status ${statusCode})`));
      }
    } else if (connection === 'open') {
      this.status.connected = true;
      this.status.authenticated = true;
      this.status.lastActivity = new Date();
      this.reconnectionManager.onConnected();

      const sock = this.socket as { user?: { id?: string; name?: string } };
      this.status.info = {
        phoneNumber: this.waConfig.phoneNumber,
        jid: sock?.user?.id,
        name: sock?.user?.name,
      };

      logger.debug('WhatsApp connected successfully');
      this.emit('connected', 'whatsapp');
    }
  }

  /**
   * Handle incoming messages
   */
  private async handleMessagesUpsert(upsert: { messages: BaileysMessage[]; type: string }): Promise<void> {
    if (upsert.type !== 'notify') return;

    for (const msg of upsert.messages) {
      try {
        await this.processIncomingMessage(msg);
      } catch (err) {
        logger.debug('WhatsApp: error processing message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Process a single incoming WhatsApp message
   */
  private async processIncomingMessage(msg: BaileysMessage): Promise<void> {
    // Ignore messages from self
    if (msg.key.fromMe) return;

    // Ignore status broadcasts
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast') return;

    // Check user allowlist
    const senderId = msg.key.participant ?? remoteJid;
    const normalizedSender = senderId.replace(/@.*$/, '');
    if (!this.isUserAllowed(normalizedSender)) return;

    // Check channel allowlist
    const channelId = remoteJid.replace(/@.*$/, '');
    if (!this.isChannelAllowed(channelId)) return;

    const inbound = this.convertMessage(msg);
    const parsed = this.parseCommand(inbound);
    parsed.sessionKey = getSessionKey(parsed);

    // DM pairing check
    const pairingStatus = await checkDMPairing(parsed);
    if (!pairingStatus.approved) {
      const { getDMPairing } = await import('../dm-pairing.js');
      const pairingMessage = getDMPairing().getPairingMessage(pairingStatus);
      if (pairingMessage) {
        await this.send({ channelId: remoteJid, content: pairingMessage });
      }
      return;
    }

    this.status.lastActivity = new Date();
    this.emit('message', parsed);

    if (parsed.isCommand) {
      this.emit('command', parsed);
    }
  }

  /**
   * Convert Baileys message to InboundMessage
   */
  private convertMessage(msg: BaileysMessage): InboundMessage {
    const remoteJid = msg.key.remoteJid ?? '';
    const isGroup = remoteJid.endsWith('@g.us');
    const senderId = msg.key.participant ?? remoteJid;

    // Extract text content
    const messageBody = msg.message ?? {};
    const text =
      (messageBody.conversation as string) ??
      (messageBody.extendedTextMessage as { text?: string })?.text ??
      (messageBody.imageMessage as { caption?: string })?.caption ??
      (messageBody.videoMessage as { caption?: string })?.caption ??
      (messageBody.documentMessage as { caption?: string })?.caption ??
      '';

    // Extract attachments
    const attachments = this.extractAttachments(messageBody);

    // Determine timestamp
    let timestamp: Date;
    if (msg.messageTimestamp) {
      const ts = typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp
        : (msg.messageTimestamp as Long).toNumber();
      timestamp = new Date(ts * 1000);
    } else {
      timestamp = new Date();
    }

    return {
      id: msg.key.id ?? `wa-${Date.now()}`,
      channel: {
        id: remoteJid,
        type: 'whatsapp',
        name: msg.pushName ?? remoteJid.replace(/@.*$/, ''),
        isDM: !isGroup,
        isGroup,
      },
      sender: {
        id: senderId.replace(/@.*$/, ''),
        username: senderId.replace(/@.*$/, ''),
        displayName: msg.pushName ?? senderId.replace(/@.*$/, ''),
      },
      content: text,
      contentType: this.determineContentType(messageBody),
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp,
      raw: msg,
    };
  }

  /**
   * Extract attachments from a Baileys message object
   */
  private extractAttachments(messageBody: Record<string, unknown>): MessageAttachment[] {
    const attachments: MessageAttachment[] = [];

    if (messageBody.imageMessage) {
      const img = messageBody.imageMessage as {
        mimetype?: string;
        fileLength?: number;
        width?: number;
        height?: number;
        caption?: string;
        url?: string;
      };
      attachments.push({
        type: 'image',
        mimeType: img.mimetype,
        size: img.fileLength,
        width: img.width,
        height: img.height,
        caption: img.caption,
        url: img.url,
      });
    }

    if (messageBody.audioMessage) {
      const audio = messageBody.audioMessage as {
        mimetype?: string;
        fileLength?: number;
        seconds?: number;
        ptt?: boolean;
        url?: string;
      };
      attachments.push({
        type: audio.ptt ? 'voice' : 'audio',
        mimeType: audio.mimetype,
        size: audio.fileLength,
        duration: audio.seconds,
        url: audio.url,
      });
    }

    if (messageBody.videoMessage) {
      const video = messageBody.videoMessage as {
        mimetype?: string;
        fileLength?: number;
        seconds?: number;
        width?: number;
        height?: number;
        caption?: string;
        url?: string;
      };
      attachments.push({
        type: 'video',
        mimeType: video.mimetype,
        size: video.fileLength,
        duration: video.seconds,
        width: video.width,
        height: video.height,
        caption: video.caption,
        url: video.url,
      });
    }

    if (messageBody.documentMessage) {
      const doc = messageBody.documentMessage as {
        mimetype?: string;
        fileLength?: number;
        fileName?: string;
        url?: string;
      };
      attachments.push({
        type: 'file',
        mimeType: doc.mimetype,
        size: doc.fileLength,
        fileName: doc.fileName,
        url: doc.url,
      });
    }

    if (messageBody.stickerMessage) {
      const sticker = messageBody.stickerMessage as {
        mimetype?: string;
        width?: number;
        height?: number;
        url?: string;
      };
      attachments.push({
        type: 'sticker',
        mimeType: sticker.mimetype,
        width: sticker.width,
        height: sticker.height,
        url: sticker.url,
      });
    }

    if (messageBody.locationMessage) {
      const loc = messageBody.locationMessage as {
        degreesLatitude?: number;
        degreesLongitude?: number;
        name?: string;
      };
      attachments.push({
        type: 'location',
        data: JSON.stringify({
          latitude: loc.degreesLatitude,
          longitude: loc.degreesLongitude,
          name: loc.name,
        }),
      });
    }

    if (messageBody.contactMessage || messageBody.contactsArrayMessage) {
      attachments.push({
        type: 'contact',
        data: JSON.stringify(messageBody.contactMessage ?? messageBody.contactsArrayMessage),
      });
    }

    return attachments;
  }

  /**
   * Determine content type from message body
   */
  private determineContentType(messageBody: Record<string, unknown>): ContentType {
    if (messageBody.imageMessage) return 'image';
    if (messageBody.audioMessage) {
      const audio = messageBody.audioMessage as { ptt?: boolean };
      return audio.ptt ? 'voice' : 'audio';
    }
    if (messageBody.videoMessage) return 'video';
    if (messageBody.documentMessage) return 'file';
    if (messageBody.stickerMessage) return 'sticker';
    if (messageBody.locationMessage) return 'location';
    if (messageBody.contactMessage || messageBody.contactsArrayMessage) return 'contact';

    const text =
      (messageBody.conversation as string) ??
      (messageBody.extendedTextMessage as { text?: string })?.text ?? '';
    if (text.startsWith('/')) return 'command';
    return 'text';
  }

  /**
   * Build media content for sending
   */
  private buildMediaContent(
    attachment: MessageAttachment,
    caption?: string
  ): Record<string, unknown> {
    const source = attachment.url
      ? { url: attachment.url }
      : attachment.data
        ? { data: Buffer.from(attachment.data, 'base64') }
        : attachment.filePath
          ? { url: attachment.filePath }
          : {};

    switch (attachment.type) {
      case 'image':
        return { image: source, caption, mimetype: attachment.mimeType };
      case 'audio':
      case 'voice':
        return {
          audio: source,
          mimetype: attachment.mimeType ?? 'audio/ogg; codecs=opus',
          ptt: attachment.type === 'voice',
        };
      case 'video':
        return { video: source, caption, mimetype: attachment.mimeType };
      case 'sticker':
        return { sticker: source, mimetype: attachment.mimeType ?? 'image/webp' };
      case 'file':
      default:
        return {
          document: source,
          caption,
          mimetype: attachment.mimeType ?? 'application/octet-stream',
          fileName: attachment.fileName,
        };
    }
  }

  /**
   * Normalize a phone number or chat ID to a WhatsApp JID
   */
  private normalizeJid(id: string): string {
    // Already a JID
    if (id.includes('@')) return id;
    // Strip non-numeric for phone numbers
    const cleaned = id.replace(/[^0-9]/g, '');
    // Default to individual chat
    return `${cleaned}@s.whatsapp.net`;
  }
}

export default WhatsAppChannel;
