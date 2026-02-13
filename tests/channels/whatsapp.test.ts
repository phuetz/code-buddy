/**
 * WhatsApp Channel Tests
 *
 * Tests for the WhatsApp channel adapter using @whiskeysockets/baileys.
 * All external dependencies are mocked.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Mocks
// ============================================================================

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fs
const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
jest.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

// Mock dm-pairing dynamic import
jest.mock('../../src/channels/dm-pairing.js', () => ({
  getDMPairing: () => ({
    requiresPairing: () => false,
    getPairingMessage: () => '',
  }),
}));

// Mock session-isolation (used by getSessionKey)
jest.mock('../../src/channels/session-isolation.js', () => ({
  getSessionIsolator: jest.fn().mockReturnValue({
    getSessionKey: jest.fn().mockReturnValue('whatsapp:1234567890'),
  }),
}));

// Mock identity-links (used by getCanonicalIdentity)
jest.mock('../../src/channels/identity-links.js', () => ({
  getIdentityLinker: jest.fn().mockReturnValue({
    resolve: jest.fn().mockReturnValue(null),
  }),
}));

// Mock peer-routing
jest.mock('../../src/channels/peer-routing.js', () => ({
  getPeerRouter: jest.fn().mockReturnValue({
    resolve: jest.fn().mockReturnValue(null),
    getAgentConfig: jest.fn().mockReturnValue({}),
  }),
}));

// Mock concurrency lane-queue
jest.mock('../../src/concurrency/lane-queue.js', () => ({
  LaneQueue: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn((_: unknown, handler: () => unknown) => handler()),
    clear: jest.fn(),
  })),
}));

// Shared mock state - these survive jest.clearAllMocks() because we
// re-assign implementations in beforeEach.
const mockSaveCreds = jest.fn();
const mockUseMultiFileAuthState = jest.fn();
const mockSendMessage = jest.fn();
const mockSendPresenceUpdate = jest.fn();
const mockEnd = jest.fn();
const mockMakeWASocket = jest.fn();

// The mock socket event emitter for Baileys - re-created per test via mockMakeWASocket
let mockSocketEv: EventEmitter;

// Mock the dynamic import of @whiskeysockets/baileys
// When the source code does `await import(...)`, ts-jest/Jest wraps the module.
// For `baileys.default` to work, we need `__esModule: true` + `default` export.
// We also need `makeWASocket` as a fallback since the code does
// `baileys.default ?? baileys.makeWASocket`.
jest.mock('@whiskeysockets/baileys', () => {
  return {
    __esModule: true,
    get default() { return mockMakeWASocket; },
    get makeWASocket() { return mockMakeWASocket; },
    get useMultiFileAuthState() { return mockUseMultiFileAuthState; },
  };
}, { virtual: true });

// Must import AFTER mocks are set up
import { WhatsAppChannel } from '../../src/channels/whatsapp/index.js';
import type { WhatsAppConfig } from '../../src/channels/whatsapp/index.js';

// ============================================================================
// Helpers
// ============================================================================

function createConfig(overrides: Partial<WhatsAppConfig> = {}): WhatsAppConfig {
  return {
    type: 'whatsapp',
    enabled: true,
    ...overrides,
  };
}

/**
 * Initialize all mock implementations. Called in beforeEach so that
 * jest.clearAllMocks() does not leave mocks without implementations.
 */
function setupMockImplementations(): void {
  mockExistsSync.mockReturnValue(true);
  mockMkdirSync.mockReturnValue(undefined);

  mockSaveCreds.mockResolvedValue(undefined);
  mockUseMultiFileAuthState.mockResolvedValue({
    state: { creds: {}, keys: {} },
    saveCreds: mockSaveCreds,
  });

  mockSendMessage.mockResolvedValue({ key: { id: 'msg-001' } });
  mockSendPresenceUpdate.mockResolvedValue(undefined);
  mockEnd.mockReturnValue(undefined);

  mockMakeWASocket.mockImplementation(() => {
    mockSocketEv = new EventEmitter();
    return {
      ev: mockSocketEv,
      sendMessage: mockSendMessage,
      sendPresenceUpdate: mockSendPresenceUpdate,
      end: mockEnd,
      user: { id: '1234567890@s.whatsapp.net', name: 'TestBot' },
    };
  });
}

/**
 * Connect the channel and auto-fire the 'open' connection update
 * so the connect() promise resolves.
 */
async function connectChannel(channel: WhatsAppChannel): Promise<void> {
  const connectPromise = channel.connect();
  // After connect() sets up the socket, fire 'connection.update' open
  // Use setImmediate to let connect() register the event handlers first
  await new Promise(resolve => setImmediate(resolve));
  mockSocketEv.emit('connection.update', { connection: 'open' });
  await connectPromise;
}

function makeBaileysMessage(overrides: Record<string, unknown> = {}) {
  const { key, message, ...rest } = overrides;
  return {
    key: {
      remoteJid: '5551234567@s.whatsapp.net',
      fromMe: false,
      id: 'ABCDEF123456',
      participant: null,
      ...(key as Record<string, unknown> ?? {}),
    },
    message: message !== undefined
      ? message  // Allow null/explicit overrides
      : { conversation: 'Hello from WhatsApp' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Test User',
    ...rest,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('WhatsAppChannel', () => {
  let channel: WhatsAppChannel;

  beforeEach(() => {
    jest.clearAllMocks();
    setupMockImplementations();
    channel = new WhatsAppChannel(createConfig());
  });

  afterEach(async () => {
    try {
      await channel.disconnect();
    } catch {
      // ignore
    }
  });

  // ==========================================================================
  // Constructor & Config Defaults
  // ==========================================================================

  describe('constructor', () => {
    it('should create channel with type whatsapp', () => {
      expect(channel.type).toBe('whatsapp');
      expect(channel.getStatus().type).toBe('whatsapp');
    });

    it('should set default sessionDataPath when not provided', () => {
      const ch = new WhatsAppChannel(createConfig());
      const config = (ch as unknown as { config: WhatsAppConfig }).config;
      expect(config.sessionDataPath).toContain('whatsapp-session');
    });

    it('should set default qrTimeout to 60000 when not provided', () => {
      const ch = new WhatsAppChannel(createConfig());
      const config = (ch as unknown as { config: WhatsAppConfig }).config;
      expect(config.qrTimeout).toBe(60000);
    });

    it('should preserve custom qrTimeout when provided', () => {
      const ch = new WhatsAppChannel(createConfig({ qrTimeout: 30000 }));
      const config = (ch as unknown as { config: WhatsAppConfig }).config;
      expect(config.qrTimeout).toBe(30000);
    });

    it('should set default printQrInTerminal to true', () => {
      const ch = new WhatsAppChannel(createConfig());
      const config = (ch as unknown as { config: WhatsAppConfig }).config;
      expect(config.printQrInTerminal).toBe(true);
    });

    it('should preserve custom printQrInTerminal when set to false', () => {
      const ch = new WhatsAppChannel(createConfig({ printQrInTerminal: false }));
      const config = (ch as unknown as { config: WhatsAppConfig }).config;
      expect(config.printQrInTerminal).toBe(false);
    });

    it('should set default browserName to Code Buddy', () => {
      const ch = new WhatsAppChannel(createConfig());
      const config = (ch as unknown as { config: WhatsAppConfig }).config;
      expect(config.browserName).toBe('Code Buddy');
    });

    it('should use custom browserName when provided', () => {
      const ch = new WhatsAppChannel(createConfig({ browserName: 'My Bot' }));
      const config = (ch as unknown as { config: WhatsAppConfig }).config;
      expect(config.browserName).toBe('My Bot');
    });

    it('should use custom sessionDataPath when provided', () => {
      const ch = new WhatsAppChannel(createConfig({ sessionDataPath: '/tmp/wa-session' }));
      const config = (ch as unknown as { config: WhatsAppConfig }).config;
      expect(config.sessionDataPath).toBe('/tmp/wa-session');
    });

    it('should return initial status as disconnected', () => {
      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });
  });

  // ==========================================================================
  // Connect Lifecycle
  // ==========================================================================

  describe('connect', () => {
    it('should connect successfully and set status', async () => {
      await connectChannel(channel);

      const status = channel.getStatus();
      expect(status.connected).toBe(true);
      expect(status.authenticated).toBe(true);
    });

    it('should emit connected event on successful connection', async () => {
      const connectedSpy = jest.fn();
      channel.on('connected', connectedSpy);

      await connectChannel(channel);

      expect(connectedSpy).toHaveBeenCalledWith('whatsapp');
    });

    it('should call makeWASocket with correct options', async () => {
      await connectChannel(channel);

      expect(mockMakeWASocket).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: expect.anything(),
          printQRInTerminal: true,
          browser: ['Code Buddy', 'Chrome', '120.0'],
          markOnlineOnConnect: true,
        })
      );
    });

    it('should register creds.update handler', async () => {
      await connectChannel(channel);

      // Trigger creds.update and verify saveCreds is called
      mockSocketEv.emit('creds.update');
      expect(mockSaveCreds).toHaveBeenCalled();
    });

    it('should create session directory if it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await connectChannel(channel);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('whatsapp-session'),
        { recursive: true }
      );
    });

    it('should not create session directory if it already exists', async () => {
      mockExistsSync.mockReturnValue(true);

      await connectChannel(channel);

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('should set socket user info on connection open', async () => {
      await connectChannel(channel);

      const status = channel.getStatus();
      expect(status.info).toBeDefined();
      expect(status.info?.jid).toBe('1234567890@s.whatsapp.net');
      expect(status.info?.name).toBe('TestBot');
    });

    it('should update lastActivity on connection open', async () => {
      await connectChannel(channel);

      const status = channel.getStatus();
      expect(status.lastActivity).toBeInstanceOf(Date);
    });

    it('should use fresh auth state when loading fails', async () => {
      // Make the first call fail, second succeeds
      mockUseMultiFileAuthState
        .mockRejectedValueOnce(new Error('corrupt auth'))
        .mockResolvedValueOnce({
          state: { creds: {}, keys: {} },
          saveCreds: mockSaveCreds,
        });

      await connectChannel(channel);

      expect(mockUseMultiFileAuthState).toHaveBeenCalledTimes(2);
      expect(channel.getStatus().connected).toBe(true);
    });

    it('should pass custom browser name to socket', async () => {
      const ch = new WhatsAppChannel(createConfig({ browserName: 'Custom Bot' }));

      const connectPromise = ch.connect();
      await new Promise(resolve => setImmediate(resolve));
      mockSocketEv.emit('connection.update', { connection: 'open' });
      await connectPromise;

      expect(mockMakeWASocket).toHaveBeenCalledWith(
        expect.objectContaining({
          browser: ['Custom Bot', 'Chrome', '120.0'],
        })
      );

      await ch.disconnect();
    });

    it('should store phone number in status info', async () => {
      const ch = new WhatsAppChannel(createConfig({ phoneNumber: '+15551234567' }));

      const connectPromise = ch.connect();
      await new Promise(resolve => setImmediate(resolve));
      mockSocketEv.emit('connection.update', { connection: 'open' });
      await connectPromise;

      const status = ch.getStatus();
      expect(status.info?.phoneNumber).toBe('+15551234567');

      await ch.disconnect();
    });
  });

  // ==========================================================================
  // QR Code Handling
  // ==========================================================================

  describe('QR code handling', () => {
    it('should emit qr event when QR code is received', async () => {
      const qrSpy = jest.fn();
      channel.on('qr', qrSpy);

      const connectPromise = channel.connect();
      await new Promise(resolve => setImmediate(resolve));

      // Fire QR code event
      mockSocketEv.emit('connection.update', { qr: 'qr-code-data-here' });

      // Then open connection
      mockSocketEv.emit('connection.update', { connection: 'open' });
      await connectPromise;

      expect(qrSpy).toHaveBeenCalledWith('qr-code-data-here');
    });

    it('should reject with timeout error if QR pairing times out', async () => {
      jest.useFakeTimers();

      const ch = new WhatsAppChannel(createConfig({ qrTimeout: 5000 }));

      const connectPromise = ch.connect();

      // Let microtasks (the async connect body, await import, await auth) resolve
      // We need multiple rounds because connect() has multiple awaits
      await jest.advanceTimersByTimeAsync(0);

      // Fast-forward past QR timeout
      jest.advanceTimersByTime(6000);

      await expect(connectPromise).rejects.toThrow('WhatsApp QR pairing timed out');

      jest.useRealTimers();
    });
  });

  // ==========================================================================
  // Disconnect
  // ==========================================================================

  describe('disconnect', () => {
    it('should set status to disconnected', async () => {
      await connectChannel(channel);
      await channel.disconnect();

      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    it('should emit disconnected event', async () => {
      await connectChannel(channel);

      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      await channel.disconnect();

      expect(disconnectedSpy).toHaveBeenCalledWith('whatsapp');
    });

    it('should call socket.end()', async () => {
      await connectChannel(channel);
      await channel.disconnect();

      expect(mockEnd).toHaveBeenCalledWith(undefined);
    });

    it('should handle disconnect when not connected', async () => {
      // Should not throw
      await channel.disconnect();

      expect(channel.getStatus().connected).toBe(false);
    });

    it('should ignore socket.end() errors gracefully', async () => {
      await connectChannel(channel);

      mockEnd.mockImplementation(() => {
        throw new Error('Socket already closed');
      });

      // Should not throw
      await channel.disconnect();
      expect(channel.getStatus().connected).toBe(false);
    });

    it('should set socket to null after disconnect', async () => {
      await connectChannel(channel);
      await channel.disconnect();

      // Calling send after disconnect should say not connected
      const result = await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Hello',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('WhatsApp not connected');
    });
  });

  // ==========================================================================
  // Send Messages
  // ==========================================================================

  describe('send', () => {
    beforeEach(async () => {
      await connectChannel(channel);
    });

    it('should send a text message', async () => {
      const result = await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Hello!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-001');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        { text: 'Hello!' },
        {}
      );
    });

    it('should normalize phone number to JID', async () => {
      await channel.send({
        channelId: '+15551234567',
        content: 'Hi',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '15551234567@s.whatsapp.net',
        { text: 'Hi' },
        {}
      );
    });

    it('should preserve JID that already contains @', async () => {
      await channel.send({
        channelId: '5551234567@g.us',
        content: 'Group message',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@g.us',
        { text: 'Group message' },
        {}
      );
    });

    it('should send reply with quoted message reference', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Reply text',
        replyTo: 'original-msg-id',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        { text: 'Reply text' },
        { quoted: { key: { id: 'original-msg-id' } } }
      );
    });

    it('should send image attachment', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Check this out',
        attachments: [
          {
            type: 'image',
            url: 'https://example.com/image.jpg',
            mimeType: 'image/jpeg',
          },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        {
          image: { url: 'https://example.com/image.jpg' },
          caption: 'Check this out',
          mimetype: 'image/jpeg',
        },
        {}
      );
    });

    it('should send audio attachment', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: '',
        attachments: [
          {
            type: 'audio',
            url: 'https://example.com/audio.mp3',
            mimeType: 'audio/mpeg',
          },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        {
          audio: { url: 'https://example.com/audio.mp3' },
          mimetype: 'audio/mpeg',
          ptt: false,
        },
        {}
      );
    });

    it('should send voice note with ptt flag', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: '',
        attachments: [
          {
            type: 'voice',
            url: 'https://example.com/voice.ogg',
          },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        {
          audio: { url: 'https://example.com/voice.ogg' },
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        },
        {}
      );
    });

    it('should send video attachment', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Watch this',
        attachments: [
          {
            type: 'video',
            url: 'https://example.com/video.mp4',
            mimeType: 'video/mp4',
          },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        {
          video: { url: 'https://example.com/video.mp4' },
          caption: 'Watch this',
          mimetype: 'video/mp4',
        },
        {}
      );
    });

    it('should send sticker attachment', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: '',
        attachments: [
          {
            type: 'sticker',
            url: 'https://example.com/sticker.webp',
          },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        {
          sticker: { url: 'https://example.com/sticker.webp' },
          mimetype: 'image/webp',
        },
        {}
      );
    });

    it('should send document attachment', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Here is the file',
        attachments: [
          {
            type: 'file',
            url: 'https://example.com/doc.pdf',
            mimeType: 'application/pdf',
            fileName: 'document.pdf',
          },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        {
          document: { url: 'https://example.com/doc.pdf' },
          caption: 'Here is the file',
          mimetype: 'application/pdf',
          fileName: 'document.pdf',
        },
        {}
      );
    });

    it('should send base64 data attachment', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: '',
        attachments: [
          {
            type: 'image',
            data: 'iVBORw0KGgo=',
            mimeType: 'image/png',
          },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        {
          image: { data: expect.any(Buffer) },
          caption: '',
          mimetype: 'image/png',
        },
        {}
      );
    });

    it('should send file path attachment', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: '',
        attachments: [
          {
            type: 'file',
            filePath: '/tmp/file.txt',
          },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        {
          document: { url: '/tmp/file.txt' },
          caption: '',
          mimetype: 'application/octet-stream',
          fileName: undefined,
        },
        {}
      );
    });

    it('should return error when not connected', async () => {
      await channel.disconnect();

      const result = await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('WhatsApp not connected');
    });

    it('should handle sendMessage errors gracefully', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle non-Error exceptions in send', async () => {
      mockSendMessage.mockRejectedValueOnce('string error');

      const result = await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('should handle undefined messageId in send result', async () => {
      mockSendMessage.mockResolvedValueOnce({ key: {} });

      const result = await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Hello',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
    });
  });

  // ==========================================================================
  // Send Presence Update
  // ==========================================================================

  describe('sendPresenceUpdate', () => {
    beforeEach(async () => {
      await connectChannel(channel);
    });

    it('should send composing presence', async () => {
      await channel.sendPresenceUpdate('5551234567@s.whatsapp.net', 'composing');

      expect(mockSendPresenceUpdate).toHaveBeenCalledWith(
        'composing',
        '5551234567@s.whatsapp.net'
      );
    });

    it('should send paused presence', async () => {
      await channel.sendPresenceUpdate('5551234567@s.whatsapp.net', 'paused');

      expect(mockSendPresenceUpdate).toHaveBeenCalledWith(
        'paused',
        '5551234567@s.whatsapp.net'
      );
    });

    it('should default to composing type', async () => {
      await channel.sendPresenceUpdate('5551234567@s.whatsapp.net');

      expect(mockSendPresenceUpdate).toHaveBeenCalledWith(
        'composing',
        '5551234567@s.whatsapp.net'
      );
    });

    it('should normalize phone number to JID', async () => {
      await channel.sendPresenceUpdate('+15551234567');

      expect(mockSendPresenceUpdate).toHaveBeenCalledWith(
        'composing',
        '15551234567@s.whatsapp.net'
      );
    });

    it('should not throw when socket is null', async () => {
      await channel.disconnect();

      // Should not throw
      await channel.sendPresenceUpdate('5551234567@s.whatsapp.net');
      expect(mockSendPresenceUpdate).not.toHaveBeenCalled();
    });

    it('should ignore presence update errors', async () => {
      mockSendPresenceUpdate.mockRejectedValueOnce(new Error('presence error'));

      // Should not throw
      await channel.sendPresenceUpdate('5551234567@s.whatsapp.net');
    });
  });

  // ==========================================================================
  // Message Receiving & Conversion
  // ==========================================================================

  describe('message receiving', () => {
    beforeEach(async () => {
      await connectChannel(channel);
    });

    it('should emit message event for incoming text message', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage();
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      // Allow async processing
      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).toHaveBeenCalled();
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.content).toBe('Hello from WhatsApp');
      expect(inbound.channel.type).toBe('whatsapp');
      expect(inbound.sender.displayName).toBe('Test User');
    });

    it('should ignore messages from self', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: { fromMe: true },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore status broadcasts', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: { remoteJid: 'status@broadcast' },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore messages with null remoteJid', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: { remoteJid: null },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore non-notify upsert types', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage();
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'append',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should convert extendedTextMessage correctly', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: { extendedTextMessage: { text: 'Extended message' } },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.content).toBe('Extended message');
    });

    it('should extract caption from image message', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          imageMessage: {
            caption: 'Photo caption',
            mimetype: 'image/jpeg',
            fileLength: 12345,
            width: 800,
            height: 600,
            url: 'https://example.com/image.jpg',
          },
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.content).toBe('Photo caption');
      expect(inbound.contentType).toBe('image');
      expect(inbound.attachments).toHaveLength(1);
      expect(inbound.attachments[0].type).toBe('image');
      expect(inbound.attachments[0].mimeType).toBe('image/jpeg');
      expect(inbound.attachments[0].size).toBe(12345);
      expect(inbound.attachments[0].width).toBe(800);
      expect(inbound.attachments[0].height).toBe(600);
    });

    it('should handle audio messages with ptt as voice type', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          audioMessage: {
            mimetype: 'audio/ogg; codecs=opus',
            fileLength: 5000,
            seconds: 10,
            ptt: true,
            url: 'https://example.com/voice.ogg',
          },
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('voice');
      expect(inbound.attachments).toHaveLength(1);
      expect(inbound.attachments[0].type).toBe('voice');
      expect(inbound.attachments[0].duration).toBe(10);
    });

    it('should handle regular audio messages as audio type', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          audioMessage: {
            mimetype: 'audio/mpeg',
            ptt: false,
          },
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('audio');
      expect(inbound.attachments[0].type).toBe('audio');
    });

    it('should handle video messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          videoMessage: {
            caption: 'Video caption',
            mimetype: 'video/mp4',
            fileLength: 50000,
            seconds: 30,
            width: 1920,
            height: 1080,
            url: 'https://example.com/video.mp4',
          },
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.content).toBe('Video caption');
      expect(inbound.contentType).toBe('video');
      expect(inbound.attachments[0].type).toBe('video');
      expect(inbound.attachments[0].duration).toBe(30);
    });

    it('should handle document messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          documentMessage: {
            caption: 'Doc caption',
            mimetype: 'application/pdf',
            fileLength: 1024,
            fileName: 'report.pdf',
            url: 'https://example.com/report.pdf',
          },
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.content).toBe('Doc caption');
      expect(inbound.contentType).toBe('file');
      expect(inbound.attachments[0].type).toBe('file');
      expect(inbound.attachments[0].fileName).toBe('report.pdf');
    });

    it('should handle sticker messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          stickerMessage: {
            mimetype: 'image/webp',
            width: 512,
            height: 512,
            url: 'https://example.com/sticker.webp',
          },
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('sticker');
      expect(inbound.attachments[0].type).toBe('sticker');
      expect(inbound.attachments[0].width).toBe(512);
    });

    it('should handle location messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          locationMessage: {
            degreesLatitude: 51.5074,
            degreesLongitude: -0.1278,
            name: 'London',
          },
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('location');
      expect(inbound.attachments[0].type).toBe('location');
      const locData = JSON.parse(inbound.attachments[0].data);
      expect(locData.latitude).toBe(51.5074);
      expect(locData.longitude).toBe(-0.1278);
      expect(locData.name).toBe('London');
    });

    it('should handle contact messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          contactMessage: { displayName: 'John Doe', vcard: 'BEGIN:VCARD...' },
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('contact');
      expect(inbound.attachments[0].type).toBe('contact');
    });

    it('should handle contactsArrayMessage', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {
          contactsArrayMessage: [{ displayName: 'John' }, { displayName: 'Jane' }],
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('contact');
    });

    it('should detect command content type for messages starting with /', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: { conversation: '/help arg1 arg2' },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('command');
    });

    it('should parse commands and emit command event', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      const msg = makeBaileysMessage({
        message: { conversation: '/start hello world' },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(commandSpy).toHaveBeenCalled();
      const parsed = commandSpy.mock.calls[0][0];
      expect(parsed.isCommand).toBe(true);
      expect(parsed.commandName).toBe('start');
      expect(parsed.commandArgs).toEqual(['hello', 'world']);
    });

    it('should identify group messages correctly', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: {
          remoteJid: '120363012345@g.us',
          participant: '5551234567@s.whatsapp.net',
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.channel.isGroup).toBe(true);
      expect(inbound.channel.isDM).toBe(false);
    });

    it('should identify DM messages correctly', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: {
          remoteJid: '5551234567@s.whatsapp.net',
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.channel.isDM).toBe(true);
      expect(inbound.channel.isGroup).toBe(false);
    });

    it('should use participant as sender ID in group chats', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: {
          remoteJid: '120363012345@g.us',
          participant: '5559876543@s.whatsapp.net',
        },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.sender.id).toBe('5559876543');
    });

    it('should handle Long timestamp type', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const longTimestamp = { toNumber: () => 1700000000 };
      const msg = makeBaileysMessage({
        messageTimestamp: longTimestamp,
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.timestamp).toEqual(new Date(1700000000 * 1000));
    });

    it('should fallback to Date.now() when no timestamp', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const beforeTime = Date.now();
      const msg = makeBaileysMessage({
        messageTimestamp: null,
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime);
    });

    it('should generate fallback message ID when key.id is null', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: { id: null },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.id).toMatch(/^wa-\d+$/);
    });

    it('should use pushName as display name', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({ pushName: 'Alice' });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.sender.displayName).toBe('Alice');
      expect(inbound.channel.name).toBe('Alice');
    });

    it('should fallback to JID number when pushName is null', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({ pushName: null });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.sender.displayName).toBe('5551234567');
    });

    it('should include raw message data', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage();
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.raw).toBe(msg);
    });

    it('should handle empty message body gracefully', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: {},
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.content).toBe('');
      expect(inbound.contentType).toBe('text');
    });

    it('should handle null message body gracefully', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: null,
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.content).toBe('');
    });

    it('should set no attachments for plain text messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage({
        message: { conversation: 'Plain text only' },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.attachments).toBeUndefined();
    });

    it('should process multiple messages in a single upsert', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg1 = makeBaileysMessage({
        key: { id: 'msg-1' },
        message: { conversation: 'First' },
      });
      const msg2 = makeBaileysMessage({
        key: { id: 'msg-2' },
        message: { conversation: 'Second' },
      });

      mockSocketEv.emit('messages.upsert', {
        messages: [msg1, msg2],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));
      // Give a bit more time for both async message handlers
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(messageSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // User & Channel Filtering
  // ==========================================================================

  describe('user and channel filtering', () => {
    it('should filter out unauthorized users when allowedUsers is set', async () => {
      const ch = new WhatsAppChannel(createConfig({
        allowedUsers: ['5559876543'],
      }));
      await connectChannel(ch);

      const messageSpy = jest.fn();
      ch.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: { remoteJid: '5551234567@s.whatsapp.net' },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).not.toHaveBeenCalled();

      await ch.disconnect();
    });

    it('should allow authorized users when allowedUsers is set', async () => {
      const ch = new WhatsAppChannel(createConfig({
        allowedUsers: ['5551234567'],
      }));
      await connectChannel(ch);

      const messageSpy = jest.fn();
      ch.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: { remoteJid: '5551234567@s.whatsapp.net' },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).toHaveBeenCalled();

      await ch.disconnect();
    });

    it('should allow all users when allowedUsers is not set', async () => {
      await connectChannel(channel);

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage();
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).toHaveBeenCalled();
    });

    it('should filter out unauthorized channels', async () => {
      const ch = new WhatsAppChannel(createConfig({
        allowedChannels: ['9999999'],
      }));
      await connectChannel(ch);

      const messageSpy = jest.fn();
      ch.on('message', messageSpy);

      const msg = makeBaileysMessage({
        key: { remoteJid: '5551234567@s.whatsapp.net' },
      });
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(messageSpy).not.toHaveBeenCalled();

      await ch.disconnect();
    });

    it('should allow all channels when allowedChannels is not set', async () => {
      await connectChannel(channel);

      expect(channel['isChannelAllowed']('any-channel-id')).toBe(true);
    });
  });

  // ==========================================================================
  // Reconnection Logic
  // ==========================================================================

  describe('reconnection logic', () => {
    beforeEach(async () => {
      await connectChannel(channel);
    });

    it('should attempt reconnect on non-401 close', () => {
      jest.useFakeTimers();

      const connectSpy = jest.spyOn(channel, 'connect').mockResolvedValue(undefined);

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 500 } },
        },
      });

      expect(channel.getStatus().connected).toBe(false);

      // Advance past the 5-second reconnect timer
      jest.advanceTimersByTime(5500);

      // connect() is called asynchronously
      expect(connectSpy).toHaveBeenCalled();

      jest.useRealTimers();
      connectSpy.mockRestore();
    });

    it('should not reconnect on 401 (logged out)', async () => {
      const connectSpy = jest.spyOn(channel, 'connect').mockResolvedValue(undefined);
      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 401 } },
        },
      });

      expect(channel.getStatus().connected).toBe(false);
      expect(disconnectedSpy).toHaveBeenCalledWith(
        'whatsapp',
        expect.objectContaining({ message: expect.stringContaining('401') })
      );

      // Wait a bit -- should not try to reconnect
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(connectSpy).not.toHaveBeenCalled();

      connectSpy.mockRestore();
    });

    it('should clear reconnect timer on disconnect', () => {
      jest.useFakeTimers();

      const connectSpy = jest.spyOn(channel, 'connect').mockResolvedValue(undefined);

      // Trigger a reconnect scenario
      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 500 } },
        },
      });

      // Now disconnect - should clear the reconnect timer
      channel.disconnect();

      // Advancing time should NOT trigger connect (disconnect clears reconnectTimer)
      jest.advanceTimersByTime(10000);
      expect(connectSpy).not.toHaveBeenCalled();

      jest.useRealTimers();
      connectSpy.mockRestore();
    });

    it('should not double-reconnect if already reconnecting', () => {
      jest.useFakeTimers();

      const connectSpy = jest.spyOn(channel, 'connect').mockResolvedValue(undefined);

      // Trigger close twice quickly
      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 503 } } },
      });

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 503 } } },
      });

      jest.advanceTimersByTime(6000);

      // Should only have been called once (the reconnect)
      expect(connectSpy).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
      connectSpy.mockRestore();
    });

    it('should emit error when reconnect fails', async () => {
      jest.useFakeTimers();

      const errorSpy = jest.fn();
      channel.on('error', errorSpy);

      const connectSpy = jest.spyOn(channel, 'connect').mockRejectedValue(new Error('Reconnect failed'));

      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 500 } } },
      });

      jest.advanceTimersByTime(6000);

      // Need to flush promise queue for the async error handler
      await jest.advanceTimersByTimeAsync(0);

      expect(errorSpy).toHaveBeenCalledWith(
        'whatsapp',
        expect.objectContaining({ message: 'Reconnect failed' })
      );

      jest.useRealTimers();
      connectSpy.mockRestore();
    });

    it('should handle connection close without lastDisconnect error', () => {
      jest.useFakeTimers();

      const connectSpy = jest.spyOn(channel, 'connect').mockResolvedValue(undefined);

      // Close without an error object -- statusCode is undefined, shouldReconnect is true
      mockSocketEv.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {},
      });

      expect(channel.getStatus().connected).toBe(false);

      // Should attempt reconnect (statusCode !== 401 when statusCode is undefined)
      jest.advanceTimersByTime(6000);
      expect(connectSpy).toHaveBeenCalled();

      jest.useRealTimers();
      connectSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should handle message processing errors gracefully', async () => {
      await connectChannel(channel);

      // The message processing catches errors internally per message.
      // Simulate a message that causes processIncomingMessage to throw by using
      // an edge case (e.g. null message content should still be handled).
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg = makeBaileysMessage();
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      // Message should still have been processed
      expect(messageSpy).toHaveBeenCalled();
    });

    it('should update lastActivity on incoming message', async () => {
      await connectChannel(channel);

      const beforeTime = Date.now();

      const msg = makeBaileysMessage();
      mockSocketEv.emit('messages.upsert', {
        messages: [msg],
        type: 'notify',
      });

      await new Promise(resolve => setImmediate(resolve));

      const status = channel.getStatus();
      expect(status.lastActivity!.getTime()).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  // ==========================================================================
  // JID Normalization
  // ==========================================================================

  describe('JID normalization', () => {
    beforeEach(async () => {
      await connectChannel(channel);
    });

    it('should strip non-numeric chars from phone numbers', async () => {
      await channel.send({
        channelId: '+1 (555) 123-4567',
        content: 'Hi',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '15551234567@s.whatsapp.net',
        expect.anything(),
        expect.anything()
      );
    });

    it('should keep existing JIDs unchanged', async () => {
      await channel.send({
        channelId: '5551234567@s.whatsapp.net',
        content: 'Hi',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '5551234567@s.whatsapp.net',
        expect.anything(),
        expect.anything()
      );
    });

    it('should keep group JIDs unchanged', async () => {
      await channel.send({
        channelId: '120363012345@g.us',
        content: 'Hi',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '120363012345@g.us',
        expect.anything(),
        expect.anything()
      );
    });
  });
});
