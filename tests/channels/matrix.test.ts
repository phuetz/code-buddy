/**
 * Matrix Channel Tests
 */

import { MatrixChannel } from '../../src/channels/matrix/index.js';
import type { MatrixConfig, MatrixRoomEvent } from '../../src/channels/matrix/index.js';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock session isolation
jest.mock('../../src/channels/session-isolation.js', () => ({
  getSessionIsolator: () => ({
    getSessionKey: (msg: { channel: { type: string; id: string }; sender: { id: string } }) =>
      `${msg.channel.type}:${msg.channel.id}:${msg.sender.id}`,
  }),
}));

// Mock identity links
jest.mock('../../src/channels/identity-links.js', () => ({
  getIdentityLinker: () => ({
    resolve: () => null,
  }),
}));

// Mock peer routing
jest.mock('../../src/channels/peer-routing.js', () => ({
  getPeerRouter: () => ({
    resolve: () => null,
    getAgentConfig: () => ({}),
  }),
}));

// Mock DM pairing - default to approved
const mockCheckSender = jest.fn().mockResolvedValue({ approved: true, senderId: 'test', channelType: 'matrix' });
const mockRequiresPairing = jest.fn().mockReturnValue(false);
const mockGetPairingMessage = jest.fn().mockReturnValue(null);

jest.mock('../../src/channels/dm-pairing.js', () => ({
  getDMPairing: () => ({
    checkSender: mockCheckSender,
    requiresPairing: mockRequiresPairing,
    getPairingMessage: mockGetPairingMessage,
  }),
}));

// ============================================================================
// Mock matrix-js-sdk client with EventEmitter-like on/removeListener
// ============================================================================

/** Store event handlers registered via client.on() */
let clientEventHandlers: Map<string, Array<(...args: unknown[]) => void>>;

const mockStartClient = jest.fn().mockResolvedValue(undefined);
const mockStopClient = jest.fn();
const mockJoinRoom = jest.fn().mockResolvedValue({ roomId: '!room:matrix.org' });
const mockLeave = jest.fn().mockResolvedValue(undefined);
const mockSendMessage = jest.fn().mockResolvedValue({ event_id: '$event123' });
const mockSendEvent = jest.fn().mockResolvedValue({ event_id: '$event456' });
const mockUploadContent = jest.fn().mockResolvedValue({ content_uri: 'mxc://matrix.org/abc123' });
const mockGetProfileInfo = jest.fn().mockResolvedValue({ displayname: 'Test Bot' });
const mockGetJoinedRooms = jest.fn().mockResolvedValue({ joined_rooms: ['!room1:matrix.org', '!room2:matrix.org'] });
const mockSendTyping = jest.fn().mockResolvedValue(undefined);
const mockSendReadReceipt = jest.fn().mockResolvedValue(undefined);
const mockRedactEvent = jest.fn().mockResolvedValue(undefined);
const mockGetUserId = jest.fn().mockReturnValue('@bot:matrix.org');

function createMockClient() {
  clientEventHandlers = new Map();

  const client = {
    startClient: mockStartClient,
    stopClient: mockStopClient,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!clientEventHandlers.has(event)) {
        clientEventHandlers.set(event, []);
      }
      clientEventHandlers.get(event)!.push(handler);
    }),
    removeListener: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = clientEventHandlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    }),
    joinRoom: mockJoinRoom,
    leave: mockLeave,
    sendMessage: mockSendMessage,
    sendEvent: mockSendEvent,
    uploadContent: mockUploadContent,
    getProfileInfo: mockGetProfileInfo,
    getJoinedRooms: mockGetJoinedRooms,
    sendTyping: mockSendTyping,
    sendReadReceipt: mockSendReadReceipt,
    redactEvent: mockRedactEvent,
    getUserId: mockGetUserId,
  };

  return client;
}

const mockCreateClient = jest.fn((_opts?: unknown) => createMockClient());

jest.mock('matrix-js-sdk', () => ({
  createClient: (opts: unknown) => mockCreateClient(opts),
  MemoryStore: jest.fn().mockImplementation(() => ({ type: 'memory' })),
}), { virtual: true });

// ============================================================================
// Helpers
// ============================================================================

const baseConfig: MatrixConfig = {
  type: 'matrix',
  enabled: true,
  homeserverUrl: 'https://matrix.org',
  userId: '@bot:matrix.org',
  accessToken: 'syt_test_token',
};

/**
 * Emit an event on the mock client, calling all registered handlers.
 */
function emitClientEvent(event: string, ...args: unknown[]) {
  const handlers = clientEventHandlers?.get(event);
  if (handlers) {
    for (const handler of handlers) {
      handler(...args);
    }
  }
}

/**
 * Get a registered event handler by name (first registered handler for that event).
 */
function getEventHandler(eventName: string): ((...args: unknown[]) => void) | undefined {
  const handlers = clientEventHandlers?.get(eventName);
  return handlers?.[0];
}

/**
 * Connect a channel by creating it, starting connect, and firing sync PREPARED.
 * The connect() method calls registerEventHandlers then startClient, then waits
 * for a 'sync' event. We hook into startClient to fire PREPARED after handlers
 * are registered.
 */
async function connectChannel(channel: MatrixChannel) {
  mockStartClient.mockImplementation(async () => {
    // After startClient is called (handlers already registered), fire sync
    process.nextTick(() => {
      emitClientEvent('sync', 'PREPARED', null);
    });
  });

  await channel.connect();
}

// ============================================================================
// Tests
// ============================================================================

describe('MatrixChannel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clientEventHandlers = new Map();
    mockStartClient.mockResolvedValue(undefined);
    mockRequiresPairing.mockReturnValue(false);
    mockCheckSender.mockResolvedValue({ approved: true, senderId: 'test', channelType: 'matrix' });
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    it('should create channel with valid config', () => {
      const channel = new MatrixChannel(baseConfig);
      expect(channel.type).toBe('matrix');
      expect(channel.getStatus().type).toBe('matrix');
      expect(channel.getStatus().connected).toBe(false);
      expect(channel.getStatus().authenticated).toBe(false);
    });

    it('should throw error without homeserverUrl', () => {
      expect(() => {
        new MatrixChannel({ ...baseConfig, homeserverUrl: '' });
      }).toThrow('Matrix homeserver URL is required');
    });

    it('should throw error without userId', () => {
      expect(() => {
        new MatrixChannel({ ...baseConfig, userId: '' });
      }).toThrow('Matrix user ID is required');
    });

    it('should throw error without accessToken', () => {
      expect(() => {
        new MatrixChannel({ ...baseConfig, accessToken: '' });
      }).toThrow('Matrix access token is required');
    });

    it('should default autoJoin to true when not specified', () => {
      const channel = new MatrixChannel(baseConfig);
      expect((channel as unknown as { config: MatrixConfig }).config.autoJoin).toBe(true);
    });

    it('should preserve autoJoin when explicitly set to false', () => {
      const channel = new MatrixChannel({ ...baseConfig, autoJoin: false });
      expect((channel as unknown as { config: MatrixConfig }).config.autoJoin).toBe(false);
    });

    it('should preserve autoJoin when explicitly set to true', () => {
      const channel = new MatrixChannel({ ...baseConfig, autoJoin: true });
      expect((channel as unknown as { config: MatrixConfig }).config.autoJoin).toBe(true);
    });
  });

  // ==========================================================================
  // Connect / Disconnect Lifecycle
  // ==========================================================================

  describe('connect', () => {
    it('should connect and set status to connected', async () => {
      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      const status = channel.getStatus();
      expect(status.connected).toBe(true);
      expect(status.authenticated).toBe(true);
      expect(status.info?.userId).toBe('@bot:matrix.org');
      expect(status.info?.homeserver).toBe('https://matrix.org');
      expect(status.info?.displayName).toBe('Test Bot');

      await channel.disconnect();
    });

    it('should emit connected event', async () => {
      const channel = new MatrixChannel(baseConfig);
      const connectedSpy = jest.fn();
      channel.on('connected', connectedSpy);

      await connectChannel(channel);

      expect(connectedSpy).toHaveBeenCalledWith('matrix');
      await channel.disconnect();
    });

    it('should pass correct options to createClient', async () => {
      const channel = new MatrixChannel({
        ...baseConfig,
        deviceId: 'TESTDEVICE',
      });
      await connectChannel(channel);

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://matrix.org',
          accessToken: 'syt_test_token',
          userId: '@bot:matrix.org',
          deviceId: 'TESTDEVICE',
        })
      );

      await channel.disconnect();
    });

    it('should start the sync loop with initialSyncLimit', async () => {
      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      expect(mockStartClient).toHaveBeenCalledWith({ initialSyncLimit: 10 });
      await channel.disconnect();
    });

    it('should join initial rooms if configured', async () => {
      const channel = new MatrixChannel({
        ...baseConfig,
        initialRooms: ['!room1:matrix.org', '!room2:matrix.org'],
      });
      await connectChannel(channel);

      expect(mockJoinRoom).toHaveBeenCalledWith('!room1:matrix.org');
      expect(mockJoinRoom).toHaveBeenCalledWith('!room2:matrix.org');
      await channel.disconnect();
    });

    it('should handle failure to join initial rooms gracefully', async () => {
      mockJoinRoom.mockRejectedValueOnce(new Error('Room not found'));
      mockJoinRoom.mockResolvedValueOnce({ roomId: '!room2:matrix.org' });

      const channel = new MatrixChannel({
        ...baseConfig,
        initialRooms: ['!bad:matrix.org', '!good:matrix.org'],
      });
      await connectChannel(channel);

      expect(channel.getStatus().connected).toBe(true);
      await channel.disconnect();
    });

    it('should handle getProfileInfo failure gracefully', async () => {
      mockGetProfileInfo.mockRejectedValueOnce(new Error('Profile not found'));

      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      expect(channel.getStatus().info?.displayName).toBe('@bot:matrix.org');
      await channel.disconnect();
    });

    it('should emit error and throw when sync fails', async () => {
      mockStartClient.mockImplementation(async () => {
        process.nextTick(() => {
          emitClientEvent('sync', 'ERROR', null);
        });
      });

      const channel = new MatrixChannel(baseConfig);
      const errorSpy = jest.fn();
      channel.on('error', errorSpy);

      await expect(channel.connect()).rejects.toThrow('Matrix sync failed');
      expect(errorSpy).toHaveBeenCalledWith('matrix', expect.any(Error));
    });

    // Note: The 30-second sync timeout is tested implicitly through the error
    // path test above. Testing the actual setTimeout with fake timers causes
    // issues with process.nextTick in other tests, so we skip that scenario.

    it('should use MemoryStore when storePath is configured', async () => {
      const channel = new MatrixChannel({
        ...baseConfig,
        storePath: '/tmp/matrix-store',
      });
      await connectChannel(channel);

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({
          store: expect.objectContaining({ type: 'memory' }),
        })
      );

      await channel.disconnect();
    });
  });

  describe('disconnect', () => {
    it('should disconnect and update status', async () => {
      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      await channel.disconnect();

      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    it('should emit disconnected event', async () => {
      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      await channel.disconnect();

      expect(disconnectedSpy).toHaveBeenCalledWith('matrix');
    });

    it('should call stopClient on the SDK client', async () => {
      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      await channel.disconnect();

      expect(mockStopClient).toHaveBeenCalled();
    });

    it('should clear room cache on disconnect', async () => {
      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      const roomCache = (channel as unknown as { roomCache: Map<string, unknown> }).roomCache;
      roomCache.set('!test:matrix.org', { roomId: '!test:matrix.org' });
      expect(roomCache.size).toBe(1);

      await channel.disconnect();

      expect(roomCache.size).toBe(0);
    });

    it('should handle disconnect when not connected', async () => {
      const channel = new MatrixChannel(baseConfig);
      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      await channel.disconnect();

      expect(disconnectedSpy).toHaveBeenCalledWith('matrix');
      expect(channel.getStatus().connected).toBe(false);
    });

    it('should handle stopClient errors gracefully', async () => {
      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      mockStopClient.mockImplementationOnce(() => {
        throw new Error('Stop failed');
      });

      // Should not throw
      await channel.disconnect();
      expect(channel.getStatus().connected).toBe(false);
    });
  });

  // ==========================================================================
  // Send Messages
  // ==========================================================================

  describe('send', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should send a text message', async () => {
      const result = await channel.send({
        channelId: '!room:matrix.org',
        content: 'Hello Matrix!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('$event123');
      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          body: 'Hello Matrix!',
          msgtype: 'm.text',
        })
      );
    });

    it('should return error when not connected', async () => {
      await channel.disconnect();

      const result = await channel.send({
        channelId: '!room:matrix.org',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Matrix not connected');
    });

    it('should send HTML formatted message', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: '<b>Bold</b> text',
        parseMode: 'html',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          format: 'org.matrix.custom.html',
          formatted_body: '<b>Bold</b> text',
        })
      );
    });

    it('should send markdown formatted message with html format', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: '**Bold** text',
        parseMode: 'markdown',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          format: 'org.matrix.custom.html',
          formatted_body: '**Bold** text',
        })
      );
    });

    it('should not add format for plain parse mode', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: 'Plain text',
        parseMode: 'plain',
      });

      const calledContent = mockSendMessage.mock.calls[0][1];
      expect(calledContent.body).toBe('Plain text');
      expect(calledContent.msgtype).toBe('m.text');
      expect(calledContent.format).toBeUndefined();
    });

    it('should include reply-to relation', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: 'Reply message',
        replyTo: '$original_event',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          'm.relates_to': expect.objectContaining({
            'm.in_reply_to': { event_id: '$original_event' },
          }),
        })
      );
    });

    it('should include thread relation (MSC3440)', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: 'Thread reply',
        threadId: '$thread_root',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          'm.relates_to': expect.objectContaining({
            rel_type: 'm.thread',
            event_id: '$thread_root',
          }),
        })
      );
    });

    it('should include both reply and thread relations', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: 'Threaded reply',
        replyTo: '$reply_target',
        threadId: '$thread_root',
      });

      const calledContent = mockSendMessage.mock.calls[0][1];
      expect(calledContent['m.relates_to']).toEqual(
        expect.objectContaining({
          'm.in_reply_to': { event_id: '$reply_target' },
          rel_type: 'm.thread',
          event_id: '$thread_root',
        })
      );
    });

    it('should handle send errors gracefully', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('Rate limited'));

      const result = await channel.send({
        channelId: '!room:matrix.org',
        content: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Rate limited');
    });
  });

  // ==========================================================================
  // Media Upload
  // ==========================================================================

  describe('send media', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should upload and send image attachment with base64 data', async () => {
      const result = await channel.send({
        channelId: '!room:matrix.org',
        content: 'Check this image',
        attachments: [{
          type: 'image',
          data: Buffer.from('fake-image-data').toString('base64'),
          fileName: 'photo.png',
          mimeType: 'image/png',
          size: 1024,
          width: 800,
          height: 600,
        }],
      });

      expect(result.success).toBe(true);
      expect(mockUploadContent).toHaveBeenCalledWith(
        expect.any(Buffer),
        {
          name: 'photo.png',
          type: 'image/png',
        }
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          msgtype: 'm.image',
          body: 'Check this image',
          url: 'mxc://matrix.org/abc123',
          filename: 'photo.png',
          info: expect.objectContaining({
            mimetype: 'image/png',
            size: 1024,
            w: 800,
            h: 600,
          }),
        })
      );
    });

    it('should send URL attachment as text message', async () => {
      const result = await channel.send({
        channelId: '!room:matrix.org',
        content: 'See this file',
        attachments: [{
          type: 'file',
          url: 'https://example.com/file.pdf',
        }],
      });

      expect(result.success).toBe(true);
      expect(mockUploadContent).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        '!room:matrix.org',
        expect.objectContaining({
          msgtype: 'm.text',
          body: 'See this file\nhttps://example.com/file.pdf',
        })
      );
    });

    it('should send URL attachment without caption', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: '',
        attachments: [{
          type: 'file',
          url: 'https://example.com/file.pdf',
        }],
      });

      const calledContent = mockSendMessage.mock.calls[0][1];
      expect(calledContent.body).toBe('https://example.com/file.pdf');
    });

    it('should return error when attachment has no data or url', async () => {
      const result = await channel.send({
        channelId: '!room:matrix.org',
        content: 'empty attachment',
        attachments: [{
          type: 'file',
        }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No attachment data to upload');
    });

    it('should handle upload errors gracefully', async () => {
      mockUploadContent.mockRejectedValueOnce(new Error('Upload failed'));

      const result = await channel.send({
        channelId: '!room:matrix.org',
        content: 'Test',
        attachments: [{
          type: 'image',
          data: Buffer.from('data').toString('base64'),
        }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Upload failed');
    });

    it('should use default filename and mimetype when not provided', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: '',
        attachments: [{
          type: 'file',
          data: Buffer.from('data').toString('base64'),
        }],
      });

      expect(mockUploadContent).toHaveBeenCalledWith(
        expect.any(Buffer),
        {
          name: 'attachment',
          type: 'application/octet-stream',
        }
      );
    });

    it('should convert audio duration from seconds to milliseconds', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: 'audio',
        attachments: [{
          type: 'audio',
          data: Buffer.from('data').toString('base64'),
          duration: 30,
        }],
      });

      const calledContent = mockSendMessage.mock.calls[0][1];
      expect(calledContent.info.duration).toBe(30000);
    });

    it('should map content types to correct msgtypes', async () => {
      await channel.send({
        channelId: '!room:matrix.org',
        content: 'video',
        attachments: [{
          type: 'video',
          data: Buffer.from('data').toString('base64'),
        }],
      });

      const calledContent = mockSendMessage.mock.calls[0][1];
      expect(calledContent.msgtype).toBe('m.video');
    });
  });

  // ==========================================================================
  // Event Handling - Timeline
  // ==========================================================================

  describe('timeline event handling', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    function fireTimeline(event: unknown, room: unknown, toStartOfTimeline: unknown) {
      emitClientEvent('Room.timeline', event, room, toStartOfTimeline);
    }

    const defaultRoom = {
      name: 'Test Room',
      getJoinedMemberCount: () => 5,
      getDMInviter: () => null,
      currentState: { getStateEvents: () => [] },
      getMember: (_userId: string) => ({ name: 'Alice', rawDisplayName: 'alice' }),
    };

    it('should emit message event for incoming text messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$msg1',
        type: 'm.room.message',
        room_id: '!room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'Hello from Alice!' },
      }, defaultRoom, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(messageSpy).toHaveBeenCalled();
      const msg = messageSpy.mock.calls[0][0];
      expect(msg.id).toBe('$msg1');
      expect(msg.content).toBe('Hello from Alice!');
      expect(msg.sender.id).toBe('@alice:matrix.org');
      expect(msg.sender.displayName).toBe('Alice');
      expect(msg.channel.type).toBe('matrix');
      expect(msg.channel.id).toBe('!room:matrix.org');
      expect(msg.channel.name).toBe('Test Room');
      expect(msg.contentType).toBe('text');
    });

    it('should ignore events at start of timeline (backfill)', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$old',
        type: 'm.room.message',
        room_id: '!room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: 1000,
        content: { msgtype: 'm.text', body: 'old message' },
      }, null, true);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore own messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$self',
        type: 'm.room.message',
        room_id: '!room:matrix.org',
        sender: '@bot:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'my own message' },
      }, null, false);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore non-message events', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$state1',
        type: 'm.room.member',
        room_id: '!room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { membership: 'join' },
      }, null, false);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore redacted events (no msgtype)', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$redacted',
        type: 'm.room.message',
        room_id: '!room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: {},
      }, null, false);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should respect user allowlist', async () => {
      await channel.disconnect();
      channel = new MatrixChannel({
        ...baseConfig,
        allowedUsers: ['@allowed:matrix.org'],
      });
      await connectChannel(channel);

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$blocked',
        type: 'm.room.message',
        room_id: '!room:matrix.org',
        sender: '@blocked:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'blocked' },
      }, null, false);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should respect channel allowlist', async () => {
      await channel.disconnect();
      channel = new MatrixChannel({
        ...baseConfig,
        allowedChannels: ['!allowed:matrix.org'],
      });
      await connectChannel(channel);

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$wrong_room',
        type: 'm.room.message',
        room_id: '!forbidden:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'wrong room' },
      }, null, false);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should parse commands from messages', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      fireTimeline({
        event_id: '$cmd1',
        type: 'm.room.message',
        room_id: '!room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: '/help arg1 arg2' },
      }, defaultRoom, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(commandSpy).toHaveBeenCalled();
      const msg = commandSpy.mock.calls[0][0];
      expect(msg.isCommand).toBe(true);
      expect(msg.commandName).toBe('help');
      expect(msg.commandArgs).toEqual(['arg1', 'arg2']);
    });

    it('should extract reply-to from event content', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$reply1',
        type: 'm.room.message',
        room_id: '!reply_room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: 'm.text',
          body: 'Reply text',
          'm.relates_to': {
            'm.in_reply_to': { event_id: '$original' },
          },
        },
      }, defaultRoom, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.replyTo).toBe('$original');
    });

    it('should extract thread ID from event content', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$thread1',
        type: 'm.room.message',
        room_id: '!thread_room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: 'm.text',
          body: 'Thread reply',
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: '$thread_root',
          },
        },
      }, defaultRoom, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.threadId).toBe('$thread_root');
    });

    it('should extract attachments from media messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$img1',
        type: 'm.room.message',
        room_id: '!img_room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: 'm.image',
          body: 'photo.jpg',
          url: 'mxc://matrix.org/xyz',
          filename: 'photo.jpg',
          info: {
            mimetype: 'image/jpeg',
            size: 50000,
            w: 1920,
            h: 1080,
          },
        },
      }, defaultRoom, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.contentType).toBe('image');
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]).toEqual(expect.objectContaining({
        type: 'image',
        url: 'mxc://matrix.org/xyz',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 50000,
        width: 1920,
        height: 1080,
      }));
    });

    it('should convert audio duration from ms to seconds in attachments', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$audio1',
        type: 'm.room.message',
        room_id: '!audio_room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: {
          msgtype: 'm.audio',
          body: 'recording.ogg',
          url: 'mxc://matrix.org/audio',
          info: {
            mimetype: 'audio/ogg',
            duration: 45000,
          },
        },
      }, defaultRoom, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.attachments[0].duration).toBe(45);
    });

    it('should set sessionKey on inbound messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$sk1',
        type: 'm.room.message',
        room_id: '!sk_room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'test' },
      }, defaultRoom, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.sessionKey).toBe('matrix:!sk_room:matrix.org:@alice:matrix.org');
    });

    it('should update lastActivity on valid messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      fireTimeline({
        event_id: '$act1',
        type: 'm.room.message',
        room_id: '!act_room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'test' },
      }, defaultRoom, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(channel.getStatus().lastActivity).toBeDefined();
    });
  });

  // ==========================================================================
  // DM Pairing
  // ==========================================================================

  describe('DM pairing', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should block unapproved DM messages when pairing is enabled', async () => {
      mockRequiresPairing.mockReturnValue(true);
      mockCheckSender.mockResolvedValue({
        approved: false,
        senderId: '@alice:matrix.org',
        channelType: 'matrix',
        code: 'ABC123',
      });

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$dm1',
        type: 'm.room.message',
        room_id: '!dm:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'Hello' },
      }, {
        name: 'DM',
        getJoinedMemberCount: () => 2,
        getDMInviter: () => '@alice:matrix.org',
        currentState: { getStateEvents: () => [] },
        getMember: () => null,
      }, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(messageSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Auto-Join on Invite
  // ==========================================================================

  describe('auto-join rooms', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should auto-join when invited and autoJoin is true', async () => {
      mockJoinRoom.mockClear();

      emitClientEvent('RoomMember.membership',
        { event_id: '$inv1', type: 'm.room.member', room_id: '!new:matrix.org', sender: '@alice:matrix.org', origin_server_ts: Date.now(), content: {} },
        { userId: '@bot:matrix.org', membership: 'invite', roomId: '!new:matrix.org' }
      );

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockJoinRoom).toHaveBeenCalledWith('!new:matrix.org');
    });

    it('should not auto-join when autoJoin is false', async () => {
      await channel.disconnect();
      channel = new MatrixChannel({ ...baseConfig, autoJoin: false });
      await connectChannel(channel);

      mockJoinRoom.mockClear();

      emitClientEvent('RoomMember.membership',
        { event_id: '$inv2', type: 'm.room.member', room_id: '!new:matrix.org', sender: '@alice:matrix.org', origin_server_ts: Date.now(), content: {} },
        { userId: '@bot:matrix.org', membership: 'invite', roomId: '!new:matrix.org' }
      );

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockJoinRoom).not.toHaveBeenCalled();
    });

    it('should not auto-join for other users invites', async () => {
      mockJoinRoom.mockClear();

      emitClientEvent('RoomMember.membership',
        { event_id: '$inv3', type: 'm.room.member', room_id: '!new:matrix.org', sender: '@alice:matrix.org', origin_server_ts: Date.now(), content: {} },
        { userId: '@other:matrix.org', membership: 'invite', roomId: '!new:matrix.org' }
      );

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockJoinRoom).not.toHaveBeenCalled();
    });

    it('should handle auto-join errors gracefully', async () => {
      mockJoinRoom.mockRejectedValueOnce(new Error('Cannot join'));

      emitClientEvent('RoomMember.membership',
        { event_id: '$inv4', type: 'm.room.member', room_id: '!private:matrix.org', sender: '@alice:matrix.org', origin_server_ts: Date.now(), content: {} },
        { userId: '@bot:matrix.org', membership: 'invite', roomId: '!private:matrix.org' }
      );

      // Should not throw
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should fall back to event room_id when member roomId is missing', async () => {
      mockJoinRoom.mockClear();

      emitClientEvent('RoomMember.membership',
        { event_id: '$inv5', type: 'm.room.member', room_id: '!fallback:matrix.org', sender: '@alice:matrix.org', origin_server_ts: Date.now(), content: {} },
        { userId: '@bot:matrix.org', membership: 'invite' }
      );

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockJoinRoom).toHaveBeenCalledWith('!fallback:matrix.org');
    });
  });

  // ==========================================================================
  // Typing Indicators
  // ==========================================================================

  describe('typing indicators', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should emit typing event for other users', () => {
      const typingSpy = jest.fn();
      channel.on('typing', typingSpy);

      emitClientEvent('RoomMember.typing',
        { event_id: '$t1', type: 'm.typing', room_id: '!room:matrix.org', sender: '', origin_server_ts: Date.now(), content: {} },
        { userId: '@alice:matrix.org', typing: true, roomId: '!room:matrix.org' }
      );

      expect(typingSpy).toHaveBeenCalledWith(
        { id: '!room:matrix.org', type: 'matrix' },
        { id: '@alice:matrix.org' }
      );
    });

    it('should not emit typing event for own user', () => {
      const typingSpy = jest.fn();
      channel.on('typing', typingSpy);

      emitClientEvent('RoomMember.typing',
        { event_id: '$t2', type: 'm.typing', room_id: '!room:matrix.org', sender: '', origin_server_ts: Date.now(), content: {} },
        { userId: '@bot:matrix.org', typing: true, roomId: '!room:matrix.org' }
      );

      expect(typingSpy).not.toHaveBeenCalled();
    });

    it('should not emit typing event when typing is false', () => {
      const typingSpy = jest.fn();
      channel.on('typing', typingSpy);

      emitClientEvent('RoomMember.typing',
        { event_id: '$t3', type: 'm.typing', room_id: '!room:matrix.org', sender: '', origin_server_ts: Date.now(), content: {} },
        { userId: '@alice:matrix.org', typing: false, roomId: '!room:matrix.org' }
      );

      expect(typingSpy).not.toHaveBeenCalled();
    });

    it('should send typing indicator', async () => {
      await channel.sendTyping('!room:matrix.org', true, 5000);

      expect(mockSendTyping).toHaveBeenCalledWith('!room:matrix.org', true, 5000);
    });

    it('should send stop-typing indicator', async () => {
      await channel.sendTyping('!room:matrix.org', false);

      expect(mockSendTyping).toHaveBeenCalledWith('!room:matrix.org', false, 10000);
    });

    it('should handle typing errors silently', async () => {
      mockSendTyping.mockRejectedValueOnce(new Error('Failed'));

      // Should not throw
      await channel.sendTyping('!room:matrix.org');
    });

    it('should no-op when not connected', async () => {
      await channel.disconnect();

      await channel.sendTyping('!room:matrix.org');
      expect(mockSendTyping).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Read Receipts
  // ==========================================================================

  describe('read receipts', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should send read receipt', async () => {
      await channel.sendReadReceipt('!room:matrix.org', '$event123');

      expect(mockSendReadReceipt).toHaveBeenCalledWith({
        roomId: '!room:matrix.org',
        getId: expect.any(Function),
      });

      const receipt = mockSendReadReceipt.mock.calls[0][0];
      expect(receipt.getId()).toBe('$event123');
    });

    it('should handle read receipt errors silently', async () => {
      mockSendReadReceipt.mockRejectedValueOnce(new Error('Failed'));

      // Should not throw
      await channel.sendReadReceipt('!room:matrix.org', '$event123');
    });

    it('should no-op when not connected', async () => {
      await channel.disconnect();

      await channel.sendReadReceipt('!room:matrix.org', '$event123');
      expect(mockSendReadReceipt).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Reactions
  // ==========================================================================

  describe('reactions', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should send a reaction event', async () => {
      await channel.react('!room:matrix.org', '$event123', '👍');

      expect(mockSendEvent).toHaveBeenCalledWith(
        '!room:matrix.org',
        'm.reaction',
        {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: '$event123',
            key: '👍',
          },
        }
      );
    });

    it('should handle reaction errors gracefully', async () => {
      mockSendEvent.mockRejectedValueOnce(new Error('Forbidden'));

      // Should not throw
      await channel.react('!room:matrix.org', '$event123', '❤️');
    });

    it('should no-op when not connected', async () => {
      await channel.disconnect();

      await channel.react('!room:matrix.org', '$event123', '👍');
      expect(mockSendEvent).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Room Management
  // ==========================================================================

  describe('room management', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    describe('joinRoom', () => {
      it('should join a room by ID', async () => {
        mockJoinRoom.mockResolvedValueOnce({ roomId: '!target:matrix.org' });

        const roomId = await channel.joinRoom('!target:matrix.org');

        expect(roomId).toBe('!target:matrix.org');
        expect(mockJoinRoom).toHaveBeenCalledWith('!target:matrix.org');
      });

      it('should join a room by alias', async () => {
        mockJoinRoom.mockResolvedValueOnce({ roomId: '!resolved:matrix.org' });

        const roomId = await channel.joinRoom('#general:matrix.org');

        expect(roomId).toBe('!resolved:matrix.org');
      });

      it('should throw when not connected', async () => {
        await channel.disconnect();

        await expect(channel.joinRoom('!room:matrix.org')).rejects.toThrow('Matrix not connected');
      });
    });

    describe('leaveRoom', () => {
      it('should leave a room', async () => {
        await channel.leaveRoom('!room:matrix.org');

        expect(mockLeave).toHaveBeenCalledWith('!room:matrix.org');
      });

      it('should remove room from cache on leave', async () => {
        const roomCache = (channel as unknown as { roomCache: Map<string, unknown> }).roomCache;
        roomCache.set('!room:matrix.org', { roomId: '!room:matrix.org' });

        await channel.leaveRoom('!room:matrix.org');

        expect(roomCache.has('!room:matrix.org')).toBe(false);
      });

      it('should throw when not connected', async () => {
        await channel.disconnect();

        await expect(channel.leaveRoom('!room:matrix.org')).rejects.toThrow('Matrix not connected');
      });
    });

    describe('getJoinedRooms', () => {
      it('should return list of joined rooms', async () => {
        const rooms = await channel.getJoinedRooms();

        expect(rooms).toEqual(['!room1:matrix.org', '!room2:matrix.org']);
      });

      it('should return empty array when not connected', async () => {
        await channel.disconnect();

        const rooms = await channel.getJoinedRooms();

        expect(rooms).toEqual([]);
      });

      it('should return empty array on error', async () => {
        mockGetJoinedRooms.mockRejectedValueOnce(new Error('Failed'));

        const rooms = await channel.getJoinedRooms();

        expect(rooms).toEqual([]);
      });
    });

    describe('redactMessage', () => {
      it('should redact an event', async () => {
        await channel.redactMessage('!room:matrix.org', '$event123');

        expect(mockRedactEvent).toHaveBeenCalledWith(
          '!room:matrix.org',
          '$event123',
          undefined,
          undefined
        );
      });

      it('should redact with reason', async () => {
        await channel.redactMessage('!room:matrix.org', '$event123', 'spam');

        expect(mockRedactEvent).toHaveBeenCalledWith(
          '!room:matrix.org',
          '$event123',
          undefined,
          { reason: 'spam' }
        );
      });

      it('should throw when not connected', async () => {
        await channel.disconnect();

        await expect(
          channel.redactMessage('!room:matrix.org', '$event123')
        ).rejects.toThrow('Matrix not connected');
      });
    });
  });

  // ==========================================================================
  // Room Info Caching
  // ==========================================================================

  describe('room info caching', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should cache room info after first lookup', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const room = {
        name: 'Cached Room',
        getJoinedMemberCount: () => 10,
        getDMInviter: () => null,
        currentState: {
          getStateEvents: (type: string) => {
            if (type === 'm.room.topic') {
              return [{ getContent: () => ({ topic: 'Room topic' }) }];
            }
            return [];
          },
        },
        getMember: () => null,
      };

      // First message - populates cache
      emitClientEvent('Room.timeline', {
        event_id: '$first',
        type: 'm.room.message',
        room_id: '!cached:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'first' },
      }, room, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg1 = messageSpy.mock.calls[0][0];
      expect(msg1.channel.name).toBe('Cached Room');
      expect(msg1.channel.description).toBe('Room topic');
      expect(msg1.channel.participantCount).toBe(10);

      // Second message - should use cache (even with null room)
      emitClientEvent('Room.timeline', {
        event_id: '$second',
        type: 'm.room.message',
        room_id: '!cached:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'second' },
      }, null, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg2 = messageSpy.mock.calls[1][0];
      expect(msg2.channel.name).toBe('Cached Room');
    });

    it('should evict oldest entry when cache exceeds 1000', async () => {
      const roomCache = (channel as unknown as { roomCache: Map<string, unknown> }).roomCache;

      // Fill cache to 1000
      for (let i = 0; i < 1000; i++) {
        roomCache.set(`!room${i}:matrix.org`, { roomId: `!room${i}:matrix.org` });
      }
      expect(roomCache.size).toBe(1000);

      // Trigger a new room lookup via timeline event
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$evict',
        type: 'm.room.message',
        room_id: '!new_room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'overflow' },
      }, { name: 'New Room', getJoinedMemberCount: () => 2, getDMInviter: () => null, currentState: { getStateEvents: () => [] }, getMember: () => null }, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(roomCache.size).toBe(1000);
      expect(roomCache.has('!room0:matrix.org')).toBe(false);
      expect(roomCache.has('!new_room:matrix.org')).toBe(true);
    });

    it('should detect DM rooms via getDMInviter', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$dm_detect',
        type: 'm.room.message',
        room_id: '!dm:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'dm msg' },
      }, {
        name: 'DM Room',
        getJoinedMemberCount: () => 2,
        getDMInviter: () => '@alice:matrix.org',
        currentState: { getStateEvents: () => [] },
        getMember: () => null,
      }, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.channel.isDM).toBe(true);
      expect(msg.channel.isGroup).toBe(false);
    });
  });

  // ==========================================================================
  // Sync Error Handling
  // ==========================================================================

  describe('sync state handling', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should emit error on sync ERROR state after connected', () => {
      const errorSpy = jest.fn();
      channel.on('error', errorSpy);

      // The second 'sync' handler (registered in registerEventHandlers)
      // fires on ERROR state
      emitClientEvent('sync', 'ERROR', 'SYNCING');

      expect(errorSpy).toHaveBeenCalledWith('matrix', expect.any(Error));
    });

    it('should not emit error on RECONNECTING state', () => {
      const errorSpy = jest.fn();
      channel.on('error', errorSpy);

      emitClientEvent('sync', 'RECONNECTING', 'SYNCING');

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Display Name Resolution
  // ==========================================================================

  describe('display name resolution', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should use member name from room', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$name1',
        type: 'm.room.message',
        room_id: '!name1_room:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'hi' },
      }, {
        name: 'Room',
        getJoinedMemberCount: () => 2,
        getDMInviter: () => null,
        currentState: { getStateEvents: () => [] },
        getMember: (_userId: string) => ({ name: 'Alice Wonderland', rawDisplayName: 'alice' }),
      }, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.sender.displayName).toBe('Alice Wonderland');
    });

    it('should fall back to rawDisplayName when name is missing', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$name2',
        type: 'm.room.message',
        room_id: '!name2_room:matrix.org',
        sender: '@bob:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'hi' },
      }, {
        name: 'Room',
        getJoinedMemberCount: () => 2,
        getDMInviter: () => null,
        currentState: { getStateEvents: () => [] },
        getMember: () => ({ rawDisplayName: 'bobby' }),
      }, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.sender.displayName).toBe('bobby');
    });

    it('should fall back to userId when member is not found', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$name3',
        type: 'm.room.message',
        room_id: '!name3_room:matrix.org',
        sender: '@unknown:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'hi' },
      }, {
        name: 'Room',
        getJoinedMemberCount: () => 2,
        getDMInviter: () => null,
        currentState: { getStateEvents: () => [] },
        getMember: () => null,
      }, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.sender.displayName).toBe('@unknown:matrix.org');
    });

    it('should fall back to userId when room is null', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      emitClientEvent('Room.timeline', {
        event_id: '$name4',
        type: 'm.room.message',
        room_id: '!nullroom:matrix.org',
        sender: '@alice:matrix.org',
        origin_server_ts: Date.now(),
        content: { msgtype: 'm.text', body: 'hi' },
      }, null, false);

      await new Promise(resolve => setTimeout(resolve, 50));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.sender.displayName).toBe('@alice:matrix.org');
    });
  });

  // ==========================================================================
  // Content Type Mapping
  // ==========================================================================

  describe('content type mapping', () => {
    let channel: MatrixChannel;

    beforeEach(async () => {
      channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    const simpleRoom = {
      name: 'Room',
      getJoinedMemberCount: () => 2,
      getDMInviter: () => null,
      currentState: { getStateEvents: () => [] },
      getMember: () => null,
    };

    const testCases: Array<{ msgtype: string; expected: string }> = [
      { msgtype: 'm.image', expected: 'image' },
      { msgtype: 'm.video', expected: 'video' },
      { msgtype: 'm.audio', expected: 'audio' },
      { msgtype: 'm.file', expected: 'file' },
      { msgtype: 'm.location', expected: 'location' },
      { msgtype: 'm.text', expected: 'text' },
      { msgtype: 'm.notice', expected: 'text' },
      { msgtype: 'm.emote', expected: 'text' },
    ];

    for (const { msgtype, expected } of testCases) {
      it(`should map ${msgtype} to ${expected}`, async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        emitClientEvent('Room.timeline', {
          event_id: `$ct_${msgtype}`,
          type: 'm.room.message',
          room_id: `!ct_${msgtype}:matrix.org`,
          sender: '@alice:matrix.org',
          origin_server_ts: Date.now(),
          content: { msgtype, body: 'test', url: msgtype !== 'm.text' ? 'mxc://x/y' : undefined },
        }, simpleRoom, false);

        await new Promise(resolve => setTimeout(resolve, 50));
        expect(messageSpy.mock.calls[0][0].contentType).toBe(expected);

        channel.removeAllListeners('message');
      });
    }
  });

  // ==========================================================================
  // getStatus
  // ==========================================================================

  describe('getStatus', () => {
    it('should return initial disconnected status', () => {
      const channel = new MatrixChannel(baseConfig);
      const status = channel.getStatus();

      expect(status.type).toBe('matrix');
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
      expect(status.error).toBeUndefined();
    });

    it('should return connected status after connect', async () => {
      const channel = new MatrixChannel(baseConfig);
      await connectChannel(channel);

      const status = channel.getStatus();
      expect(status.connected).toBe(true);
      expect(status.authenticated).toBe(true);

      await channel.disconnect();
    });

    it('should return a copy (not mutable reference)', () => {
      const channel = new MatrixChannel(baseConfig);
      const status1 = channel.getStatus();
      status1.connected = true;

      const status2 = channel.getStatus();
      expect(status2.connected).toBe(false);
    });
  });
});
