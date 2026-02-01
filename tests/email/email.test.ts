/**
 * Email Module Tests
 */

import {
  parseEmailAddress,
  formatEmailAddress,
  generateMessageId,
  ImapClient,
  SmtpClient,
  EmailService,
  WebhookManager,
  getEmailService,
  resetEmailService,
} from '../../src/email/index.js';

describe('Email Utilities', () => {
  describe('parseEmailAddress', () => {
    it('should parse simple email address', () => {
      const result = parseEmailAddress('test@example.com');
      expect(result).toEqual({ address: 'test@example.com' });
    });

    it('should parse email with name', () => {
      const result = parseEmailAddress('John Doe <john@example.com>');
      expect(result).toEqual({ name: 'John Doe', address: 'john@example.com' });
    });

    it('should handle already parsed address', () => {
      const input = { name: 'Test', address: 'test@example.com' };
      const result = parseEmailAddress(input);
      expect(result).toEqual(input);
    });
  });

  describe('formatEmailAddress', () => {
    it('should format address without name', () => {
      const result = formatEmailAddress({ address: 'test@example.com' });
      expect(result).toBe('test@example.com');
    });

    it('should format address with name', () => {
      const result = formatEmailAddress({ name: 'John', address: 'john@example.com' });
      expect(result).toBe('John <john@example.com>');
    });
  });

  describe('generateMessageId', () => {
    it('should generate unique message IDs', () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();

      expect(id1).toMatch(/^<[a-f0-9]+@codebuddy\.local>$/);
      expect(id1).not.toBe(id2);
    });

    it('should use custom domain', () => {
      const id = generateMessageId('custom.domain');
      expect(id).toContain('@custom.domain>');
    });
  });
});

describe('ImapClient', () => {
  let client: ImapClient;

  beforeEach(() => {
    client = new ImapClient({
      host: 'imap.test.com',
      port: 993,
      secure: true,
      user: 'test@test.com',
      password: 'password',
    });
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('connection', () => {
    it('should connect and disconnect', async () => {
      expect(client.isConnected()).toBe(false);

      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should emit events', async () => {
      const events: string[] = [];
      client.on('connected', () => events.push('connected'));
      client.on('disconnected', () => events.push('disconnected'));

      await client.connect();
      await client.disconnect();

      expect(events).toEqual(['connected', 'disconnected']);
    });
  });

  describe('folders', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should list default folders', async () => {
      const folders = await client.listFolders();

      expect(folders.length).toBeGreaterThan(0);
      expect(folders.some(f => f.specialUse === 'inbox')).toBe(true);
      expect(folders.some(f => f.specialUse === 'sent')).toBe(true);
    });

    it('should select folder', async () => {
      const folder = await client.selectFolder('INBOX');

      expect(folder.name).toBe('INBOX');
      expect(client.getSelectedFolder()).toBe('INBOX');
    });

    it('should create and delete folder', async () => {
      await client.createFolder('TestFolder');

      const folders = await client.listFolders();
      expect(folders.some(f => f.name === 'TestFolder')).toBe(true);

      await client.deleteFolder('TestFolder');

      const foldersAfter = await client.listFolders();
      expect(foldersAfter.some(f => f.name === 'TestFolder')).toBe(false);
    });
  });

  describe('messages', () => {
    beforeEach(async () => {
      await client.connect();
      await client.selectFolder('INBOX');

      // Add mock messages
      client.addMockMessage('INBOX', {
        subject: 'Test Message 1',
        text: 'Hello world',
        from: [{ address: 'sender@example.com' }],
      });
      client.addMockMessage('INBOX', {
        subject: 'Test Message 2',
        text: 'Another message',
        from: [{ address: 'other@example.com' }],
        flags: ['seen'],
      });
    });

    it('should search for messages', async () => {
      const uids = await client.search({ all: true });
      expect(uids.length).toBe(2);
    });

    it('should search unseen messages', async () => {
      const uids = await client.search({ unseen: true });
      expect(uids.length).toBe(1);
    });

    it('should search by subject', async () => {
      const uids = await client.search({ subject: 'Test Message 1' });
      expect(uids.length).toBe(1);
    });

    it('should search by from', async () => {
      const uids = await client.search({ from: 'sender@example.com' });
      expect(uids.length).toBe(1);
    });

    it('should fetch messages', async () => {
      const uids = await client.search({ all: true });
      const messages = await client.fetch(uids);

      expect(messages.length).toBe(2);
      expect(messages[0].subject).toBeDefined();
    });

    it('should add and remove flags', async () => {
      const uids = await client.search({ unseen: true });
      const uid = uids[0];

      await client.addFlags(uid, 'seen');
      let message = await client.fetchOne(uid);
      expect(message?.flags).toContain('seen');

      await client.removeFlags(uid, 'seen');
      message = await client.fetchOne(uid);
      expect(message?.flags).not.toContain('seen');
    });

    it('should move messages', async () => {
      const uids = await client.search({ all: true });
      const uid = uids[0];

      await client.move(uid, 'Trash');

      await client.selectFolder('INBOX');
      const remaining = await client.search({ all: true });
      expect(remaining.length).toBe(1);

      await client.selectFolder('Trash');
      const moved = await client.search({ all: true });
      expect(moved.length).toBe(1);
    });

    it('should copy messages', async () => {
      const uids = await client.search({ all: true });
      const uid = uids[0];

      await client.copy(uid, 'Drafts');

      await client.selectFolder('Drafts');
      const copied = await client.search({ all: true });
      expect(copied.length).toBe(1);

      await client.selectFolder('INBOX');
      const original = await client.search({ all: true });
      expect(original.length).toBe(2); // Original still there
    });

    it('should delete messages', async () => {
      const uids = await client.search({ all: true });
      const uid = uids[0];

      await client.delete(uid);

      await client.selectFolder('Trash');
      const trash = await client.search({ all: true });
      expect(trash.length).toBe(1);
    });
  });
});

describe('SmtpClient', () => {
  let client: SmtpClient;

  beforeEach(() => {
    client = new SmtpClient({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      user: 'test@test.com',
      password: 'password',
    });
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('connection', () => {
    it('should connect and disconnect', async () => {
      expect(client.isConnected()).toBe(false);

      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('sending', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should send email', async () => {
      const result = await client.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test body',
      });

      expect(result.messageId).toBeDefined();
      expect(result.accepted).toContain('recipient@example.com');
      expect(result.rejected).toHaveLength(0);
    });

    it('should send to multiple recipients', async () => {
      const result = await client.send({
        from: 'sender@example.com',
        to: ['one@example.com', 'two@example.com'],
        subject: 'Test Subject',
        text: 'Test body',
      });

      expect(result.accepted).toContain('one@example.com');
      expect(result.accepted).toContain('two@example.com');
    });

    it('should emit sent event', async () => {
      let sentResult: unknown = null;
      client.on('sent', (result) => { sentResult = result; });

      await client.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Test',
      });

      expect(sentResult).not.toBeNull();
    });

    it('should reject missing from', async () => {
      await expect(client.send({
        from: '',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Test',
      })).rejects.toThrow('From address is required');
    });

    it('should reject missing to', async () => {
      await expect(client.send({
        from: 'sender@example.com',
        to: [],
        subject: 'Test',
        text: 'Test',
      })).rejects.toThrow('To address is required');
    });
  });
});

describe('WebhookManager', () => {
  let manager: WebhookManager;

  beforeEach(() => {
    manager = new WebhookManager();
  });

  it('should add and remove webhooks', () => {
    manager.addWebhook({
      url: 'https://example.com/webhook',
      events: ['message.received'],
    });

    expect(manager.getWebhooks()).toHaveLength(1);

    manager.removeWebhook('https://example.com/webhook');
    expect(manager.getWebhooks()).toHaveLength(0);
  });

  it('should trigger webhooks', async () => {
    const events: string[] = [];

    manager.addWebhook({
      url: 'https://example.com/webhook',
      events: ['message.received'],
    });

    manager.on('webhook-sent', (url) => {
      events.push(url);
    });

    await manager.trigger('message.received', {
      message: { subject: 'Test' },
      account: 'test@test.com',
    });

    expect(events).toContain('https://example.com/webhook');
  });

  it('should filter by event type', async () => {
    const events: string[] = [];

    manager.addWebhook({
      url: 'https://example.com/webhook1',
      events: ['message.received'],
    });
    manager.addWebhook({
      url: 'https://example.com/webhook2',
      events: ['message.sent'],
    });

    manager.on('webhook-sent', (url) => {
      events.push(url);
    });

    await manager.trigger('message.received', {
      account: 'test@test.com',
    });

    expect(events).toContain('https://example.com/webhook1');
    expect(events).not.toContain('https://example.com/webhook2');
  });
});

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    resetEmailService();
    service = new EmailService({
      imap: {
        host: 'imap.test.com',
        port: 993,
        secure: true,
        user: 'test@test.com',
        password: 'password',
      },
      smtp: {
        host: 'smtp.test.com',
        port: 587,
        secure: false,
        user: 'test@test.com',
        password: 'password',
      },
    });
    await service.connect();
  });

  afterEach(async () => {
    await service.disconnect();
  });

  describe('connection', () => {
    it('should report connected status', () => {
      expect(service.isConnected()).toBe(true);
    });

    it('should emit connected event', async () => {
      const events: string[] = [];

      const newService = new EmailService({
        imap: {
          host: 'imap.test.com',
          port: 993,
          secure: true,
          user: 'test@test.com',
        },
      });

      newService.on('connected', () => events.push('connected'));
      await newService.connect();
      await newService.disconnect();

      expect(events).toContain('connected');
    });
  });

  describe('IMAP operations', () => {
    it('should list folders', async () => {
      const folders = await service.listFolders();
      expect(folders.length).toBeGreaterThan(0);
    });

    it('should fetch messages', async () => {
      service.addMockMessage('INBOX', { subject: 'Test' });

      await service.selectFolder('INBOX');
      const uids = await service.search({ all: true });
      const messages = await service.fetchMessages(uids);

      expect(messages.length).toBe(1);
    });

    it('should mark as read', async () => {
      const uid = service.addMockMessage('INBOX', { subject: 'Test' });

      await service.markAsRead(uid, 'INBOX');

      const message = await service.fetchMessage(uid, 'INBOX');
      expect(message?.flags).toContain('seen');
    });
  });

  describe('SMTP operations', () => {
    it('should send email', async () => {
      const result = await service.sendEmail({
        from: 'test@test.com',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Hello',
      });

      expect(result.messageId).toBeDefined();
    });

    it('should update stats on send', async () => {
      await service.sendEmail({
        from: 'test@test.com',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Hello',
      });

      const stats = service.getStats();
      expect(stats.messagesSent).toBe(1);
    });
  });

  describe('webhooks', () => {
    it('should add webhook', () => {
      service.addWebhook({
        url: 'https://example.com/webhook',
        events: ['message.received'],
      });

      expect(service.getWebhooks()).toHaveLength(1);
    });

    it('should trigger webhook on message', async () => {
      const events: string[] = [];

      service.addWebhook({
        url: 'https://example.com/webhook',
        events: ['message.received'],
      });

      service.on('webhook-sent', (url) => {
        events.push(url);
      });

      service.addMockMessage('INBOX', { subject: 'Test' });
      await service.syncFolder('INBOX');

      expect(events).toContain('https://example.com/webhook');
    });
  });

  describe('sync', () => {
    it('should sync folder', async () => {
      service.addMockMessage('INBOX', { subject: 'Test' });

      const count = await service.syncFolder('INBOX');
      expect(count).toBe(1);
    });

    it('should update stats on sync', async () => {
      service.addMockMessage('INBOX', { subject: 'Test' });

      await service.syncFolder('INBOX');

      const stats = service.getStats();
      expect(stats.messagesReceived).toBe(1);
      expect(stats.lastSync).toBeDefined();
    });
  });

  describe('statistics', () => {
    it('should provide stats', () => {
      const stats = service.getStats();

      expect(stats.connected).toBe(true);
      expect(stats.messagesReceived).toBe(0);
      expect(stats.messagesSent).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.uptime).toBeGreaterThan(0);
    });

    it('should reset stats', async () => {
      await service.sendEmail({
        from: 'test@test.com',
        to: 'recipient@example.com',
        subject: 'Test',
        text: 'Hello',
      });

      service.resetStats();

      const stats = service.getStats();
      expect(stats.messagesSent).toBe(0);
    });
  });
});

describe('Singleton', () => {
  beforeEach(() => {
    resetEmailService();
  });

  afterEach(() => {
    resetEmailService();
  });

  it('should return same instance', () => {
    const config = {
      imap: {
        host: 'imap.test.com',
        port: 993,
        secure: true,
        user: 'test@test.com',
      },
    };

    const service1 = getEmailService(config);
    const service2 = getEmailService();

    expect(service1).toBe(service2);
  });

  it('should reset instance', () => {
    const config = {
      imap: {
        host: 'imap.test.com',
        port: 993,
        secure: true,
        user: 'test@test.com',
      },
    };

    const service1 = getEmailService(config);
    resetEmailService();
    const service2 = getEmailService(config);

    expect(service1).not.toBe(service2);
  });
});
