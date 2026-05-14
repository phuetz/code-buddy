/**
 * Email Client
 *
 * Unified email client for IMAP/SMTP operations.
 * Real IMAP/SMTP transports still need adapters. The built-in `memory`
 * transport is an explicit test harness and is never selected by default.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type {
  ImapConfig,
  SmtpConfig,
  EmailMessage,
  EmailFolder,
  ImapSearchCriteria,
  ImapFetchOptions,
  SendMailOptions,
  SendMailResult,
  EmailFlag,
  EmailAddress,
} from './types.js';
import {
  DEFAULT_IMAP_CONFIG,
  DEFAULT_SMTP_CONFIG,
} from './types.js';

// ============================================================================
// Utility Functions
// ============================================================================

export function parseEmailAddress(input: string | EmailAddress): EmailAddress {
  if (typeof input === 'object') {
    return input;
  }

  // Parse "Name <email@example.com>" format
  const match = input.match(/^(.+?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim(), address: match[2].trim() };
  }

  return { address: input.trim() };
}

export function formatEmailAddress(addr: EmailAddress): string {
  if (addr.name) {
    return `${addr.name} <${addr.address}>`;
  }
  return addr.address;
}

export function generateMessageId(domain = 'codebuddy.local'): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `<${random}@${domain}>`;
}

// ============================================================================
// IMAP Client
// ============================================================================

export interface ImapClientEvents {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'mail': (numNew: number) => void;
  'expunge': (uid: number) => void;
  'flags': (uid: number, flags: EmailFlag[]) => void;
}

export class ImapClient extends EventEmitter {
  private config: ImapConfig;
  private connected = false;
  private selectedFolder: string | null = null;
  private idleTimeout: NodeJS.Timeout | null = null;
  private readonly transport: 'external' | 'memory';

  private memoryFolders: Map<string, EmailFolder> = new Map();
  private memoryMessages: Map<string, Map<number, EmailMessage>> = new Map();
  private nextUid = 1;

  constructor(config: ImapConfig) {
    super();
    this.config = { ...DEFAULT_IMAP_CONFIG, ...config } as ImapConfig;
    this.transport = this.config.transport ?? 'external';

    if (this.transport === 'memory') {
      this.initializeMemoryData();
    }
  }

  private initializeMemoryData(): void {
    // Create default folders
    const folders: EmailFolder[] = [
      { name: 'INBOX', path: 'INBOX', delimiter: '/', specialUse: 'inbox', totalMessages: 0, unseenMessages: 0 },
      { name: 'Sent', path: 'Sent', delimiter: '/', specialUse: 'sent', totalMessages: 0, unseenMessages: 0 },
      { name: 'Drafts', path: 'Drafts', delimiter: '/', specialUse: 'drafts', totalMessages: 0, unseenMessages: 0 },
      { name: 'Trash', path: 'Trash', delimiter: '/', specialUse: 'trash', totalMessages: 0, unseenMessages: 0 },
      { name: 'Spam', path: 'Spam', delimiter: '/', specialUse: 'spam', totalMessages: 0, unseenMessages: 0 },
    ];

    for (const folder of folders) {
      this.memoryFolders.set(folder.path, folder);
      this.memoryMessages.set(folder.path, new Map());
    }
  }

  /**
   * Connect to IMAP server
   */
  async connect(): Promise<void> {
    if (!this.config.host) {
      throw new Error('IMAP host is required');
    }

    if (this.transport !== 'memory') {
      throw new Error(
        'IMAP transport is not implemented. Configure a real IMAP adapter before connecting, or use transport: "memory" only in tests.'
      );
    }

    this.connected = true;
    this.emit('connected');
  }

  /**
   * Disconnect from server
   */
  async disconnect(): Promise<void> {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    this.connected = false;
    this.selectedFolder = null;
    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * List all folders
   */
  async listFolders(): Promise<EmailFolder[]> {
    this.ensureConnected();
    return Array.from(this.memoryFolders.values());
  }

  /**
   * Select a folder
   */
  async selectFolder(path: string): Promise<EmailFolder> {
    this.ensureConnected();

    const folder = this.memoryFolders.get(path);
    if (!folder) {
      throw new Error(`Folder not found: ${path}`);
    }

    this.selectedFolder = path;
    return folder;
  }

  /**
   * Get currently selected folder
   */
  getSelectedFolder(): string | null {
    return this.selectedFolder;
  }

  /**
   * Create a folder
   */
  async createFolder(path: string): Promise<EmailFolder> {
    this.ensureConnected();

    if (this.memoryFolders.has(path)) {
      throw new Error(`Folder already exists: ${path}`);
    }

    const folder: EmailFolder = {
      name: path.split('/').pop() || path,
      path,
      delimiter: '/',
      totalMessages: 0,
      unseenMessages: 0,
    };

    this.memoryFolders.set(path, folder);
    this.memoryMessages.set(path, new Map());

    return folder;
  }

  /**
   * Delete a folder
   */
  async deleteFolder(path: string): Promise<void> {
    this.ensureConnected();

    if (!this.memoryFolders.has(path)) {
      throw new Error(`Folder not found: ${path}`);
    }

    this.memoryFolders.delete(path);
    this.memoryMessages.delete(path);

    if (this.selectedFolder === path) {
      this.selectedFolder = null;
    }
  }

  /**
   * Search for messages
   */
  async search(criteria: ImapSearchCriteria, _options?: ImapFetchOptions): Promise<number[]> {
    this.ensureConnected();
    this.ensureFolderSelected();

    const messages = this.memoryMessages.get(this.selectedFolder!);
    if (!messages) return [];

    const results: number[] = [];

    for (const [uid, message] of messages) {
      if (this.matchesCriteria(message, criteria)) {
        results.push(uid);
      }
    }

    return results;
  }

  /**
   * Fetch messages by UID
   */
  async fetch(uids: number | number[], _options?: ImapFetchOptions): Promise<EmailMessage[]> {
    this.ensureConnected();
    this.ensureFolderSelected();

    const messages = this.memoryMessages.get(this.selectedFolder!);
    if (!messages) return [];

    const uidList = Array.isArray(uids) ? uids : [uids];
    const results: EmailMessage[] = [];

    for (const uid of uidList) {
      const message = messages.get(uid);
      if (message) {
        results.push(message);
      }
    }

    return results;
  }

  /**
   * Fetch a single message
   */
  async fetchOne(uid: number, options?: ImapFetchOptions): Promise<EmailMessage | null> {
    const messages = await this.fetch(uid, options);
    return messages[0] || null;
  }

  /**
   * Add flags to messages
   */
  async addFlags(uids: number | number[], flags: EmailFlag | EmailFlag[]): Promise<void> {
    this.ensureConnected();
    this.ensureFolderSelected();

    const messages = this.memoryMessages.get(this.selectedFolder!);
    if (!messages) return;

    const uidList = Array.isArray(uids) ? uids : [uids];
    const flagList = Array.isArray(flags) ? flags : [flags];

    for (const uid of uidList) {
      const message = messages.get(uid);
      if (message) {
        message.flags = message.flags || [];
        for (const flag of flagList) {
          if (!message.flags.includes(flag)) {
            message.flags.push(flag);
          }
        }
        this.emit('flags', uid, message.flags);
      }
    }
  }

  /**
   * Remove flags from messages
   */
  async removeFlags(uids: number | number[], flags: EmailFlag | EmailFlag[]): Promise<void> {
    this.ensureConnected();
    this.ensureFolderSelected();

    const messages = this.memoryMessages.get(this.selectedFolder!);
    if (!messages) return;

    const uidList = Array.isArray(uids) ? uids : [uids];
    const flagList = Array.isArray(flags) ? flags : [flags];

    for (const uid of uidList) {
      const message = messages.get(uid);
      if (message && message.flags) {
        message.flags = message.flags.filter(f => !flagList.includes(f));
        this.emit('flags', uid, message.flags);
      }
    }
  }

  /**
   * Move messages to another folder
   */
  async move(uids: number | number[], destFolder: string): Promise<void> {
    this.ensureConnected();
    this.ensureFolderSelected();

    const srcMessages = this.memoryMessages.get(this.selectedFolder!);
    const destMessages = this.memoryMessages.get(destFolder);

    if (!srcMessages || !destMessages) {
      throw new Error('Source or destination folder not found');
    }

    const uidList = Array.isArray(uids) ? uids : [uids];

    for (const uid of uidList) {
      const message = srcMessages.get(uid);
      if (message) {
        srcMessages.delete(uid);
        destMessages.set(uid, message);
        this.emit('expunge', uid);
      }
    }

    this.updateFolderCounts();
  }

  /**
   * Copy messages to another folder
   */
  async copy(uids: number | number[], destFolder: string): Promise<void> {
    this.ensureConnected();
    this.ensureFolderSelected();

    const srcMessages = this.memoryMessages.get(this.selectedFolder!);
    const destMessages = this.memoryMessages.get(destFolder);

    if (!srcMessages || !destMessages) {
      throw new Error('Source or destination folder not found');
    }

    const uidList = Array.isArray(uids) ? uids : [uids];

    for (const uid of uidList) {
      const message = srcMessages.get(uid);
      if (message) {
        const newUid = this.nextUid++;
        const copy = { ...message, uid: newUid, id: `msg-${newUid}` };
        destMessages.set(newUid, copy);
      }
    }

    this.updateFolderCounts();
  }

  /**
   * Delete messages (move to trash or permanently delete)
   */
  async delete(uids: number | number[], permanent = false): Promise<void> {
    if (permanent) {
      await this.addFlags(uids, 'deleted');
      await this.expunge();
    } else {
      await this.move(uids, 'Trash');
    }
  }

  /**
   * Expunge deleted messages
   */
  async expunge(): Promise<number[]> {
    this.ensureConnected();
    this.ensureFolderSelected();

    const messages = this.memoryMessages.get(this.selectedFolder!);
    if (!messages) return [];

    const expunged: number[] = [];

    for (const [uid, message] of messages) {
      if (message.flags?.includes('deleted')) {
        messages.delete(uid);
        expunged.push(uid);
        this.emit('expunge', uid);
      }
    }

    this.updateFolderCounts();
    return expunged;
  }

  /**
   * Start IDLE mode
   */
  async idle(timeout = 30000): Promise<void> {
    this.ensureConnected();
    this.ensureFolderSelected();

    return new Promise((resolve) => {
      this.idleTimeout = setTimeout(() => {
        this.idleTimeout = null;
        resolve();
      }, timeout);
    });
  }

  /**
   * Stop IDLE mode
   */
  stopIdle(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
  }

  /**
   * Append a message to a folder
   */
  async append(folder: string, message: Partial<EmailMessage>, flags?: EmailFlag[]): Promise<number> {
    this.ensureConnected();

    const messages = this.memoryMessages.get(folder);
    if (!messages) {
      throw new Error(`Folder not found: ${folder}`);
    }

    const uid = this.nextUid++;
    const fullMessage: EmailMessage = {
      id: `msg-${uid}`,
      uid,
      from: message.from || [],
      to: message.to || [],
      subject: message.subject || '(no subject)',
      date: message.date || new Date(),
      text: message.text,
      html: message.html,
      flags: flags || [],
      ...message,
    };

    messages.set(uid, fullMessage);
    this.updateFolderCounts();
    this.emit('mail', 1);

    return uid;
  }

  /**
   * Add a message to the explicit memory transport (for tests)
   */
  addTestMessage(folder: string, message: Partial<EmailMessage>): number {
    this.ensureMemoryTransport();

    const messages = this.memoryMessages.get(folder);
    if (!messages) {
      throw new Error(`Folder not found: ${folder}`);
    }

    const uid = this.nextUid++;
    const fullMessage: EmailMessage = {
      id: `msg-${uid}`,
      uid,
      from: message.from || [{ address: 'sender@example.com' }],
      to: message.to || [{ address: this.config.user }],
      subject: message.subject || 'Test message',
      date: message.date || new Date(),
      text: message.text || 'Test content',
      flags: message.flags || [],
      ...message,
    };

    messages.set(uid, fullMessage);
    this.updateFolderCounts();

    return uid;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected to IMAP server');
    }
  }

  private ensureMemoryTransport(): void {
    if (this.transport !== 'memory') {
      throw new Error('Test message injection requires transport: "memory"');
    }
  }

  private ensureFolderSelected(): void {
    if (!this.selectedFolder) {
      throw new Error('No folder selected');
    }
  }

  private matchesCriteria(message: EmailMessage, criteria: ImapSearchCriteria): boolean {
    if (criteria.all) return true;

    if (criteria.seen !== undefined) {
      const hasSeen = message.flags?.includes('seen') ?? false;
      if (criteria.seen !== hasSeen) return false;
    }

    if (criteria.unseen !== undefined) {
      const hasSeen = message.flags?.includes('seen') ?? false;
      if (criteria.unseen !== !hasSeen) return false;
    }

    if (criteria.flagged !== undefined) {
      const hasFlagged = message.flags?.includes('flagged') ?? false;
      if (criteria.flagged !== hasFlagged) return false;
    }

    if (criteria.from) {
      const hasFrom = message.from.some(a =>
        a.address.toLowerCase().includes(criteria.from!.toLowerCase()) ||
        a.name?.toLowerCase().includes(criteria.from!.toLowerCase())
      );
      if (!hasFrom) return false;
    }

    if (criteria.to) {
      const hasTo = message.to.some(a =>
        a.address.toLowerCase().includes(criteria.to!.toLowerCase()) ||
        a.name?.toLowerCase().includes(criteria.to!.toLowerCase())
      );
      if (!hasTo) return false;
    }

    if (criteria.subject) {
      if (!message.subject.toLowerCase().includes(criteria.subject.toLowerCase())) {
        return false;
      }
    }

    if (criteria.body || criteria.text) {
      const searchText = (criteria.body || criteria.text)!.toLowerCase();
      const hasText = message.text?.toLowerCase().includes(searchText) ||
                      message.html?.toLowerCase().includes(searchText);
      if (!hasText) return false;
    }

    if (criteria.before) {
      if (message.date >= criteria.before) return false;
    }

    if (criteria.since) {
      if (message.date < criteria.since) return false;
    }

    if (criteria.uid !== undefined) {
      const uids = Array.isArray(criteria.uid) ? criteria.uid : [criteria.uid];
      if (!uids.includes(message.uid!)) return false;
    }

    return true;
  }

  private updateFolderCounts(): void {
    for (const [path, folder] of this.memoryFolders) {
      const messages = this.memoryMessages.get(path);
      if (messages) {
        folder.totalMessages = messages.size;
        folder.unseenMessages = Array.from(messages.values())
          .filter(m => !m.flags?.includes('seen')).length;
      }
    }
  }
}

// ============================================================================
// SMTP Client
// ============================================================================

export interface SmtpClientEvents {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'sent': (result: SendMailResult) => void;
}

export class SmtpClient extends EventEmitter {
  private config: SmtpConfig;
  private connected = false;
  private readonly transport: 'external' | 'memory';
  private memorySentMessages: SendMailResult[] = [];

  constructor(config: SmtpConfig) {
    super();
    this.config = { ...DEFAULT_SMTP_CONFIG, ...config } as SmtpConfig;
    this.transport = this.config.transport ?? 'external';
  }

  /**
   * Connect to SMTP server
   */
  async connect(): Promise<void> {
    if (!this.config.host) {
      throw new Error('SMTP host is required');
    }

    if (this.transport !== 'memory') {
      throw new Error(
        'SMTP transport is not implemented. Configure a real SMTP adapter before connecting, or use transport: "memory" only in tests.'
      );
    }

    this.connected = true;
    this.emit('connected');
  }

  /**
   * Disconnect from server
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send an email
   */
  async send(options: SendMailOptions): Promise<SendMailResult> {
    this.ensureConnected();

    // Validate required fields
    if (!options.from) {
      throw new Error('From address is required');
    }
    if (!options.to || (Array.isArray(options.to) && options.to.length === 0)) {
      throw new Error('To address is required');
    }
    if (!options.subject) {
      throw new Error('Subject is required');
    }

    const toAddresses = Array.isArray(options.to)
      ? options.to.map(a => typeof a === 'string' ? a : a.address)
      : [typeof options.to === 'string' ? options.to : options.to.address];

    const result: SendMailResult = {
      messageId: generateMessageId(),
      accepted: toAddresses,
      rejected: [],
      pending: [],
      response: '250 OK',
    };

    this.memorySentMessages.push(result);
    this.emit('sent', result);

    return result;
  }

  /**
   * Verify connection
   */
  async verify(): Promise<boolean> {
    this.ensureConnected();
    return true;
  }

  /**
   * Get sent messages (for testing)
   */
  getSentMessages(): SendMailResult[] {
    return [...this.memorySentMessages];
  }

  /**
   * Clear sent messages (for testing)
   */
  clearSentMessages(): void {
    this.memorySentMessages = [];
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected to SMTP server');
    }
  }
}
