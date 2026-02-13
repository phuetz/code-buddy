/**
 * Google Chat Channel Tests
 */

import type { GoogleChatConfig, GoogleChatEvent, GoogleChatSpace } from '../../src/channels/google-chat/index.js';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fs.readFileSync for service account loading
const mockReadFileSync = jest.fn();
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

// Mock session isolation and DM pairing from parent module
jest.mock('../../src/channels/session-isolation.js', () => ({
  getSessionIsolator: () => ({
    getSessionKey: jest.fn().mockReturnValue('test-session-key'),
  }),
}));

jest.mock('../../src/channels/dm-pairing.js', () => ({
  getDMPairing: () => ({
    requiresPairing: jest.fn().mockReturnValue(false),
    checkSender: jest.fn().mockResolvedValue({ approved: true, senderId: 'test', channelType: 'google-chat' }),
    getPairingMessage: jest.fn().mockReturnValue(null),
  }),
}));

jest.mock('../../src/channels/peer-routing.js', () => ({
  getPeerRouter: () => ({
    resolve: jest.fn().mockReturnValue(null),
    getAgentConfig: jest.fn().mockReturnValue({}),
  }),
}));

jest.mock('../../src/channels/identity-links.js', () => ({
  getIdentityLinker: () => ({
    resolve: jest.fn().mockReturnValue(null),
  }),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after mocks are set up
import { GoogleChatChannel } from '../../src/channels/google-chat/index.js';

// Helper: fake service account key (uses a real RSA key so crypto.createSign works)
const TEST_RSA_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCzFKkgNvQSdwNu
unGF+ziEif+eAlfa0p7NTSZOr3SqbcsGMsn+w9DVDir5sjjFCtO2eaUfLZ40EyCW
kuSsk0UwJOXKFme4gnuHg2yn5TAqV/UHBQ0Ewe3rpz1htHMsL9GIW4s/VBS5VKz9
f7cT+7iaUpElmrA38nmML5XTzc4abGl8PQeouEzglbx6QwkbMZqeLoLWcNnZtl5F
ZGHjXqR99e2doDnZCxSty4vf6aqthQ5LSe3m5igSDYmPFwf0j38DSroN3hymcaKT
zXp1Ep0re4R0OcUGs1D0nWL6Cp+dN1kHLb8QQab48Zsp0KWPjMSa0JZQ5cvLxcF2
zWFbdr0fAgMBAAECggEAKaHv/7FG5NQOVDu8EK3q4cVDS/S3gAPfL1N0SG657LVB
sds04qmbbyywCQTJ9eUiexWksa7lTK31sYvM5eIG/75UPbsfueF73nFLXW0G2ZFB
QbSG5kg/i72Bo6lT7T3gtJaztLFTcBKjdPuwEFFBBX+Uhu2Dcj5Iy7J0Xp1GARY3
jtUwKGnB7yc1M8QBNUHSjuyOjC2pZrnH5ZsXqvJuhkNxMzNk9/fF2cvpW769/S+I
s38whx5X6kvC20Zf9/1AkH3uYJy0UxQNucqe+5bi6lwLxgZ4Qb3H/PGudEM82pV7
IvHt7SWdkdjZJAuJQcCN0kn4gk4B71iSVgva9bjJQQKBgQDZSVHxkXDyi6Dy5QKX
CSnVwL+K0nb0BUjc6BYuqJvNL7tGfBLNWPhPUZld7Xb+FibKF0nHJ3szPy2/hFAM
BRT3aaMYq0Elc43rDQjHiDRd55WNZ+S2nW/b8suT4sQqJzwAO1cfsBA9t7T6PQVa
1Mo62wi/YSoQY9hUfSLQMu+iVwKBgQDS/Lww8p4Unt3/Xh6wsDCipJbdyqSmYLUK
AtvbFX3tRXV4Txw9mVTf0HA6Ub+76ow0sa8Hhht2y7Avi1PvQqnEuzetxrQArc8R
9YX6zVDL+v5ksugBKtvs/zzQ8KsvzS4gzcT/xPKGXY76GLzR7tEP/EW+IbHZKCvE
gUH4+FfOeQKBgGTNwxpS4xdi97Q30k/HjIUB+tqocU8b9IWnlkLnLgCvGC7G+OIT
WH9T19bfh8iw9iXjT/L4ugs4UDz9YTVyVhvCAkw7humdBkX5sgz/f2vhOFx1yoF9
4JsltJRTK7ZypT9mSDEHOUGorGk7TfSpq3hKjXBb32vjJkVsGG6Gcu3ZAoGAMf1/
+XkCy4/4uZDrZKHaZC7rMBHbgTBYtM6ImRg2hgl3E9Jqto2l9oHElYzZCQVBwxp2
hinYSAVq8Vjpwj7hSqOxRZNXAvIrpe2umQYcprgJnoJlRiGJilXPaxIa/XB4BX27
t35KmFuCjO9fjb4v+sGjJLGHGhTSifS2VO9CnsECgYEAsclchxWSq7OH0bgAxXCb
aKiRuwVMq4CH0rZ2o9Xp6pbBSr0Y6+4C2174y9JbmAAnNVm4XyVV1Cv5BPFWG+ak
Gcl8Gq6bxaZVvcKhsr40JL5xs/5k6Qz2nugGfNSDjs9sb95plZhO2s95DQgDOeEq
hnOH7jCDtVEyDjnIaBfkHQE=
-----END PRIVATE KEY-----`;

const fakeServiceAccount = {
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'key-123',
  private_key: TEST_RSA_PRIVATE_KEY,
  client_email: 'bot@test-project.iam.gserviceaccount.com',
  client_id: '123456789',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
};

// Helper: mock a successful token exchange
function mockTokenExchange() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      access_token: 'ya29.mock-access-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }),
    text: () => Promise.resolve(''),
  });
}

// Helper: mock a successful API response
function mockApiResponse(data: unknown, contentType = 'application/json') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: {
      get: (name: string) => name === 'content-type' ? contentType : null,
    },
  });
}

// Helper: mock a failed API response
function mockApiError(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
    headers: {
      get: () => null,
    },
  });
}

describe('GoogleChatChannel', () => {
  let channel: GoogleChatChannel;
  const mockConfig: GoogleChatConfig = {
    type: 'google-chat',
    enabled: true,
    serviceAccountPath: '/path/to/service-account.json',
    spaceId: 'AAAA_BBBB',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    mockReadFileSync.mockReset();
    mockReadFileSync.mockReturnValue(JSON.stringify(fakeServiceAccount));
    channel = new GoogleChatChannel(mockConfig);
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    it('should create channel with config', () => {
      expect(channel.type).toBe('google-chat');
      expect(channel.getStatus().type).toBe('google-chat');
    });

    it('should throw error without serviceAccountPath', () => {
      expect(() => {
        new GoogleChatChannel({
          ...mockConfig,
          serviceAccountPath: '',
        });
      }).toThrow('Google Chat service account path is required');
    });

    it('should set initial status as disconnected', () => {
      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    it('should accept optional spaceId', () => {
      const ch = new GoogleChatChannel({
        ...mockConfig,
        spaceId: 'CUSTOM_SPACE',
      });
      expect(ch.type).toBe('google-chat');
    });

    it('should accept optional verificationToken', () => {
      const ch = new GoogleChatChannel({
        ...mockConfig,
        verificationToken: 'my-secret-token',
      });
      expect(ch.type).toBe('google-chat');
    });
  });

  // ==========================================================================
  // Connect / Disconnect Lifecycle
  // ==========================================================================

  describe('connect', () => {
    it('should connect and authenticate successfully', async () => {
      // Token exchange
      mockTokenExchange();
      // List spaces API call
      mockApiResponse({ spaces: [{ name: 'spaces/AAAA', type: 'ROOM', displayName: 'Test Space' }] });

      await channel.connect();

      expect(channel.getStatus().connected).toBe(true);
      expect(channel.getStatus().authenticated).toBe(true);
      expect(channel.getStatus().info?.serviceAccount).toBe('bot@test-project.iam.gserviceaccount.com');
      expect(channel.getStatus().info?.projectId).toBe('test-project');
    });

    it('should emit connected event', async () => {
      const connectedSpy = jest.fn();
      channel.on('connected', connectedSpy);

      mockTokenExchange();
      mockApiResponse({ spaces: [] });

      await channel.connect();

      expect(connectedSpy).toHaveBeenCalledWith('google-chat');
    });

    it('should cache spaces returned from list on connect', async () => {
      const spaces: GoogleChatSpace[] = [
        { name: 'spaces/AAAA', type: 'ROOM', displayName: 'Room A' },
        { name: 'spaces/BBBB', type: 'DM' },
      ];

      mockTokenExchange();
      mockApiResponse({ spaces });

      await channel.connect();

      // Verify the spaces are cached by calling getSpace
      const spaceA = await channel.getSpace('spaces/AAAA');
      expect(spaceA?.displayName).toBe('Room A');
    });

    it('should handle list spaces failure as non-critical', async () => {
      mockTokenExchange();
      // List spaces fails
      mockApiError(403, 'Forbidden');

      // Should still connect successfully
      await channel.connect();

      expect(channel.getStatus().connected).toBe(true);
      expect(channel.getStatus().authenticated).toBe(true);
    });

    it('should throw and emit error on service account load failure', async () => {
      channel.on('error', () => {}); // prevent unhandled

      mockReadFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      await expect(channel.connect()).rejects.toThrow('Failed to load Google service account');
    });

    it('should emit error event on connection failure', async () => {
      const errorSpy = jest.fn();
      channel.on('error', errorSpy);

      mockReadFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      try {
        await channel.connect();
      } catch {
        // expected
      }

      expect(errorSpy).toHaveBeenCalledWith('google-chat', expect.any(Error));
    });

    it('should set error status on connection failure', async () => {
      channel.on('error', () => {});

      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      try {
        await channel.connect();
      } catch {
        // expected
      }

      expect(channel.getStatus().error).toContain('ENOENT');
    });

    it('should throw on token exchange failure', async () => {
      channel.on('error', () => {});

      // Token exchange fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('invalid_grant'),
      });

      await expect(channel.connect()).rejects.toThrow('Google OAuth token exchange failed');
    });
  });

  describe('disconnect', () => {
    it('should disconnect and clear state', async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [{ name: 'spaces/AAAA', type: 'ROOM' }] });
      await channel.connect();

      await channel.disconnect();

      expect(channel.getStatus().connected).toBe(false);
      expect(channel.getStatus().authenticated).toBe(false);
    });

    it('should emit disconnected event', async () => {
      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      await channel.disconnect();

      expect(disconnectedSpy).toHaveBeenCalledWith('google-chat');
    });

    it('should clear space cache on disconnect', async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [{ name: 'spaces/AAAA', type: 'ROOM', displayName: 'Room A' }] });
      await channel.connect();

      await channel.disconnect();

      // Re-connect to get a fresh token, then try to get the space
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();

      // Space cache should be empty; getSpace will make an API call
      // Token is still cached from the second connect, so only need the API response
      mockApiError(404, 'Not found');
      const space = await channel.getSpace('spaces/AAAA');
      expect(space).toBeNull();
    });
  });

  // ==========================================================================
  // JWT Auth Token Generation and Caching
  // ==========================================================================

  describe('JWT auth token', () => {
    it('should send JWT assertion in token exchange request', async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });

      await channel.connect();

      // First fetch call should be to the token endpoint with a JWT assertion
      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token');
      const body = tokenCall[1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      // The assertion should be a JWT (three dot-separated segments)
      const assertion = body.get('assertion') ?? '';
      expect(assertion.split('.').length).toBe(3);
    });

    it('should exchange JWT for access token via Google OAuth endpoint', async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });

      await channel.connect();

      // First fetch call should be to the token endpoint
      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token');
      expect(tokenCall[1].method).toBe('POST');
      expect(tokenCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('should cache access token and reuse it', async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();

      // Reset fetch to track new calls
      mockFetch.mockClear();

      // Send a message - should reuse the cached token (no new token exchange)
      mockApiResponse({ name: 'spaces/AAAA/messages/msg1' });

      await channel.send({ channelId: 'spaces/AAAA', content: 'Hello' });

      // Only 1 call (the message send), not 2 (token + send)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should refresh token after disconnect and reconnect', async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();

      // Count token calls from first connect
      const firstConnectTokenCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => call[0] === 'https://oauth2.googleapis.com/token'
      ).length;
      expect(firstConnectTokenCalls).toBe(1);

      // Disconnect clears the token
      await channel.disconnect();

      // Clear mock to count fresh
      mockFetch.mockClear();

      // Re-connect requires a new token
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();

      // Verify exactly 1 new token request was made
      const secondConnectTokenCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => call[0] === 'https://oauth2.googleapis.com/token'
      ).length;
      expect(secondConnectTokenCalls).toBe(1);
    });
  });

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  describe('send', () => {
    beforeEach(async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();
      mockFetch.mockClear();
    });

    it('should send text message to a space', async () => {
      mockApiResponse({ name: 'spaces/AAAA/messages/msg123' });

      const result = await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Hello, Google Chat!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg123');
    });

    it('should normalize space ID without prefix', async () => {
      mockApiResponse({ name: 'spaces/BBBB/messages/msg456' });

      const result = await channel.send({
        channelId: 'BBBB',
        content: 'Test message',
      });

      expect(result.success).toBe(true);

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('/spaces/BBBB/messages');
    });

    it('should not double-prefix space ID', async () => {
      mockApiResponse({ name: 'spaces/AAAA/messages/msg789' });

      await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Test',
      });

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).not.toContain('spaces/spaces/');
    });

    it('should send message with thread reply', async () => {
      mockApiResponse({ name: 'spaces/AAAA/messages/msg-reply' });

      await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Thread reply',
        threadId: 'spaces/AAAA/threads/thread123',
      });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.thread).toEqual({ name: 'spaces/AAAA/threads/thread123' });
      expect(lastCall[0]).toContain('messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
    });

    it('should not include thread query param when no threadId', async () => {
      mockApiResponse({ name: 'spaces/AAAA/messages/msg-no-thread' });

      await channel.send({
        channelId: 'spaces/AAAA',
        content: 'No thread',
      });

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).not.toContain('messageReplyOption');
    });

    it('should send message with URL buttons', async () => {
      mockApiResponse({ name: 'spaces/AAAA/messages/msg-btn' });

      await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Click here:',
        buttons: [
          { text: 'Visit Site', type: 'url', url: 'https://example.com' },
        ],
      });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.cardsV2).toBeDefined();
      expect(body.cardsV2[0].card.sections[0].widgets[0].buttonList.buttons[0]).toEqual({
        text: 'Visit Site',
        onClick: { openLink: { url: 'https://example.com' } },
      });
    });

    it('should send message with callback buttons', async () => {
      mockApiResponse({ name: 'spaces/AAAA/messages/msg-cb' });

      await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Pick one:',
        buttons: [
          { text: 'Approve', type: 'callback', data: 'approve_action' },
          { text: 'Reject', type: 'reply' },
        ],
      });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      const buttons = body.cardsV2[0].card.sections[0].widgets[0].buttonList.buttons;
      expect(buttons).toHaveLength(2);

      // Callback button with data
      expect(buttons[0].onClick.action.actionMethodName).toBe('approve_action');
      // Reply button (no data, falls back to text)
      expect(buttons[1].onClick.action.actionMethodName).toBe('Reject');
    });

    it('should return failure when not connected', async () => {
      await channel.disconnect();

      const result = await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Should fail',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Google Chat not connected');
    });

    it('should handle API error gracefully', async () => {
      mockApiError(403, 'Permission denied');

      const result = await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Google Chat API error');
    });

    it('should return undefined messageId when response has no name', async () => {
      mockApiResponse({});

      const result = await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Test',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
    });
  });

  // ==========================================================================
  // Webhook Event Handling
  // ==========================================================================

  describe('handleWebhook', () => {
    beforeEach(async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();
      mockFetch.mockClear();
    });

    describe('verification token', () => {
      it('should reject events with mismatched verification token', async () => {
        const verifiedChannel = new GoogleChatChannel({
          ...mockConfig,
          verificationToken: 'correct-token',
        });
        // Connect the verified channel
        mockTokenExchange();
        mockApiResponse({ spaces: [] });
        await verifiedChannel.connect();

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          token: 'wrong-token',
          message: {
            text: 'Hello',
            sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
        };

        const result = await verifiedChannel.handleWebhook(event);
        expect(result).toBeUndefined();

        await verifiedChannel.disconnect();
      });

      it('should accept events with matching verification token', async () => {
        const verifiedChannel = new GoogleChatChannel({
          ...mockConfig,
          verificationToken: 'correct-token',
        });
        mockTokenExchange();
        mockApiResponse({ spaces: [] });
        await verifiedChannel.connect();

        const messageSpy = jest.fn();
        verifiedChannel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          token: 'correct-token',
          message: {
            name: 'spaces/AAAA/messages/m1',
            text: 'Hello',
            sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
            space: { name: 'spaces/AAAA', type: 'ROOM' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
        };

        await verifiedChannel.handleWebhook(event);
        expect(messageSpy).toHaveBeenCalled();

        await verifiedChannel.disconnect();
      });

      it('should skip verification when no verificationToken is configured', async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/AAAA/messages/m1',
            text: 'Hello',
            sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
            space: { name: 'spaces/AAAA', type: 'ROOM' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
        };

        await channel.handleWebhook(event);
        expect(messageSpy).toHaveBeenCalled();
      });
    });

    describe('MESSAGE event', () => {
      it('should emit message event with correct inbound structure', async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/AAAA/messages/msg123',
            text: 'Hello bot!',
            argumentText: 'Hello bot!',
            createTime: '2024-01-15T10:30:00Z',
            sender: { name: 'users/user123', displayName: 'Alice', type: 'HUMAN' },
            space: { name: 'spaces/AAAA', type: 'ROOM', displayName: 'Test Room' },
            thread: { name: 'spaces/AAAA/threads/thread1' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM', displayName: 'Test Room' },
          user: { name: 'users/user123', displayName: 'Alice', type: 'HUMAN' },
        };

        await channel.handleWebhook(event);

        expect(messageSpy).toHaveBeenCalledTimes(1);
        const msg = messageSpy.mock.calls[0][0];
        expect(msg.id).toBe('msg123');
        expect(msg.content).toBe('Hello bot!');
        expect(msg.channel.id).toBe('AAAA');
        expect(msg.channel.type).toBe('google-chat');
        expect(msg.channel.name).toBe('Test Room');
        expect(msg.channel.isGroup).toBe(true);
        expect(msg.sender.id).toBe('user123');
        expect(msg.sender.displayName).toBe('Alice');
        expect(msg.sender.isBot).toBe(false);
        expect(msg.threadId).toBe('spaces/AAAA/threads/thread1');
        expect(msg.timestamp).toEqual(new Date('2024-01-15T10:30:00Z'));
        expect(msg.raw).toBe(event);
      });

      it('should detect DM space type', async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/DM123/messages/m1',
            text: 'DM message',
            sender: { name: 'users/u1', displayName: 'Bob', type: 'HUMAN' },
            space: { name: 'spaces/DM123', type: 'DM' },
          },
          space: { name: 'spaces/DM123', type: 'DM' },
          user: { name: 'users/u1', displayName: 'Bob', type: 'HUMAN' },
        };

        await channel.handleWebhook(event);

        const msg = messageSpy.mock.calls[0][0];
        expect(msg.channel.isDM).toBe(true);
        expect(msg.channel.isGroup).toBe(false);
      });

      it('should use argumentText when available (strips @mention)', async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/AAAA/messages/m2',
            text: '@Bot do something',
            argumentText: '  do something  ',
            sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
            space: { name: 'spaces/AAAA', type: 'ROOM' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
        };

        await channel.handleWebhook(event);

        const msg = messageSpy.mock.calls[0][0];
        expect(msg.content).toBe('do something');
      });

      it('should ignore BOT messages', async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/AAAA/messages/m3',
            text: 'Bot reply',
            sender: { name: 'users/bot1', displayName: 'Another Bot', type: 'BOT' },
            space: { name: 'spaces/AAAA', type: 'ROOM' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/bot1', displayName: 'Another Bot', type: 'BOT' },
        };

        await channel.handleWebhook(event);

        expect(messageSpy).not.toHaveBeenCalled();
      });

      it('should filter unauthorized users', async () => {
        const filteredChannel = new GoogleChatChannel({
          ...mockConfig,
          allowedUsers: ['allowedUser'],
        });
        mockTokenExchange();
        mockApiResponse({ spaces: [] });
        await filteredChannel.connect();

        const messageSpy = jest.fn();
        filteredChannel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/AAAA/messages/m4',
            text: 'Blocked',
            sender: { name: 'users/blockedUser', displayName: 'Blocked', type: 'HUMAN' },
            space: { name: 'spaces/AAAA', type: 'ROOM' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/blockedUser', displayName: 'Blocked', type: 'HUMAN' },
        };

        await filteredChannel.handleWebhook(event);
        expect(messageSpy).not.toHaveBeenCalled();

        await filteredChannel.disconnect();
      });

      it('should filter unauthorized channels', async () => {
        const filteredChannel = new GoogleChatChannel({
          ...mockConfig,
          allowedChannels: ['allowedSpace'],
        });
        mockTokenExchange();
        mockApiResponse({ spaces: [] });
        await filteredChannel.connect();

        const messageSpy = jest.fn();
        filteredChannel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/blockedSpace/messages/m5',
            text: 'Blocked',
            sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
            space: { name: 'spaces/blockedSpace', type: 'ROOM' },
          },
          space: { name: 'spaces/blockedSpace', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
        };

        await filteredChannel.handleWebhook(event);
        expect(messageSpy).not.toHaveBeenCalled();

        await filteredChannel.disconnect();
      });

      it('should silently return when message, user, or space is missing', async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        // No message
        await channel.handleWebhook({
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
        });
        expect(messageSpy).not.toHaveBeenCalled();

        // No user
        await channel.handleWebhook({
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: { text: 'Hello' },
        });
        expect(messageSpy).not.toHaveBeenCalled();
      });

      it('should handle message attachments', async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/AAAA/messages/m6',
            text: '',
            sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
            space: { name: 'spaces/AAAA', type: 'ROOM' },
            attachment: [
              {
                name: 'att1',
                contentName: 'photo.jpg',
                contentType: 'image/jpeg',
                downloadUri: 'https://example.com/photo.jpg',
              },
              {
                name: 'att2',
                contentName: 'doc.pdf',
                contentType: 'application/pdf',
                thumbnailUri: 'https://example.com/thumb.png',
              },
            ],
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
        };

        await channel.handleWebhook(event);

        const msg = messageSpy.mock.calls[0][0];
        expect(msg.attachments).toHaveLength(2);
        expect(msg.attachments[0].type).toBe('image');
        expect(msg.attachments[0].fileName).toBe('photo.jpg');
        expect(msg.attachments[0].url).toBe('https://example.com/photo.jpg');
        expect(msg.attachments[1].type).toBe('file');
        expect(msg.attachments[1].url).toBe('https://example.com/thumb.png');

        // Content type should be first attachment's type when there are attachments
        expect(msg.contentType).toBe('image');
      });

      it('should update lastActivity timestamp', async () => {
        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            name: 'spaces/AAAA/messages/m7',
            text: 'Activity',
            sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
            space: { name: 'spaces/AAAA', type: 'ROOM' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
        };

        channel.on('message', () => {}); // prevent unhandled
        await channel.handleWebhook(event);

        expect(channel.getStatus().lastActivity).toBeInstanceOf(Date);
      });

      it('should generate fallback message ID when name is missing', async () => {
        const messageSpy = jest.fn();
        channel.on('message', messageSpy);

        const event: GoogleChatEvent = {
          type: 'MESSAGE',
          eventTime: new Date().toISOString(),
          message: {
            text: 'No name',
            sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
            space: { name: 'spaces/AAAA', type: 'ROOM' },
          },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
        };

        await channel.handleWebhook(event);

        const msg = messageSpy.mock.calls[0][0];
        expect(msg.id).toMatch(/^gchat-\d+$/);
      });
    });

    describe('ADDED_TO_SPACE event', () => {
      it('should return greeting message', async () => {
        const event: GoogleChatEvent = {
          type: 'ADDED_TO_SPACE',
          eventTime: new Date().toISOString(),
          space: { name: 'spaces/NEW_SPACE', type: 'ROOM', displayName: 'New Room' },
          user: { name: 'users/u1', displayName: 'Admin', type: 'HUMAN' },
        };

        const result = await channel.handleWebhook(event);

        expect(result).toEqual({ text: "Hello! I'm ready to help." });
      });

      it('should cache the new space', async () => {
        const event: GoogleChatEvent = {
          type: 'ADDED_TO_SPACE',
          eventTime: new Date().toISOString(),
          space: { name: 'spaces/CACHED_SPACE', type: 'ROOM', displayName: 'Cached Room' },
          user: { name: 'users/u1', displayName: 'Admin', type: 'HUMAN' },
        };

        await channel.handleWebhook(event);

        // Verify the space was cached
        const space = await channel.getSpace('spaces/CACHED_SPACE');
        expect(space?.displayName).toBe('Cached Room');
      });
    });

    describe('REMOVED_FROM_SPACE event', () => {
      it('should remove space from cache', async () => {
        // First add it
        await channel.handleWebhook({
          type: 'ADDED_TO_SPACE',
          eventTime: new Date().toISOString(),
          space: { name: 'spaces/TO_REMOVE', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'Admin', type: 'HUMAN' },
        });

        // Then remove it
        const result = await channel.handleWebhook({
          type: 'REMOVED_FROM_SPACE',
          eventTime: new Date().toISOString(),
          space: { name: 'spaces/TO_REMOVE', type: 'ROOM' },
        });

        expect(result).toBeUndefined();

        // Space should no longer be in cache
        mockApiError(404, 'Not found');
        const space = await channel.getSpace('spaces/TO_REMOVE');
        expect(space).toBeNull();
      });

      it('should return undefined', async () => {
        const result = await channel.handleWebhook({
          type: 'REMOVED_FROM_SPACE',
          eventTime: new Date().toISOString(),
          space: { name: 'spaces/GONE', type: 'ROOM' },
        });

        expect(result).toBeUndefined();
      });
    });

    describe('CARD_CLICKED event', () => {
      it('should emit command event with card action details', async () => {
        const commandSpy = jest.fn();
        channel.on('command', commandSpy);

        const event: GoogleChatEvent = {
          type: 'CARD_CLICKED',
          eventTime: new Date().toISOString(),
          space: { name: 'spaces/AAAA', type: 'ROOM', displayName: 'Room A' },
          user: { name: 'users/u1', displayName: 'Alice', type: 'HUMAN' },
          action: {
            actionMethodName: 'approve',
            parameters: [
              { key: 'requestId', value: '42' },
              { key: 'type', value: 'pr' },
            ],
          },
        };

        await channel.handleWebhook(event);

        expect(commandSpy).toHaveBeenCalledTimes(1);
        const msg = commandSpy.mock.calls[0][0];
        expect(msg.content).toBe('approve');
        expect(msg.contentType).toBe('command');
        expect(msg.isCommand).toBe(true);
        expect(msg.commandName).toBe('card_action');
        expect(msg.commandArgs).toEqual(['approve', 'requestId=42', 'type=pr']);
        expect(msg.sender.id).toBe('u1');
        expect(msg.channel.id).toBe('AAAA');
      });

      it('should silently return when user or space is missing', async () => {
        const commandSpy = jest.fn();
        channel.on('command', commandSpy);

        await channel.handleWebhook({
          type: 'CARD_CLICKED',
          eventTime: new Date().toISOString(),
          action: { actionMethodName: 'test' },
        });

        expect(commandSpy).not.toHaveBeenCalled();
      });

      it('should handle empty action parameters', async () => {
        const commandSpy = jest.fn();
        channel.on('command', commandSpy);

        const event: GoogleChatEvent = {
          type: 'CARD_CLICKED',
          eventTime: new Date().toISOString(),
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          action: {
            actionMethodName: 'simple_action',
          },
        };

        await channel.handleWebhook(event);

        const msg = commandSpy.mock.calls[0][0];
        expect(msg.commandArgs).toEqual(['simple_action']);
      });
    });

    describe('unhandled event types', () => {
      it('should return undefined for unknown event types', async () => {
        const result = await channel.handleWebhook({
          type: 'UNKNOWN_EVENT' as GoogleChatEvent['type'],
          eventTime: new Date().toISOString(),
        });

        expect(result).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // Slash Commands
  // ==========================================================================

  describe('slash commands', () => {
    beforeEach(async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();
      mockFetch.mockClear();
    });

    it('should detect slash commands via slashCommand field', async () => {
      const messageSpy = jest.fn();
      const commandSpy = jest.fn();
      channel.on('message', messageSpy);
      channel.on('command', commandSpy);

      const event: GoogleChatEvent = {
        type: 'MESSAGE',
        eventTime: new Date().toISOString(),
        message: {
          name: 'spaces/AAAA/messages/m-cmd',
          text: '/help getting started',
          argumentText: '/help getting started',
          sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          slashCommand: { commandId: '1' },
          annotations: [
            {
              type: 'SLASH_COMMAND',
              slashCommand: { commandName: 'help', commandId: '1' },
            },
          ],
        },
        space: { name: 'spaces/AAAA', type: 'ROOM' },
        user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
      };

      await channel.handleWebhook(event);

      expect(commandSpy).toHaveBeenCalled();
      const msg = commandSpy.mock.calls[0][0];
      expect(msg.isCommand).toBe(true);
      expect(msg.commandName).toBe('help');
      expect(msg.contentType).toBe('command');
    });

    it('should parse slash commands from text when annotation is missing', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      const event: GoogleChatEvent = {
        type: 'MESSAGE',
        eventTime: new Date().toISOString(),
        message: {
          name: 'spaces/AAAA/messages/m-cmd2',
          text: '/deploy prod',
          argumentText: '/deploy prod',
          sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          slashCommand: { commandId: '2' },
        },
        space: { name: 'spaces/AAAA', type: 'ROOM' },
        user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
      };

      await channel.handleWebhook(event);

      expect(commandSpy).toHaveBeenCalled();
      const msg = commandSpy.mock.calls[0][0];
      // Falls back to parseCommand which extracts from text
      expect(msg.isCommand).toBe(true);
    });

    it('should parse regular /command text via parseCommand', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      const event: GoogleChatEvent = {
        type: 'MESSAGE',
        eventTime: new Date().toISOString(),
        message: {
          name: 'spaces/AAAA/messages/m-cmd3',
          text: '/status check now',
          argumentText: '/status check now',
          sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
        },
        space: { name: 'spaces/AAAA', type: 'ROOM' },
        user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
      };

      await channel.handleWebhook(event);

      expect(commandSpy).toHaveBeenCalled();
      const msg = commandSpy.mock.calls[0][0];
      expect(msg.isCommand).toBe(true);
      expect(msg.commandName).toBe('status');
      expect(msg.commandArgs).toEqual(['check', 'now']);
    });
  });

  // ==========================================================================
  // Space Management
  // ==========================================================================

  describe('space management', () => {
    beforeEach(async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();
      mockFetch.mockClear();
    });

    describe('listSpaces', () => {
      it('should list spaces from API', async () => {
        const spaces = [
          { name: 'spaces/A', type: 'ROOM', displayName: 'Room A' },
          { name: 'spaces/B', type: 'DM' },
        ];
        mockApiResponse({ spaces });

        const result = await channel.listSpaces();

        expect(result).toHaveLength(2);
        expect(result[0].displayName).toBe('Room A');
      });

      it('should return empty array on error', async () => {
        mockApiError(500, 'Internal Server Error');

        const result = await channel.listSpaces();

        expect(result).toEqual([]);
      });

      it('should return empty array when no spaces exist', async () => {
        mockApiResponse({});

        const result = await channel.listSpaces();

        expect(result).toEqual([]);
      });
    });

    describe('getSpace', () => {
      it('should return space from cache', async () => {
        // Add a space to cache via ADDED_TO_SPACE event
        await channel.handleWebhook({
          type: 'ADDED_TO_SPACE',
          eventTime: new Date().toISOString(),
          space: { name: 'spaces/CACHED', type: 'ROOM', displayName: 'Cached' },
          user: { name: 'users/u1', displayName: 'Admin', type: 'HUMAN' },
        });

        // Should not make an API call
        const space = await channel.getSpace('spaces/CACHED');
        expect(space?.displayName).toBe('Cached');
        // No additional fetch calls beyond what was already made
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should fetch space from API when not cached', async () => {
        mockApiResponse({ name: 'spaces/REMOTE', type: 'ROOM', displayName: 'Remote Room' });

        const space = await channel.getSpace('spaces/REMOTE');

        expect(space?.displayName).toBe('Remote Room');
      });

      it('should normalize space name without prefix', async () => {
        mockApiResponse({ name: 'spaces/NORM', type: 'ROOM', displayName: 'Normalized' });

        const space = await channel.getSpace('NORM');

        expect(space?.displayName).toBe('Normalized');
      });

      it('should return null on API error', async () => {
        mockApiError(404, 'Not found');

        const space = await channel.getSpace('spaces/NONEXISTENT');

        expect(space).toBeNull();
      });

      it('should cache fetched space for future lookups', async () => {
        mockApiResponse({ name: 'spaces/FETCHED', type: 'DM', displayName: 'Fetched DM' });

        // First call - hits API
        const space1 = await channel.getSpace('spaces/FETCHED');
        expect(space1?.displayName).toBe('Fetched DM');

        // Second call - should use cache (no additional fetch)
        const callsBefore = mockFetch.mock.calls.length;
        const space2 = await channel.getSpace('spaces/FETCHED');
        expect(space2?.displayName).toBe('Fetched DM');
        expect(mockFetch.mock.calls.length).toBe(callsBefore);
      });
    });

    describe('updateMessage', () => {
      it('should update message text', async () => {
        mockApiResponse({});

        await channel.updateMessage('spaces/AAAA/messages/msg1', 'Updated text');

        const lastCall = mockFetch.mock.calls[0];
        expect(lastCall[0]).toContain('/spaces/AAAA/messages/msg1?updateMask=text');
        expect(lastCall[1].method).toBe('PUT');
        const body = JSON.parse(lastCall[1].body);
        expect(body.text).toBe('Updated text');
      });

      it('should normalize message name without prefix', async () => {
        mockApiResponse({});

        await channel.updateMessage('AAAA/messages/msg1', 'Updated');

        const lastCall = mockFetch.mock.calls[0];
        expect(lastCall[0]).toContain('/spaces/AAAA/messages/msg1');
      });
    });

    describe('deleteMessage', () => {
      it('should delete message', async () => {
        mockApiResponse({});

        await channel.deleteMessage('spaces/AAAA/messages/msg1');

        const lastCall = mockFetch.mock.calls[0];
        expect(lastCall[0]).toContain('/spaces/AAAA/messages/msg1');
        expect(lastCall[1].method).toBe('DELETE');
      });

      it('should normalize message name without prefix', async () => {
        mockApiResponse({});

        await channel.deleteMessage('AAAA/messages/msg1');

        const lastCall = mockFetch.mock.calls[0];
        expect(lastCall[0]).toContain('/spaces/AAAA/messages/msg1');
      });
    });
  });

  // ==========================================================================
  // MIME Type Mapping
  // ==========================================================================

  describe('MIME type mapping', () => {
    beforeEach(async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();
      mockFetch.mockClear();
    });

    it('should map image MIME types correctly', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const event: GoogleChatEvent = {
        type: 'MESSAGE',
        eventTime: new Date().toISOString(),
        message: {
          name: 'spaces/AAAA/messages/m-img',
          text: '',
          sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          attachment: [
            { name: 'a1', contentName: 'photo.png', contentType: 'image/png' },
          ],
        },
        space: { name: 'spaces/AAAA', type: 'ROOM' },
        user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
      };

      await channel.handleWebhook(event);

      expect(messageSpy.mock.calls[0][0].attachments[0].type).toBe('image');
    });

    it('should map audio MIME types correctly', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const event: GoogleChatEvent = {
        type: 'MESSAGE',
        eventTime: new Date().toISOString(),
        message: {
          name: 'spaces/AAAA/messages/m-audio',
          text: '',
          sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          attachment: [
            { name: 'a1', contentName: 'voice.ogg', contentType: 'audio/ogg' },
          ],
        },
        space: { name: 'spaces/AAAA', type: 'ROOM' },
        user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
      };

      await channel.handleWebhook(event);

      expect(messageSpy.mock.calls[0][0].attachments[0].type).toBe('audio');
    });

    it('should map video MIME types correctly', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const event: GoogleChatEvent = {
        type: 'MESSAGE',
        eventTime: new Date().toISOString(),
        message: {
          name: 'spaces/AAAA/messages/m-video',
          text: '',
          sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          attachment: [
            { name: 'a1', contentName: 'clip.mp4', contentType: 'video/mp4' },
          ],
        },
        space: { name: 'spaces/AAAA', type: 'ROOM' },
        user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
      };

      await channel.handleWebhook(event);

      expect(messageSpy.mock.calls[0][0].attachments[0].type).toBe('video');
    });

    it('should default to file type for unknown MIME types', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const event: GoogleChatEvent = {
        type: 'MESSAGE',
        eventTime: new Date().toISOString(),
        message: {
          name: 'spaces/AAAA/messages/m-file',
          text: '',
          sender: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
          space: { name: 'spaces/AAAA', type: 'ROOM' },
          attachment: [
            { name: 'a1', contentName: 'data.bin', contentType: 'application/octet-stream' },
          ],
        },
        space: { name: 'spaces/AAAA', type: 'ROOM' },
        user: { name: 'users/u1', displayName: 'User', type: 'HUMAN' },
      };

      await channel.handleWebhook(event);

      expect(messageSpy.mock.calls[0][0].attachments[0].type).toBe('file');
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should handle invalid service account JSON', async () => {
      channel.on('error', () => {});

      mockReadFileSync.mockReturnValue('not valid json');

      await expect(channel.connect()).rejects.toThrow('Failed to load Google service account');
    });

    it('should handle fetch network errors during token exchange', async () => {
      channel.on('error', () => {});

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(channel.connect()).rejects.toThrow('Network error');
    });

    it('should handle fetch network errors during API requests', async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();
      mockFetch.mockClear();

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('should include status code in API error message', async () => {
      mockTokenExchange();
      mockApiResponse({ spaces: [] });
      await channel.connect();
      mockFetch.mockClear();

      mockApiError(429, 'Rate limit exceeded');

      const result = await channel.send({
        channelId: 'spaces/AAAA',
        content: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('429');
    });
  });

  // ==========================================================================
  // User / Channel Filtering
  // ==========================================================================

  describe('user and channel filtering', () => {
    it('should allow all users when no allowedUsers configured', () => {
      expect(channel['isUserAllowed']('any-user')).toBe(true);
    });

    it('should check user authorization', () => {
      const ch = new GoogleChatChannel({
        ...mockConfig,
        allowedUsers: ['user1', 'user2'],
      });

      expect(ch['isUserAllowed']('user1')).toBe(true);
      expect(ch['isUserAllowed']('user3')).toBe(false);
    });

    it('should allow all channels when no allowedChannels configured', () => {
      expect(channel['isChannelAllowed']('any-channel')).toBe(true);
    });

    it('should check channel authorization', () => {
      const ch = new GoogleChatChannel({
        ...mockConfig,
        allowedChannels: ['space1', 'space2'],
      });

      expect(ch['isChannelAllowed']('space1')).toBe(true);
      expect(ch['isChannelAllowed']('space3')).toBe(false);
    });
  });
});
