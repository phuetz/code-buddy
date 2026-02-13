/**
 * Microsoft Teams Channel Tests
 */

import { TeamsChannel } from '../../src/channels/teams/index.js';
import type {
  TeamsConfig,
  BotFrameworkActivity,
  BotFrameworkAccount,
  BotFrameworkConversation,
} from '../../src/channels/teams/index.js';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock dm-pairing (dynamic import used in handleMessageActivity)
jest.mock('../../src/channels/dm-pairing.js', () => ({
  getDMPairing: jest.fn(() => ({
    requiresPairing: jest.fn(() => false),
    checkSender: jest.fn(() => ({ approved: true, senderId: 'user-1', channelType: 'teams' })),
    getPairingMessage: jest.fn(() => null),
  })),
}));

// Mock session-isolation (used by getSessionKey)
jest.mock('../../src/channels/session-isolation.js', () => ({
  getSessionIsolator: jest.fn(() => ({
    getSessionKey: jest.fn(
      (msg: { channel: { type: string; id: string }; sender: { id: string } }) =>
        `${msg.channel.type}:${msg.channel.id}:${msg.sender.id}`
    ),
  })),
}));

// Mock identity-links (used by getCanonicalIdentity)
jest.mock('../../src/channels/identity-links.js', () => ({
  getIdentityLinker: jest.fn(() => ({
    resolve: jest.fn(() => null),
  })),
}));

// Mock peer-routing
jest.mock('../../src/channels/peer-routing.js', () => ({
  getPeerRouter: jest.fn(() => ({
    resolve: jest.fn(() => null),
    getAgentConfig: jest.fn(() => ({})),
  })),
}));

// Mock concurrency/lane-queue
jest.mock('../../src/concurrency/lane-queue.js', () => ({
  LaneQueue: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn((_key: string, handler: () => Promise<unknown>) => handler()),
    clear: jest.fn(),
  })),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Helper to build a standard token response mock
function mockTokenResponse(expiresIn = 3600) {
  return {
    ok: true,
    text: () => Promise.resolve(''),
    json: () =>
      Promise.resolve({
        access_token: 'test-access-token',
        expires_in: expiresIn,
        token_type: 'Bearer',
      }),
  };
}

// Helper to build a successful API response
function mockApiResponse(body: Record<string, unknown> = {}) {
  return {
    ok: true,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

// Helper to build an error API response
function mockApiError(status: number, text: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.reject(new Error('not json')),
  };
}

// Standard config
const baseConfig: TeamsConfig = {
  type: 'teams',
  enabled: true,
  appId: 'test-app-id',
  appPassword: 'test-app-password',
};

// Standard activity factory helpers
function makeAccount(overrides: Partial<BotFrameworkAccount> = {}): BotFrameworkAccount {
  return { id: 'user-1', name: 'Test User', ...overrides };
}

function makeConversation(
  overrides: Partial<BotFrameworkConversation> = {}
): BotFrameworkConversation {
  return { id: 'conv-1', name: 'Test Conversation', ...overrides };
}

function makeActivity(overrides: Partial<BotFrameworkActivity> = {}): BotFrameworkActivity {
  return {
    type: 'message',
    id: 'activity-1',
    channelId: 'msteams',
    from: makeAccount(),
    recipient: makeAccount({ id: 'bot-1', name: 'Test Bot' }),
    conversation: makeConversation(),
    serviceUrl: 'https://smba.trafficmanager.net/teams/',
    text: 'Hello bot!',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('TeamsChannel', () => {
  let channel: TeamsChannel;

  beforeEach(() => {
    jest.clearAllMocks();
    channel = new TeamsChannel(baseConfig);
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    it('should create channel with correct type', () => {
      expect(channel.type).toBe('teams');
      expect(channel.getStatus().type).toBe('teams');
    });

    it('should initialize as disconnected', () => {
      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    it('should throw error when appId is missing', () => {
      expect(() => {
        new TeamsChannel({ ...baseConfig, appId: '' });
      }).toThrow('Teams App ID is required');
    });

    it('should throw error when appPassword is missing', () => {
      expect(() => {
        new TeamsChannel({ ...baseConfig, appPassword: '' });
      }).toThrow('Teams App Password is required');
    });

    it('should accept optional tenantId', () => {
      const ch = new TeamsChannel({ ...baseConfig, tenantId: 'custom-tenant' });
      expect(ch.type).toBe('teams');
    });

    it('should accept optional oauthAuthority', () => {
      const ch = new TeamsChannel({
        ...baseConfig,
        oauthAuthority: 'https://login.microsoftonline.com/custom/oauth2/v2.0/token',
      });
      expect(ch.type).toBe('teams');
    });
  });

  // ==========================================================================
  // Connect / Disconnect Lifecycle
  // ==========================================================================

  describe('connect', () => {
    it('should connect successfully by acquiring a token', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await channel.connect();

      const status = channel.getStatus();
      expect(status.connected).toBe(true);
      expect(status.authenticated).toBe(true);
      expect(status.info?.appId).toBe('test-app-id');
      expect(status.info?.tenantId).toBe('botframework.com');
    });

    it('should use custom tenantId in status info', async () => {
      channel = new TeamsChannel({ ...baseConfig, tenantId: 'my-tenant' });
      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await channel.connect();

      expect(channel.getStatus().info?.tenantId).toBe('my-tenant');
    });

    it('should emit connected event', async () => {
      const connectedSpy = jest.fn();
      channel.on('connected', connectedSpy);

      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await channel.connect();

      expect(connectedSpy).toHaveBeenCalledWith('teams');
    });

    it('should handle connection error and emit error event', async () => {
      const errorSpy = jest.fn();
      channel.on('error', errorSpy);

      mockFetch.mockResolvedValueOnce(mockApiError(401, 'invalid_client'));

      await expect(channel.connect()).rejects.toThrow('Bot Framework token exchange failed');
      expect(errorSpy).toHaveBeenCalledWith('teams', expect.any(Error));
      expect(channel.getStatus().error).toContain('Bot Framework token exchange failed');
    });

    it('should handle fetch exception during connect', async () => {
      const errorSpy = jest.fn();
      channel.on('error', errorSpy);

      mockFetch.mockRejectedValueOnce(new Error('network down'));

      await expect(channel.connect()).rejects.toThrow('network down');
      expect(errorSpy).toHaveBeenCalledWith('teams', expect.any(Error));
    });
  });

  describe('disconnect', () => {
    it('should disconnect and clear state', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();

      await channel.disconnect();

      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    it('should emit disconnected event', async () => {
      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      await channel.disconnect();

      expect(disconnectedSpy).toHaveBeenCalledWith('teams');
    });

    it('should clear conversation references on disconnect', async () => {
      // Connect and store a conversation reference via activity
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();

      const activity = makeActivity();
      // Requires another token fetch for handleActivity -> handleMessageActivity -> send
      await channel.handleActivity(activity);

      // Should have a conversation ref
      expect(channel.getConversationReference('conv-1')).toBeDefined();

      await channel.disconnect();

      // After disconnect, refs should be cleared
      expect(channel.getConversationReference('conv-1')).toBeUndefined();
    });
  });

  // ==========================================================================
  // OAuth2 Token Acquisition and Refresh
  // ==========================================================================

  describe('OAuth2 token management', () => {
    it('should acquire token with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await channel.connect();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );

      // Verify the body params
      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('client_credentials');
      expect(body.get('client_id')).toBe('test-app-id');
      expect(body.get('client_secret')).toBe('test-app-password');
      expect(body.get('scope')).toBe('https://api.botframework.com/.default');
    });

    it('should use custom oauthAuthority when provided', async () => {
      const customAuthority = 'https://login.microsoftonline.com/custom/oauth2/v2.0/token';
      channel = new TeamsChannel({ ...baseConfig, oauthAuthority: customAuthority });

      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await channel.connect();

      expect(mockFetch).toHaveBeenCalledWith(customAuthority, expect.any(Object));
    });

    it('should cache token and reuse it within expiry', async () => {
      // First call: connect (gets token)
      mockFetch.mockResolvedValueOnce(mockTokenResponse(3600));
      await channel.connect();

      // Store a conversation reference so send() can work
      await channel.handleActivity(makeActivity());

      // Second call: send message (should reuse cached token)
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));
      await channel.send({ channelId: 'conv-1', content: 'Test' });

      // Should have called fetch 3 times total: 1 for token, 1 for handleActivity (none since no send), 1 for send
      // Actually: connect=1 token call, handleActivity stores ref but no fetch, send=1 API call (reuses cached token)
      // So total: 2 calls (1 token + 1 api)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should refresh token when expired', async () => {
      // First token with very short expiry (already expired with 60s buffer)
      mockFetch.mockResolvedValueOnce(mockTokenResponse(30)); // 30 seconds, within 60s buffer
      await channel.connect();

      // Store a conversation reference
      await channel.handleActivity(makeActivity());

      // Second token fetch should happen because first one is within 60s buffer
      mockFetch.mockResolvedValueOnce(mockTokenResponse(3600)); // fresh token
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' })); // API response

      await channel.send({ channelId: 'conv-1', content: 'Test' });

      // 1 token (connect) + 1 token (refresh) + 1 API call = 3
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw on token exchange failure', async () => {
      channel.on('error', () => {}); // prevent unhandled
      mockFetch.mockResolvedValueOnce(mockApiError(400, 'invalid_grant'));

      await expect(channel.connect()).rejects.toThrow(
        'Bot Framework token exchange failed: 400 invalid_grant'
      );
    });
  });

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  describe('send', () => {
    beforeEach(async () => {
      // Connect and store a conversation reference
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
      await channel.handleActivity(makeActivity());
    });

    it('should return error when not connected', async () => {
      await channel.disconnect();

      const result = await channel.send({ channelId: 'conv-1', content: 'Test' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Teams not connected');
    });

    it('should return error when no conversation reference exists', async () => {
      const result = await channel.send({ channelId: 'unknown-conv', content: 'Test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No conversation reference found');
    });

    it('should send a text message successfully', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'sent-msg-1' }));

      const result = await channel.send({ channelId: 'conv-1', content: 'Hello Teams!' });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('sent-msg-1');
    });

    it('should send message to correct API endpoint', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({ channelId: 'conv-1', content: 'Test' });

      // The API call is the last fetch call
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe(
        'https://smba.trafficmanager.net/teams/v3/conversations/conv-1/activities'
      );
      expect(lastCall[1].method).toBe('POST');
      expect(lastCall[1].headers.Authorization).toBe('Bearer test-access-token');
    });

    it('should use markdown textFormat by default', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({ channelId: 'conv-1', content: 'Test' });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.textFormat).toBe('markdown');
    });

    it('should use xml textFormat when parseMode is html', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({ channelId: 'conv-1', content: 'Test', parseMode: 'html' });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.textFormat).toBe('xml');
    });

    it('should include replyToId when replyTo is specified', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({ channelId: 'conv-1', content: 'Reply', replyTo: 'original-msg-1' });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.replyToId).toBe('original-msg-1');
    });

    it('should include attachments when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({
        channelId: 'conv-1',
        content: 'See attached',
        attachments: [
          { type: 'file', url: 'https://example.com/doc.pdf', fileName: 'doc.pdf', mimeType: 'application/pdf' },
          { type: 'image', url: 'https://example.com/image.png', fileName: 'image.png', mimeType: 'image/png' },
        ],
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.attachments).toHaveLength(2);
      expect(body.attachments[0].contentType).toBe('application/pdf');
      expect(body.attachments[0].contentUrl).toBe('https://example.com/doc.pdf');
      expect(body.attachments[0].name).toBe('doc.pdf');
    });

    it('should filter out attachments without url', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({
        channelId: 'conv-1',
        content: 'Test',
        attachments: [
          { type: 'file', fileName: 'no-url.txt' }, // no url
          { type: 'image', url: 'https://example.com/image.png', mimeType: 'image/png' },
        ],
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].contentUrl).toBe('https://example.com/image.png');
    });

    it('should handle send API error gracefully', async () => {
      mockFetch.mockResolvedValueOnce(mockApiError(403, 'Forbidden'));

      const result = await channel.send({ channelId: 'conv-1', content: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Bot Framework API error');
    });

    it('should handle network error during send', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await channel.send({ channelId: 'conv-1', content: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  // ==========================================================================
  // Hero Cards
  // ==========================================================================

  describe('hero cards (buttons)', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
      await channel.handleActivity(makeActivity());
    });

    it('should send hero card with URL buttons', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({
        channelId: 'conv-1',
        content: 'Choose an option:',
        buttons: [
          { text: 'Visit Site', type: 'url', url: 'https://example.com' },
        ],
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);

      // When buttons are present, text is deleted and content goes in card
      expect(body.text).toBeUndefined();
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.hero');

      const card = body.attachments[0].content;
      expect(card.text).toBe('Choose an option:');
      expect(card.buttons).toHaveLength(1);
      expect(card.buttons[0].type).toBe('openUrl');
      expect(card.buttons[0].title).toBe('Visit Site');
      expect(card.buttons[0].value).toBe('https://example.com');
    });

    it('should send hero card with callback buttons', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({
        channelId: 'conv-1',
        content: 'Pick one:',
        buttons: [
          { text: 'Option A', type: 'callback', data: 'opt_a' },
          { text: 'Option B', type: 'reply' },
        ],
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      const card = body.attachments[0].content;

      expect(card.buttons).toHaveLength(2);
      expect(card.buttons[0].type).toBe('messageBack');
      expect(card.buttons[0].text).toBe('opt_a');
      expect(card.buttons[0].value).toBe('opt_a');

      // Reply button with no data falls back to text
      expect(card.buttons[1].type).toBe('messageBack');
      expect(card.buttons[1].text).toBe('Option B');
      expect(card.buttons[1].value).toBe('Option B');
    });
  });

  // ==========================================================================
  // Activity Handling
  // ==========================================================================

  describe('handleActivity', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should store conversation reference from activity', async () => {
      const activity = makeActivity();
      await channel.handleActivity(activity);

      const ref = channel.getConversationReference('conv-1');
      expect(ref).toBeDefined();
      expect(ref?.user.id).toBe('user-1');
      expect(ref?.bot.id).toBe('bot-1');
      expect(ref?.serviceUrl).toBe('https://smba.trafficmanager.net/teams/');
      expect(ref?.channelId).toBe('msteams');
    });

    it('should not store reference if from/conversation/recipient/serviceUrl is missing', async () => {
      await channel.handleActivity({ type: 'message', text: 'test' });
      expect(channel.getConversationReference('anything')).toBeUndefined();
    });

    it('should handle activity from emulator without ignoring', async () => {
      const activity = makeActivity({ channelId: 'emulator' });
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(activity);

      // Should still process (emulator is not ignored)
      expect(messageSpy).toHaveBeenCalled();
    });

    it('should log debug for non-Teams channel but not ignore it', async () => {
      const { logger } = require('../../src/utils/logger.js');
      const activity = makeActivity({ channelId: 'webchat' });

      await channel.handleActivity(activity);

      expect(logger.debug).toHaveBeenCalledWith(
        'Teams: ignoring activity from non-Teams channel',
        { channelId: 'webchat' }
      );
    });
  });

  // ==========================================================================
  // Message Activity
  // ==========================================================================

  describe('message activity', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should emit message event for incoming message', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity({ text: 'Hello bot!' }));

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const msg = messageSpy.mock.calls[0][0];
      expect(msg.content).toBe('Hello bot!');
      expect(msg.channel.type).toBe('teams');
      expect(msg.channel.id).toBe('conv-1');
      expect(msg.sender.id).toBe('user-1');
      expect(msg.sender.displayName).toBe('Test User');
    });

    it('should emit command event for slash commands', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      await channel.handleActivity(makeActivity({ text: '/help me please' }));

      expect(commandSpy).toHaveBeenCalledTimes(1);
      const msg = commandSpy.mock.calls[0][0];
      expect(msg.isCommand).toBe(true);
      expect(msg.commandName).toBe('help');
      expect(msg.commandArgs).toEqual(['me', 'please']);
    });

    it('should set correct contentType for text', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity({ text: 'regular text' }));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.contentType).toBe('text');
    });

    it('should set contentType to command for slash messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity({ text: '/status' }));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.contentType).toBe('command');
    });

    it('should set correct contentType when attachments exist', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          text: 'See this image',
          attachments: [
            { contentType: 'image/png', contentUrl: 'https://example.com/img.png', name: 'img.png' },
          ],
        })
      );

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.contentType).toBe('image');
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0].type).toBe('image');
      expect(msg.attachments[0].url).toBe('https://example.com/img.png');
      expect(msg.attachments[0].fileName).toBe('img.png');
    });

    it('should filter out attachments without contentUrl', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          text: 'Test',
          attachments: [
            { contentType: 'application/vnd.microsoft.card.hero', content: {} }, // no contentUrl
            { contentType: 'image/jpeg', contentUrl: 'https://example.com/photo.jpg' },
          ],
        })
      );

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0].mimeType).toBe('image/jpeg');
    });

    it('should handle missing text gracefully', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity({ text: undefined }));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.content).toBe('');
    });

    it('should use activity.id or fallback id', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity({ id: 'custom-id-123' }));
      expect(messageSpy.mock.calls[0][0].id).toBe('custom-id-123');

      await channel.handleActivity(makeActivity({ id: undefined }));
      expect(messageSpy.mock.calls[1][0].id).toMatch(/^teams-\d+$/);
    });

    it('should detect DM vs group conversations', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      // DM (personal conversation)
      await channel.handleActivity(
        makeActivity({
          conversation: makeConversation({ isGroup: false, conversationType: 'personal' }),
        })
      );

      let msg = messageSpy.mock.calls[0][0];
      expect(msg.channel.isDM).toBe(true);
      expect(msg.channel.isGroup).toBe(false);

      // Group chat
      await channel.handleActivity(
        makeActivity({
          conversation: makeConversation({ isGroup: true, conversationType: 'groupChat' }),
        })
      );

      msg = messageSpy.mock.calls[1][0];
      expect(msg.channel.isDM).toBe(false);
      expect(msg.channel.isGroup).toBe(true);

      // Channel conversation (detected by conversationType)
      await channel.handleActivity(
        makeActivity({
          conversation: makeConversation({ conversationType: 'channel' }),
        })
      );

      msg = messageSpy.mock.calls[2][0];
      expect(msg.channel.isDM).toBe(false);
      expect(msg.channel.isGroup).toBe(true);
    });

    it('should set sessionKey on inbound message', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity());

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.sessionKey).toBe('teams:conv-1:user-1');
    });

    it('should include replyToId when present', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity({ replyToId: 'parent-msg-1' }));

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.replyTo).toBe('parent-msg-1');
    });

    it('should include raw activity', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const activity = makeActivity();
      await channel.handleActivity(activity);

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.raw).toBe(activity);
    });

    it('should update lastActivity timestamp', async () => {
      await channel.handleActivity(makeActivity());

      expect(channel.getStatus().lastActivity).toBeDefined();
      expect(channel.getStatus().lastActivity).toBeInstanceOf(Date);
    });

    it('should not emit message if from or conversation is missing', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity({ type: 'message', text: 'test' });
      // Even though handleActivity is called, handleMessageActivity returns early
      // Note: storeConversationReference won't fire either since from/conversation missing
      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should detect bot sender', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          from: makeAccount({ id: 'bot-user', name: 'Another Bot', role: 'bot' }),
        })
      );

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.sender.isBot).toBe(true);
    });
  });

  // ==========================================================================
  // @Mention Stripping
  // ==========================================================================

  describe('@mention stripping', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should strip bot @mention from message text', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          text: '<at>Test Bot</at> Hello there!',
          recipient: makeAccount({ id: 'bot-1', name: 'Test Bot' }),
          entities: [
            {
              type: 'mention',
              mentioned: { id: 'bot-1', name: 'Test Bot' },
              text: '<at>Test Bot</at>',
            },
          ],
        })
      );

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.content).toBe('Hello there!');
    });

    it('should not strip mentions of other users', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          text: '<at>Other User</at> Hello!',
          recipient: makeAccount({ id: 'bot-1', name: 'Test Bot' }),
          entities: [
            {
              type: 'mention',
              mentioned: { id: 'other-user', name: 'Other User' },
              text: '<at>Other User</at>',
            },
          ],
        })
      );

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.content).toBe('<at>Other User</at> Hello!');
    });

    it('should handle multiple mentions and only strip bot mention', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          text: '<at>Test Bot</at> please help <at>Alice</at>',
          recipient: makeAccount({ id: 'bot-1', name: 'Test Bot' }),
          entities: [
            {
              type: 'mention',
              mentioned: { id: 'bot-1', name: 'Test Bot' },
              text: '<at>Test Bot</at>',
            },
            {
              type: 'mention',
              mentioned: { id: 'alice-1', name: 'Alice' },
              text: '<at>Alice</at>',
            },
          ],
        })
      );

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.content).toBe('please help <at>Alice</at>');
    });

    it('should handle entities that are not mentions', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          text: 'Hello!',
          entities: [{ type: 'clientInfo' }],
        })
      );

      const msg = messageSpy.mock.calls[0][0];
      expect(msg.content).toBe('Hello!');
    });
  });

  // ==========================================================================
  // User / Channel Filtering
  // ==========================================================================

  describe('user and channel filtering', () => {
    it('should not emit message for disallowed user', async () => {
      channel = new TeamsChannel({ ...baseConfig, allowedUsers: ['user-allowed'] });
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({ from: makeAccount({ id: 'user-denied' }) })
      );

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should emit message for allowed user', async () => {
      channel = new TeamsChannel({ ...baseConfig, allowedUsers: ['user-1'] });
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity());

      expect(messageSpy).toHaveBeenCalled();
    });

    it('should allow all users when allowedUsers is empty', async () => {
      const messageSpy = jest.fn();

      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
      channel.on('message', messageSpy);

      await channel.handleActivity(makeActivity());

      expect(messageSpy).toHaveBeenCalled();
    });

    it('should not emit message for disallowed channel', async () => {
      channel = new TeamsChannel({ ...baseConfig, allowedChannels: ['conv-allowed'] });
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({ conversation: makeConversation({ id: 'conv-denied' }) })
      );

      expect(messageSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // DM Pairing
  // ==========================================================================

  describe('DM pairing', () => {
    it('should block message when pairing is not approved and send pairing message', async () => {
      // Override checkDMPairing to return not approved
      const dmPairingModule = require('../../src/channels/dm-pairing.js');
      const mockPairingManager = {
        requiresPairing: jest.fn(() => true),
        checkSender: jest.fn(() => ({
          approved: false,
          senderId: 'user-1',
          channelType: 'teams',
          code: 'ABC123',
        })),
        getPairingMessage: jest.fn(() => 'Please pair with code: ABC123'),
      };
      dmPairingModule.getDMPairing.mockReturnValue(mockPairingManager);

      channel = new TeamsChannel(baseConfig);
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      // The activity for DM
      const activity = makeActivity({
        conversation: makeConversation({ isGroup: false, conversationType: 'personal' }),
      });
      await channel.handleActivity(activity);

      // Store ref first, then send pairing message requires another API call
      // But since pairing is rejected, message event should not fire
      expect(messageSpy).not.toHaveBeenCalled();

      // Restore
      dmPairingModule.getDMPairing.mockReturnValue({
        requiresPairing: jest.fn(() => false),
        checkSender: jest.fn(() => ({ approved: true, senderId: 'user-1', channelType: 'teams' })),
        getPairingMessage: jest.fn(() => null),
      });
    });
  });

  // ==========================================================================
  // Conversation Update Activity
  // ==========================================================================

  describe('conversationUpdate activity', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should handle conversationUpdate activity without error', async () => {
      const { logger } = require('../../src/utils/logger.js');

      await channel.handleActivity(
        makeActivity({
          type: 'conversationUpdate',
          channelData: { eventType: 'teamMemberAdded' },
        })
      );

      expect(logger.debug).toHaveBeenCalledWith(
        'Teams: conversation update',
        expect.objectContaining({ conversationId: 'conv-1' })
      );
    });

    it('should store conversation reference from conversationUpdate', async () => {
      await channel.handleActivity(
        makeActivity({ type: 'conversationUpdate' })
      );

      expect(channel.getConversationReference('conv-1')).toBeDefined();
    });
  });

  // ==========================================================================
  // Invoke Activity (Adaptive Card Actions)
  // ==========================================================================

  describe('invoke activity', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should emit command event for adaptive card action', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      await channel.handleActivity(
        makeActivity({
          type: 'invoke',
          name: 'adaptiveCard/action',
          value: { action: 'submit', data: 'test-value' },
        })
      );

      expect(commandSpy).toHaveBeenCalledTimes(1);
      const msg = commandSpy.mock.calls[0][0];
      expect(msg.isCommand).toBe(true);
      expect(msg.commandName).toBe('card_action');
      expect(msg.content).toBe(JSON.stringify({ action: 'submit', data: 'test-value' }));
      expect(msg.commandArgs).toEqual(['action=submit', 'data=test-value']);
    });

    it('should not emit command for invoke without value', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      await channel.handleActivity(
        makeActivity({
          type: 'invoke',
          name: 'adaptiveCard/action',
          value: undefined,
        })
      );

      expect(commandSpy).not.toHaveBeenCalled();
    });

    it('should not emit command for non-adaptive-card invoke', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      await channel.handleActivity(
        makeActivity({
          type: 'invoke',
          name: 'composeExtension/query',
          value: { queryText: 'search' },
        })
      );

      expect(commandSpy).not.toHaveBeenCalled();
    });

    it('should not process invoke without from or conversation', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      await channel.handleActivity({
        type: 'invoke',
        name: 'adaptiveCard/action',
        value: { action: 'submit' },
      });

      expect(commandSpy).not.toHaveBeenCalled();
    });

    it('should set sessionKey on invoke command', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      await channel.handleActivity(
        makeActivity({
          type: 'invoke',
          name: 'adaptiveCard/action',
          value: { action: 'click' },
        })
      );

      const msg = commandSpy.mock.calls[0][0];
      expect(msg.sessionKey).toBe('teams:conv-1:user-1');
    });
  });

  // ==========================================================================
  // messageReaction Activity
  // ==========================================================================

  describe('messageReaction activity', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should handle messageReaction activity without error', async () => {
      // messageReaction is a no-op but should not throw
      await expect(
        channel.handleActivity(makeActivity({ type: 'messageReaction' }))
      ).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // Event Activity
  // ==========================================================================

  describe('event activity', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should log debug for event activity', async () => {
      const { logger } = require('../../src/utils/logger.js');

      await channel.handleActivity(
        makeActivity({ type: 'event', name: 'tokens/response' })
      );

      expect(logger.debug).toHaveBeenCalledWith('Teams: event activity', { name: 'tokens/response' });
    });
  });

  // ==========================================================================
  // Unknown Activity Type
  // ==========================================================================

  describe('unknown activity type', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should log debug for unhandled activity types', async () => {
      const { logger } = require('../../src/utils/logger.js');

      await channel.handleActivity(makeActivity({ type: 'installationUpdate' }));

      expect(logger.debug).toHaveBeenCalledWith('Teams: unhandled activity type', {
        type: 'installationUpdate',
      });
    });
  });

  // ==========================================================================
  // Proactive Messaging
  // ==========================================================================

  describe('proactive messaging', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
      await channel.handleActivity(makeActivity());
    });

    it('should send proactive message to known conversation', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'proactive-msg-1' }));

      const result = await channel.sendProactive('conv-1', 'Proactive hello!');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('proactive-msg-1');
    });

    it('should fail proactive message to unknown conversation', async () => {
      const result = await channel.sendProactive('unknown-conv', 'Hello?');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No conversation reference found');
    });

    it('should get stored conversation reference', () => {
      const ref = channel.getConversationReference('conv-1');
      expect(ref).toBeDefined();
      expect(ref?.conversation.id).toBe('conv-1');
      expect(ref?.user.id).toBe('user-1');
      expect(ref?.bot.id).toBe('bot-1');
    });

    it('should return undefined for unknown conversation reference', () => {
      expect(channel.getConversationReference('unknown')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Typing Indicators
  // ==========================================================================

  describe('typing indicators', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
      await channel.handleActivity(makeActivity());
    });

    it('should send typing indicator', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({}));

      await channel.sendTyping('conv-1');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.type).toBe('typing');
    });

    it('should silently ignore typing for unknown conversation', async () => {
      // Should not throw
      await expect(channel.sendTyping('unknown-conv')).resolves.toBeUndefined();
    });

    it('should silently ignore typing errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('typing failed'));

      // Should not throw
      await expect(channel.sendTyping('conv-1')).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // Update / Delete Message
  // ==========================================================================

  describe('updateMessage', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
      await channel.handleActivity(makeActivity());
    });

    it('should update a message', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({}));

      await channel.updateMessage('conv-1', 'activity-123', 'Updated text');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toContain('/v3/conversations/conv-1/activities/activity-123');
      expect(lastCall[1].method).toBe('PUT');
      const body = JSON.parse(lastCall[1].body);
      expect(body.text).toBe('Updated text');
      expect(body.id).toBe('activity-123');
      expect(body.type).toBe('message');
    });

    it('should throw when conversation reference is not found', async () => {
      await expect(
        channel.updateMessage('unknown-conv', 'activity-123', 'Update')
      ).rejects.toThrow('No conversation reference for unknown-conv');
    });
  });

  describe('deleteMessage', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
      await channel.handleActivity(makeActivity());
    });

    it('should delete a message', async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({}));

      await channel.deleteMessage('conv-1', 'activity-456');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toContain('/v3/conversations/conv-1/activities/activity-456');
      expect(lastCall[1].method).toBe('DELETE');
    });

    it('should throw when conversation reference is not found', async () => {
      await expect(
        channel.deleteMessage('unknown-conv', 'activity-456')
      ).rejects.toThrow('No conversation reference for unknown-conv');
    });
  });

  // ==========================================================================
  // MIME Type Mapping
  // ==========================================================================

  describe('mimeToContentType', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should map image MIME types', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          attachments: [{ contentType: 'image/png', contentUrl: 'https://example.com/img.png' }],
        })
      );

      expect(messageSpy.mock.calls[0][0].attachments[0].type).toBe('image');
    });

    it('should map audio MIME types', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          attachments: [{ contentType: 'audio/mp3', contentUrl: 'https://example.com/a.mp3' }],
        })
      );

      expect(messageSpy.mock.calls[0][0].attachments[0].type).toBe('audio');
    });

    it('should map video MIME types', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          attachments: [{ contentType: 'video/mp4', contentUrl: 'https://example.com/v.mp4' }],
        })
      );

      expect(messageSpy.mock.calls[0][0].attachments[0].type).toBe('video');
    });

    it('should default to file for unknown MIME types', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleActivity(
        makeActivity({
          attachments: [
            { contentType: 'application/pdf', contentUrl: 'https://example.com/doc.pdf' },
          ],
        })
      );

      expect(messageSpy.mock.calls[0][0].attachments[0].type).toBe('file');
    });
  });

  // ==========================================================================
  // API Request Helpers
  // ==========================================================================

  describe('apiRequest response parsing', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
      await channel.handleActivity(makeActivity());
    });

    it('should handle empty response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/plain' },
        text: () => Promise.resolve(''),
        json: () => Promise.reject(new Error('empty')),
      });

      // send() calls apiRequest internally
      const result = await channel.send({ channelId: 'conv-1', content: 'Test' });
      // Empty text returns {} as T, which has no .id, so messageId is undefined
      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
    });

    it('should handle non-JSON text response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/plain' },
        text: () => Promise.resolve('OK'),
        json: () => Promise.reject(new Error('not json')),
      });

      const result = await channel.send({ channelId: 'conv-1', content: 'Test' });
      expect(result.success).toBe(true);
    });

    it('should strip trailing slash from serviceUrl', async () => {
      // Store a ref with trailing slash (already done via makeActivity which has trailing slash)
      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({ channelId: 'conv-1', content: 'Test' });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      // Should not have double slash
      expect(lastCall[0]).toBe(
        'https://smba.trafficmanager.net/teams/v3/conversations/conv-1/activities'
      );
    });

    it('should URL-encode conversation ID in API requests', async () => {
      // Create a conversation ref with special characters
      await channel.handleActivity(
        makeActivity({
          conversation: makeConversation({ id: 'conv with spaces/special' }),
        })
      );

      mockFetch.mockResolvedValueOnce(mockApiResponse({ id: 'msg-1' }));

      await channel.send({ channelId: 'conv with spaces/special', content: 'Test' });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toContain(encodeURIComponent('conv with spaces/special'));
    });
  });

  // ==========================================================================
  // Conversation Reference Storage
  // ==========================================================================

  describe('conversation reference storage', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await channel.connect();
    });

    it('should store default channelId as msteams when channelId is missing', async () => {
      await channel.handleActivity(
        makeActivity({ channelId: undefined })
      );

      const ref = channel.getConversationReference('conv-1');
      expect(ref?.channelId).toBe('msteams');
    });

    it('should track service URLs', async () => {
      await channel.handleActivity(
        makeActivity({ serviceUrl: 'https://service1.example.com/' })
      );
      await channel.handleActivity(
        makeActivity({
          conversation: makeConversation({ id: 'conv-2' }),
          serviceUrl: 'https://service2.example.com/',
        })
      );

      // Both refs should be stored
      expect(channel.getConversationReference('conv-1')).toBeDefined();
      expect(channel.getConversationReference('conv-2')).toBeDefined();
    });

    it('should update conversation reference when new activity arrives for same conversation', async () => {
      await channel.handleActivity(
        makeActivity({ id: 'activity-1' })
      );

      let ref = channel.getConversationReference('conv-1');
      expect(ref?.activityId).toBe('activity-1');

      await channel.handleActivity(
        makeActivity({ id: 'activity-2' })
      );

      ref = channel.getConversationReference('conv-1');
      expect(ref?.activityId).toBe('activity-2');
    });
  });
});
