/**
 * Signal Channel Tests
 *
 * Tests for the Signal channel adapter that communicates
 * with a signal-cli REST API instance.
 */

import { SignalChannel } from '../../src/channels/signal/index.js';
import type {
  SignalConfig,
  SignalMessage,
  SignalGroup,
} from '../../src/channels/signal/index.js';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock dm-pairing module (dynamically imported in handleIncoming)
jest.mock('../../src/channels/dm-pairing.js', () => ({
  getDMPairing: jest.fn(() => ({
    requiresPairing: jest.fn(() => false),
    checkSender: jest.fn(() => ({ approved: true, senderId: '', channelType: 'signal' })),
    getPairingMessage: jest.fn(() => null),
  })),
}));

// Mock session-isolation module (used by getSessionKey)
jest.mock('../../src/channels/session-isolation.js', () => ({
  getSessionIsolator: jest.fn(() => ({
    getSessionKey: jest.fn(() => 'signal:+15551234567'),
  })),
}));

// Mock identity-links module (used by getCanonicalIdentity)
jest.mock('../../src/channels/identity-links.js', () => ({
  getIdentityLinker: jest.fn(() => ({
    resolve: jest.fn(() => null),
  })),
}));

// Mock peer-routing module (used by resolveRoute)
jest.mock('../../src/channels/peer-routing.js', () => ({
  getPeerRouter: jest.fn(() => ({
    resolve: jest.fn(() => null),
    getAgentConfig: jest.fn(() => ({})),
  })),
}));

// Mock concurrency/lane-queue module
jest.mock('../../src/concurrency/lane-queue.js', () => ({
  LaneQueue: jest.fn(() => ({
    enqueue: jest.fn((_, fn) => fn()),
    clear: jest.fn(),
  })),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Helper to build a mock fetch response
function mockJsonResponse(body: unknown, status = 200): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function mockTextResponse(text: string, status = 200): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/plain' }),
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  };
}

function mockErrorResponse(status: number, text: string): Partial<Response> {
  return {
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'text/plain' }),
    text: () => Promise.resolve(text),
  };
}

// Default config
const defaultConfig: SignalConfig = {
  type: 'signal',
  enabled: true,
  phoneNumber: '+15551234567',
  pollInterval: 50, // fast polling for tests
};

// Helper to create a basic SignalMessage
function makeSignalMessage(overrides: Partial<SignalMessage> = {}): SignalMessage {
  return {
    envelope: {
      source: '+15559876543',
      sourceNumber: '+15559876543',
      sourceName: 'Alice',
      sourceUuid: 'uuid-alice',
      timestamp: Date.now(),
      dataMessage: {
        timestamp: Date.now(),
        message: 'Hello from Signal!',
      },
    },
    account: '+15551234567',
    ...overrides,
  };
}

/**
 * URL-based mock router for fetch.
 *
 * This approach avoids the fragile mockResolvedValueOnce queue which
 * breaks when fire-and-forget async polling leaks between tests.
 * Instead, responses are mapped by URL pattern and consumed when matched.
 */
interface MockRoute {
  pattern: string | RegExp;
  response: Partial<Response> | (() => Promise<Partial<Response>>);
  once?: boolean;
  consumed?: boolean;
}

let mockRoutes: MockRoute[] = [];
let defaultRoute: Partial<Response> = mockJsonResponse([]);

function setMockRoutes(routes: MockRoute[]): void {
  mockRoutes = routes;
}

function setDefaultRoute(response: Partial<Response>): void {
  defaultRoute = response;
}

function installRouteBasedMock(): void {
  mockFetch.mockImplementation((url: string) => {
    for (const route of mockRoutes) {
      if (route.once && route.consumed) continue;

      const matches = typeof route.pattern === 'string'
        ? url.includes(route.pattern)
        : route.pattern.test(url);

      if (matches) {
        if (route.once) route.consumed = true;
        if (typeof route.response === 'function') {
          return route.response();
        }
        return Promise.resolve(route.response);
      }
    }
    // Default: return empty array (safe for polling)
    return Promise.resolve(defaultRoute);
  });
}

/**
 * Set up URL-based mocks for the connect() sequence:
 * 1. GET /v1/about
 * 2. GET /v1/accounts/:number
 * 3. GET /v1/groups/:number (loadGroups)
 * 4. GET /v1/receive/:number (first poll - with provided messages)
 *
 * Subsequent polls hit the default route (empty array).
 */
function setupConnectMocks(
  firstPollMessages: SignalMessage[] = [],
  groups: SignalGroup[] = [],
): void {
  setMockRoutes([
    { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
    { pattern: '/v1/accounts/', response: mockJsonResponse({ number: '+15551234567' }) },
    { pattern: '/v1/groups/', response: mockJsonResponse(groups) },
    {
      pattern: '/v1/receive/',
      response: mockJsonResponse(firstPollMessages),
      once: true, // Only the first poll gets the test messages
    },
  ]);
}

/**
 * Connect the channel and wait for the first poll to complete.
 */
async function connectAndWaitForPoll(ch: SignalChannel): Promise<void> {
  await ch.connect();
  for (let i = 0; i < 20; i++) {
    await jest.advanceTimersByTimeAsync(0);
  }
}

describe('SignalChannel', () => {
  let channel: SignalChannel;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    channel = new SignalChannel(defaultConfig);
    mockRoutes = [];
    defaultRoute = mockJsonResponse([]);
    installRouteBasedMock();
  });

  afterEach(async () => {
    await channel.disconnect();
    for (let i = 0; i < 10; i++) {
      await jest.advanceTimersByTimeAsync(0);
    }
    jest.useRealTimers();
  });

  // ==========================================================================
  // Constructor / Config Defaults
  // ==========================================================================

  describe('constructor', () => {
    it('should create a channel with type signal', () => {
      expect(channel.type).toBe('signal');
      expect(channel.getStatus().type).toBe('signal');
    });

    it('should throw error when phoneNumber is missing', () => {
      expect(() => {
        new SignalChannel({ type: 'signal', enabled: true, phoneNumber: '' });
      }).toThrow('Signal phone number is required');
    });

    it('should default apiUrl to http://localhost:8080', () => {
      const ch = new SignalChannel({ type: 'signal', enabled: true, phoneNumber: '+10000000000' });
      expect(ch).toBeDefined();
    });

    it('should default pollInterval to 2000', () => {
      const ch = new SignalChannel({ type: 'signal', enabled: true, phoneNumber: '+10000000000' });
      expect(ch).toBeDefined();
    });

    it('should accept custom apiUrl', () => {
      const ch = new SignalChannel({
        type: 'signal',
        enabled: true,
        phoneNumber: '+10000000000',
        apiUrl: 'http://signal-api:9090',
      });
      expect(ch).toBeDefined();
    });

    it('should accept custom pollInterval', () => {
      const ch = new SignalChannel({
        type: 'signal',
        enabled: true,
        phoneNumber: '+10000000000',
        pollInterval: 5000,
      });
      expect(ch).toBeDefined();
    });
  });

  // ==========================================================================
  // Connect / Disconnect Lifecycle
  // ==========================================================================

  describe('connect', () => {
    it('should connect successfully and update status', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      const status = channel.getStatus();
      expect(status.connected).toBe(true);
      expect(status.authenticated).toBe(true);
      expect(status.info?.phoneNumber).toBe('+15551234567');
      expect(status.info?.apiUrl).toBe('http://localhost:8080');
    });

    it('should emit connected event on success', async () => {
      setupConnectMocks();
      const spy = jest.fn();
      channel.on('connected', spy);

      await connectAndWaitForPoll(channel);

      expect(spy).toHaveBeenCalledWith('signal');
    });

    it('should call /v1/about to verify API is reachable', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/about',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should try /v1/accounts/:number to verify registration', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      const encodedNumber = encodeURIComponent('+15551234567');
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:8080/v1/accounts/${encodedNumber}`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should fall back to /v1/health when /v1/accounts fails', async () => {
      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockErrorResponse(404, 'Not Found') },
        { pattern: '/v1/health', response: mockJsonResponse({ status: 'ok' }) },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        { pattern: '/v1/receive/', response: mockJsonResponse([]), once: true },
      ]);

      await connectAndWaitForPoll(channel);

      expect(channel.getStatus().connected).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should set trust_mode when trustAllIdentities is true', async () => {
      const ch = new SignalChannel({
        ...defaultConfig,
        trustAllIdentities: true,
      });

      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockJsonResponse({ number: '+15551234567' }) },
        { pattern: '/v1/configuration/', response: mockJsonResponse({}) },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        { pattern: '/v1/receive/', response: mockJsonResponse([]), once: true },
      ]);

      await connectAndWaitForPoll(ch);

      const encodedNumber = encodeURIComponent('+15551234567');
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:8080/v1/configuration/${encodedNumber}/settings`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ trust_mode: 'always' }),
        }),
      );

      await ch.disconnect();
    });

    it('should handle connection error and emit error event', async () => {
      channel.on('error', () => {}); // prevent unhandled
      setMockRoutes([]);
      mockFetch.mockImplementation(() => Promise.reject(new Error('Connection refused')));

      await expect(channel.connect()).rejects.toThrow('Connection refused');

      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.error).toBe('Connection refused');
    });

    it('should emit error event on connection failure', async () => {
      const errorSpy = jest.fn();
      channel.on('error', errorSpy);
      setMockRoutes([]);
      mockFetch.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));

      await expect(channel.connect()).rejects.toThrow();

      expect(errorSpy).toHaveBeenCalledWith('signal', expect.any(Error));
    });

    it('should pre-load groups into cache during connect', async () => {
      const groups: SignalGroup[] = [
        { id: 'group123abc', name: 'Test Group', members: ['+15551234567', '+15559876543'] },
      ];
      setupConnectMocks([], groups);
      await connectAndWaitForPoll(channel);

      const encodedNumber = encodeURIComponent('+15551234567');
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:8080/v1/groups/${encodedNumber}`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should use custom apiUrl when configured', async () => {
      const ch = new SignalChannel({
        ...defaultConfig,
        apiUrl: 'http://signal-api:9090/',
      });

      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        { pattern: '/v1/receive/', response: mockJsonResponse([]), once: true },
      ]);

      await connectAndWaitForPoll(ch);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://signal-api:9090/v1/about',
        expect.anything(),
      );

      await ch.disconnect();
    });
  });

  describe('disconnect', () => {
    it('should update status on disconnect', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      await channel.disconnect();

      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    it('should emit disconnected event', async () => {
      const spy = jest.fn();
      channel.on('disconnected', spy);

      await channel.disconnect();

      expect(spy).toHaveBeenCalledWith('signal');
    });

    it('should stop polling after disconnect', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      // Clear call history
      mockFetch.mockClear();
      // Re-install route mock
      installRouteBasedMock();

      await channel.disconnect();

      // Advance timers - no new polling calls should be made
      jest.advanceTimersByTime(5000);

      const receiveCalls = mockFetch.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('/v1/receive/'),
      );
      expect(receiveCalls.length).toBe(0);
    });

    it('should clear group cache on disconnect', async () => {
      const groups: SignalGroup[] = [
        { id: 'g1', name: 'G1', members: [] },
      ];
      setupConnectMocks([], groups);
      await connectAndWaitForPoll(channel);

      await channel.disconnect();

      expect(channel.getStatus().connected).toBe(false);
    });
  });

  // ==========================================================================
  // Send Messages
  // ==========================================================================

  describe('send', () => {
    beforeEach(async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);
    });

    it('should send a text message to a direct recipient', async () => {
      // Override the default route for the send endpoint
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockJsonResponse({ timestamp: '1234567890' }) },
      ]);

      const result = await channel.send({
        channelId: '+15559876543',
        content: 'Hello Signal!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('1234567890');

      const sendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v2/send'),
      );
      expect(sendCall).toBeDefined();
      const body = JSON.parse(sendCall![1].body);
      expect(body.message).toBe('Hello Signal!');
      expect(body.number).toBe('+15551234567');
      expect(body.recipients).toEqual(['+15559876543']);
    });

    it('should send a message to a group', async () => {
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockJsonResponse({ timestamp: 9999 }) },
      ]);

      const groupId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop==';
      const result = await channel.send({
        channelId: groupId,
        content: 'Group message!',
      });

      expect(result.success).toBe(true);

      const sendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v2/send'),
      );
      const body = JSON.parse(sendCall![1].body);
      expect(body.group_id).toBe(groupId);
      expect(body.recipients).toEqual([]);
    });

    it('should include attachments as base64_attachments', async () => {
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockJsonResponse({ timestamp: 1111 }) },
      ]);

      const result = await channel.send({
        channelId: '+15559876543',
        content: 'Check this out',
        attachments: [
          {
            type: 'image',
            fileName: 'photo.png',
            mimeType: 'image/png',
            data: 'iVBORw0KGgo=',
          },
        ],
      });

      expect(result.success).toBe(true);

      const sendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v2/send'),
      );
      const body = JSON.parse(sendCall![1].body);
      expect(body.base64_attachments).toHaveLength(1);
      expect(body.base64_attachments[0].filename).toBe('photo.png');
      expect(body.base64_attachments[0].content_type).toBe('image/png');
      expect(body.base64_attachments[0].data).toBe('iVBORw0KGgo=');
    });

    it('should filter out attachments without data', async () => {
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockJsonResponse({ timestamp: 2222 }) },
      ]);

      await channel.send({
        channelId: '+15559876543',
        content: 'File ref',
        attachments: [
          { type: 'file', fileName: 'no-data.txt' },
          { type: 'image', data: 'base64data', mimeType: 'image/jpeg' },
        ],
      });

      const sendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v2/send'),
      );
      const body = JSON.parse(sendCall![1].body);
      expect(body.base64_attachments).toHaveLength(1);
    });

    it('should include quote_timestamp for replies', async () => {
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockJsonResponse({ timestamp: 3333 }) },
      ]);

      await channel.send({
        channelId: '+15559876543',
        content: 'Replying',
        replyTo: '999888777',
      });

      const sendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v2/send'),
      );
      const body = JSON.parse(sendCall![1].body);
      expect(body.quote_timestamp).toBe(999888777);
    });

    it('should set text_mode to normal for plain parseMode', async () => {
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockJsonResponse({ timestamp: 4444 }) },
      ]);

      await channel.send({
        channelId: '+15559876543',
        content: 'Plain text',
        parseMode: 'plain',
      });

      const sendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v2/send'),
      );
      const body = JSON.parse(sendCall![1].body);
      expect(body.text_mode).toBe('normal');
    });

    it('should return failure when not connected', async () => {
      await channel.disconnect();

      const result = await channel.send({
        channelId: '+15559876543',
        content: 'Should fail',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Signal not connected');
    });

    it('should handle send API errors gracefully', async () => {
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockErrorResponse(500, 'Internal Server Error') },
      ]);

      const result = await channel.send({
        channelId: '+15559876543',
        content: 'Error test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Signal API error');
    });

    it('should use Date.now() as messageId when timestamp not in response', async () => {
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockJsonResponse({}) },
      ]);

      const before = Date.now();
      const result = await channel.send({
        channelId: '+15559876543',
        content: 'No timestamp in response',
      });

      expect(result.success).toBe(true);
      expect(Number(result.messageId)).toBeGreaterThanOrEqual(before);
    });
  });

  // ==========================================================================
  // Typing Indicators
  // ==========================================================================

  describe('sendTyping', () => {
    it('should send typing indicator request', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v1/typing-indicator/', response: mockJsonResponse({}) },
      ]);

      await channel.sendTyping('+15559876543');

      const encodedNumber = encodeURIComponent('+15551234567');
      const typingCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('/v1/typing-indicator/'),
      );
      expect(typingCall).toBeDefined();
      expect(typingCall![0]).toBe(
        `http://localhost:8080/v1/typing-indicator/${encodedNumber}`,
      );
      const body = JSON.parse(typingCall![1].body);
      expect(body.recipient).toBe('+15559876543');
    });

    it('should silently handle typing indicator errors', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v1/typing-indicator/', response: mockErrorResponse(500, 'Server error') },
      ]);

      await expect(channel.sendTyping('+15559876543')).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // Reactions
  // ==========================================================================

  describe('react', () => {
    it('should send reaction via API', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v1/reactions/', response: mockJsonResponse({}) },
      ]);

      await channel.react('+15559876543', '+15557777777', 1234567890, '👍');

      const encodedNumber = encodeURIComponent('+15551234567');
      const reactCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('/v1/reactions/'),
      );
      expect(reactCall).toBeDefined();
      expect(reactCall![0]).toBe(
        `http://localhost:8080/v1/reactions/${encodedNumber}`,
      );
      const body = JSON.parse(reactCall![1].body);
      expect(body.recipient).toBe('+15559876543');
      expect(body.reaction.emoji).toBe('👍');
      expect(body.reaction.target_author).toBe('+15557777777');
      expect(body.reaction.target_sent_timestamp).toBe(1234567890);
    });

    it('should silently handle reaction errors', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v1/reactions/', response: mockErrorResponse(500, 'Server error') },
      ]);

      await expect(
        channel.react('+15559876543', '+15557777777', 123, '❤️'),
      ).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // List Groups
  // ==========================================================================

  describe('listGroups', () => {
    it('should return groups from the API', async () => {
      const groups: SignalGroup[] = [
        { id: 'g1', name: 'Group 1', members: ['+15551234567'] },
        { id: 'g2', name: 'Group 2', members: ['+15551234567', '+15559876543'] },
      ];

      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        { pattern: '/v1/groups/', response: mockJsonResponse(groups) },
        { pattern: '/v1/receive/', response: mockJsonResponse([]), once: true },
      ]);

      await connectAndWaitForPoll(channel);

      const result = await channel.listGroups();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Group 1');
      expect(result[1].name).toBe('Group 2');
    });

    it('should return empty array on API error', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      // Override groups route to error
      setMockRoutes([
        { pattern: '/v1/groups/', response: mockErrorResponse(500, 'Server error') },
      ]);

      const result = await channel.listGroups();

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // Polling and Incoming Messages
  // ==========================================================================

  describe('polling', () => {
    it('should start polling on connect and process messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const msg = messageSpy.mock.calls[0][0];
      expect(msg.content).toBe('Hello from Signal!');
      expect(msg.sender.id).toBe('+15559876543');
      expect(msg.sender.displayName).toBe('Alice');
      expect(msg.channel.type).toBe('signal');
      expect(msg.channel.isDM).toBe(true);
    });

    it('should continue polling at the configured interval', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      const receiveCallsBefore = mockFetch.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('/v1/receive/'),
      ).length;

      // Advance by poll interval and flush
      await jest.advanceTimersByTimeAsync(defaultConfig.pollInterval!);
      for (let i = 0; i < 20; i++) await jest.advanceTimersByTimeAsync(0);

      const receiveCallsAfter = mockFetch.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('/v1/receive/'),
      ).length;

      expect(receiveCallsAfter).toBeGreaterThan(receiveCallsBefore);
    });

    it('should handle polling errors gracefully without crashing', async () => {
      let pollCount = 0;
      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        {
          pattern: '/v1/receive/',
          response: () => {
            pollCount++;
            if (pollCount === 1) return Promise.reject(new Error('Transient error'));
            return Promise.resolve(mockJsonResponse([]));
          },
        },
      ]);

      await connectAndWaitForPoll(channel);

      // Channel should still be connected
      expect(channel.getStatus().connected).toBe(true);

      // Advance timer for next poll
      await jest.advanceTimersByTimeAsync(defaultConfig.pollInterval!);
      for (let i = 0; i < 20; i++) await jest.advanceTimersByTimeAsync(0);

      // Should still be running
      expect(channel.getStatus().connected).toBe(true);
    });

    it('should not start polling twice', async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      // Second connect
      setupConnectMocks();
      await connectAndWaitForPoll(channel);

      expect(channel.getStatus().connected).toBe(true);
    });
  });

  // ==========================================================================
  // Message Handling (using first-poll approach)
  // ==========================================================================

  describe('incoming message handling', () => {
    it('should ignore messages with no envelope', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        {
          pattern: '/v1/receive/',
          response: mockJsonResponse([{ account: '+15551234567' }]),
          once: true,
        },
      ]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore messages with no dataMessage and no typingMessage', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([
        {
          envelope: {
            source: '+15559876543',
            sourceNumber: '+15559876543',
            receiptMessage: { type: 'DELIVERY' as const, timestamps: [123] },
          },
        },
      ]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore messages without text and without attachments', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([
        {
          envelope: {
            sourceNumber: '+15559876543',
            dataMessage: {
              timestamp: Date.now(),
            },
          },
        },
      ]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should ignore messages without source number', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([
        {
          envelope: {
            dataMessage: {
              timestamp: Date.now(),
              message: 'Test',
            },
          },
        },
      ]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should process a direct message', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const msg = messageSpy.mock.calls[0][0];
      expect(msg.channel.isDM).toBe(true);
      expect(msg.channel.isGroup).toBe(false);
      expect(msg.channel.id).toBe('+15559876543');
    });

    it('should process a group message', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const groupMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          sourceName: 'Alice',
          timestamp: Date.now(),
          dataMessage: {
            timestamp: Date.now(),
            message: 'Hello group!',
            groupInfo: {
              groupId: 'someGroupId12345678901234567890123456789012',
              type: 'DELIVER',
            },
          },
        },
      };

      setupConnectMocks([groupMsg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const msg = messageSpy.mock.calls[0][0];
      expect(msg.channel.isGroup).toBe(true);
      expect(msg.channel.isDM).toBe(false);
      expect(msg.channel.id).toBe('someGroupId12345678901234567890123456789012');
    });

    it('should emit command event for slash commands', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      const cmdMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          sourceName: 'Alice',
          timestamp: Date.now(),
          dataMessage: {
            timestamp: Date.now(),
            message: '/help arg1 arg2',
          },
        },
      };

      setupConnectMocks([cmdMsg]);

      await connectAndWaitForPoll(channel);

      expect(commandSpy).toHaveBeenCalledTimes(1);
      const msg = commandSpy.mock.calls[0][0];
      expect(msg.isCommand).toBe(true);
      expect(msg.commandName).toBe('help');
      expect(msg.commandArgs).toEqual(['arg1', 'arg2']);
    });

    it('should update lastActivity on message receipt', async () => {
      channel.on('message', jest.fn());

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(channel);

      const status = channel.getStatus();
      expect(status.lastActivity).toBeDefined();
    });

    it('should set message id from dataMessage timestamp', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          sourceName: 'Alice',
          timestamp: 1000,
          dataMessage: {
            timestamp: 2000,
            message: 'Test',
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy.mock.calls[0][0].id).toBe('2000');
    });

    it('should include replyTo when message has a quote', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          sourceName: 'Alice',
          dataMessage: {
            timestamp: Date.now(),
            message: 'Reply to this',
            quote: {
              id: 5555,
              author: '+15557777777',
              text: 'Original message',
            },
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy.mock.calls[0][0].replyTo).toBe('5555');
    });

    it('should include raw message in inbound message', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const rawMsg = makeSignalMessage();
      setupConnectMocks([rawMsg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy.mock.calls[0][0].raw).toBeDefined();
    });

    it('should set sender username and displayName correctly', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          sourceName: 'Bob Smith',
          dataMessage: {
            timestamp: Date.now(),
            message: 'Hi',
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.sender.id).toBe('+15559876543');
      expect(inbound.sender.username).toBe('+15559876543');
      expect(inbound.sender.displayName).toBe('Bob Smith');
    });

    it('should fallback to sourceNumber for displayName when sourceName is absent', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            message: 'Hi',
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy.mock.calls[0][0].sender.displayName).toBe('+15559876543');
    });
  });

  // ==========================================================================
  // Typing Indicator Events
  // ==========================================================================

  describe('incoming typing indicators', () => {
    it('should emit typing event for typing messages', async () => {
      const typingSpy = jest.fn();
      channel.on('typing', typingSpy);

      const typingMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          typingMessage: {
            action: 'STARTED',
            timestamp: Date.now(),
          },
        },
      };

      setupConnectMocks([typingMsg]);

      await connectAndWaitForPoll(channel);

      expect(typingSpy).toHaveBeenCalledTimes(1);
      expect(typingSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: '+15559876543', type: 'signal' }),
        expect.objectContaining({ id: '+15559876543' }),
      );
    });

    it('should use groupId for typing event channel when available', async () => {
      const typingSpy = jest.fn();
      channel.on('typing', typingSpy);

      const typingMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          typingMessage: {
            action: 'STARTED',
            timestamp: Date.now(),
            groupId: 'group123',
          },
        },
      };

      setupConnectMocks([typingMsg]);

      await connectAndWaitForPoll(channel);

      expect(typingSpy).toHaveBeenCalledTimes(1);
      expect(typingSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'group123' }),
        expect.objectContaining({ id: '+15559876543' }),
      );
    });

    it('should not emit message event for typing indicators', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const typingMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          typingMessage: {
            action: 'STARTED',
            timestamp: Date.now(),
          },
        },
      };

      setupConnectMocks([typingMsg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Incoming Reactions
  // ==========================================================================

  describe('incoming reactions', () => {
    it('should emit reaction event for incoming reactions', async () => {
      const reactionSpy = jest.fn();
      channel.on('reaction', reactionSpy);

      const reactionMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            reaction: {
              emoji: '👍',
              targetAuthor: '+15557777777',
              targetSentTimestamp: 12345,
              isRemove: false,
            },
          },
        },
      };

      setupConnectMocks([reactionMsg]);

      await connectAndWaitForPoll(channel);

      expect(reactionSpy).toHaveBeenCalledTimes(1);
      expect(reactionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: '+15559876543', type: 'signal' }),
        '12345',
        '👍',
        expect.objectContaining({ id: '+15559876543' }),
      );
    });

    it('should use groupId in reaction event when available', async () => {
      const reactionSpy = jest.fn();
      channel.on('reaction', reactionSpy);

      const reactionMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            groupInfo: { groupId: 'groupABC' },
            reaction: {
              emoji: '❤️',
              targetAuthor: '+15557777777',
              targetSentTimestamp: 12345,
              isRemove: false,
            },
          },
        },
      };

      setupConnectMocks([reactionMsg]);

      await connectAndWaitForPoll(channel);

      expect(reactionSpy).toHaveBeenCalledTimes(1);
      expect(reactionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'groupABC' }),
        '12345',
        '❤️',
        expect.any(Object),
      );
    });

    it('should not emit reaction event for reaction removals', async () => {
      const reactionSpy = jest.fn();
      channel.on('reaction', reactionSpy);

      const reactionMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            reaction: {
              emoji: '👍',
              targetAuthor: '+15557777777',
              targetSentTimestamp: 12345,
              isRemove: true,
            },
          },
        },
      };

      setupConnectMocks([reactionMsg]);

      await connectAndWaitForPoll(channel);

      expect(reactionSpy).not.toHaveBeenCalled();
    });

    it('should not emit message event for reactions', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const reactionMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            reaction: {
              emoji: '👍',
              targetAuthor: '+15557777777',
              targetSentTimestamp: 12345,
              isRemove: false,
            },
          },
        },
      };

      setupConnectMocks([reactionMsg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Attachment Handling
  // ==========================================================================

  describe('attachment handling', () => {
    it('should convert image attachments', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          sourceName: 'Alice',
          dataMessage: {
            timestamp: Date.now(),
            message: 'Photo',
            attachments: [
              {
                contentType: 'image/jpeg',
                filename: 'photo.jpg',
                id: 'att-123',
                size: 50000,
                width: 1920,
                height: 1080,
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('image');
      expect(inbound.attachments).toHaveLength(1);
      expect(inbound.attachments[0].type).toBe('image');
      expect(inbound.attachments[0].fileName).toBe('photo.jpg');
      expect(inbound.attachments[0].mimeType).toBe('image/jpeg');
      expect(inbound.attachments[0].size).toBe(50000);
      expect(inbound.attachments[0].width).toBe(1920);
      expect(inbound.attachments[0].height).toBe(1080);
      expect(inbound.attachments[0].url).toBe(
        'http://localhost:8080/v1/attachments/att-123',
      );
    });

    it('should convert voice note attachments', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            attachments: [
              {
                contentType: 'audio/aac',
                id: 'att-voice',
                voiceNote: true,
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('voice');
      expect(inbound.attachments[0].type).toBe('voice');
    });

    it('should convert video attachments', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            attachments: [
              {
                contentType: 'video/mp4',
                id: 'att-video',
                filename: 'clip.mp4',
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('video');
      expect(inbound.attachments[0].type).toBe('video');
    });

    it('should convert audio attachments', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            attachments: [
              {
                contentType: 'audio/mpeg',
                id: 'att-audio',
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('audio');
      expect(inbound.attachments[0].type).toBe('audio');
    });

    it('should default to file type for unknown mime types', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            attachments: [
              {
                contentType: 'application/pdf',
                id: 'att-pdf',
                filename: 'document.pdf',
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.contentType).toBe('file');
      expect(inbound.attachments[0].type).toBe('file');
    });

    it('should handle attachment with caption', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            message: 'Check this',
            attachments: [
              {
                contentType: 'image/png',
                id: 'att-cap',
                caption: 'A nice caption',
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.attachments[0].caption).toBe('A nice caption');
    });

    it('should not set url when attachment has no id', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            attachments: [
              {
                contentType: 'image/png',
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.attachments[0].url).toBeUndefined();
    });

    it('should process messages with only attachments and no text', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          sourceName: 'Alice',
          dataMessage: {
            timestamp: Date.now(),
            attachments: [
              {
                contentType: 'image/jpeg',
                id: 'att-only',
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.content).toBe('');
      expect(inbound.attachments).toHaveLength(1);
    });

    it('should handle attachment without mime type', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            attachments: [
              {
                id: 'att-no-mime',
                filename: 'unknown.bin',
              },
            ],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const inbound = messageSpy.mock.calls[0][0];
      expect(inbound.attachments[0].type).toBe('file');
    });
  });

  // ==========================================================================
  // User / Channel Filtering
  // ==========================================================================

  describe('user and channel filtering', () => {
    it('should filter messages from unauthorized users', async () => {
      const ch = new SignalChannel({
        ...defaultConfig,
        allowedUsers: ['+15551111111'],
      });

      const messageSpy = jest.fn();
      ch.on('message', messageSpy);

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(ch);

      expect(messageSpy).not.toHaveBeenCalled();

      await ch.disconnect();
    });

    it('should allow messages from authorized users', async () => {
      const ch = new SignalChannel({
        ...defaultConfig,
        allowedUsers: ['+15559876543'],
      });

      const messageSpy = jest.fn();
      ch.on('message', messageSpy);

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(ch);

      expect(messageSpy).toHaveBeenCalledTimes(1);

      await ch.disconnect();
    });

    it('should filter messages from unauthorized channels', async () => {
      const ch = new SignalChannel({
        ...defaultConfig,
        allowedChannels: ['allowed-group-only'],
      });

      const messageSpy = jest.fn();
      ch.on('message', messageSpy);

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(ch);

      expect(messageSpy).not.toHaveBeenCalled();

      await ch.disconnect();
    });

    it('should allow all users when allowedUsers is not set', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
    });

    it('should allow all channels when allowedChannels is not set', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Content Type Detection
  // ==========================================================================

  describe('content type detection', () => {
    it('should detect command content type for slash messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            message: '/status',
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy.mock.calls[0][0].contentType).toBe('command');
    });

    it('should detect text content type for regular messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([makeSignalMessage()]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy.mock.calls[0][0].contentType).toBe('text');
    });

    it('should detect image content type from attachment', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const msg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            message: 'photo',
            attachments: [{ contentType: 'image/png', id: 'att1' }],
          },
        },
      };

      setupConnectMocks([msg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy.mock.calls[0][0].contentType).toBe('image');
    });
  });

  // ==========================================================================
  // API Request Handling
  // ==========================================================================

  describe('API request handling', () => {
    it('should handle non-JSON text responses', async () => {
      setMockRoutes([
        {
          pattern: '/v1/about',
          response: mockTextResponse('OK'),
        },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        { pattern: '/v1/receive/', response: mockJsonResponse([]), once: true },
      ]);

      await connectAndWaitForPoll(channel);
      expect(channel.getStatus().connected).toBe(true);
    });

    it('should handle empty text responses', async () => {
      setMockRoutes([
        {
          pattern: '/v1/about',
          response: {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: () => Promise.resolve(''),
          } as Partial<Response>,
        },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        { pattern: '/v1/receive/', response: mockJsonResponse([]), once: true },
      ]);

      await connectAndWaitForPoll(channel);
      expect(channel.getStatus().connected).toBe(true);
    });

    it('should throw on non-OK responses from the API', async () => {
      channel.on('error', () => {}); // prevent unhandled

      setMockRoutes([
        {
          pattern: '/v1/about',
          response: {
            ok: false,
            status: 503,
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: () => Promise.resolve('Service Unavailable'),
          } as Partial<Response>,
        },
      ]);

      await expect(channel.connect()).rejects.toThrow(
        'Signal API error: 503 Service Unavailable',
      );
    });
  });

  // ==========================================================================
  // Group ID Detection
  // ==========================================================================

  describe('group ID detection', () => {
    beforeEach(async () => {
      setupConnectMocks();
      await connectAndWaitForPoll(channel);
      // Add send route
      setMockRoutes([
        ...mockRoutes,
        { pattern: '/v2/send', response: mockJsonResponse({ timestamp: 1 }) },
      ]);
    });

    it('should treat base64-like strings as group IDs when sending', async () => {
      const groupId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop==';
      await channel.send({ channelId: groupId, content: 'test' });

      const sendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v2/send'),
      );
      const body = JSON.parse(sendCall![1].body);
      expect(body.group_id).toBe(groupId);
    });

    it('should treat phone numbers as direct recipients', async () => {
      await channel.send({ channelId: '+15559876543', content: 'test' });

      const sendCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v2/send'),
      );
      const body = JSON.parse(sendCall![1].body);
      expect(body.recipients).toEqual(['+15559876543']);
      expect(body.group_id).toBeUndefined();
    });
  });

  // ==========================================================================
  // Group Cache Integration
  // ==========================================================================

  describe('group cache', () => {
    it('should use cached group name in incoming group messages', async () => {
      const groups: SignalGroup[] = [
        {
          id: 'cachedGroupId1234567890123456789012345678901234',
          name: 'My Cached Group',
          description: 'A cached group',
          members: ['+15551234567', '+15559876543'],
        },
      ];

      const groupMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          sourceName: 'Alice',
          dataMessage: {
            timestamp: Date.now(),
            message: 'Hi group!',
            groupInfo: {
              groupId: 'cachedGroupId1234567890123456789012345678901234',
            },
          },
        },
      };

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      setupConnectMocks([groupMsg], groups);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const msg = messageSpy.mock.calls[0][0];
      expect(msg.channel.name).toBe('My Cached Group');
      expect(msg.channel.description).toBe('A cached group');
      expect(msg.channel.participantCount).toBe(2);
    });

    it('should use groupId as name when group is not in cache', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const groupMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15559876543',
          dataMessage: {
            timestamp: Date.now(),
            message: 'Hi!',
            groupInfo: {
              groupId: 'unknownGroupId1234567890123456789012345678',
            },
          },
        },
      };

      setupConnectMocks([groupMsg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).toHaveBeenCalledTimes(1);
      const msg = messageSpy.mock.calls[0][0];
      expect(msg.channel.name).toBe('unknownGroupId1234567890123456789012345678');
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should handle individual message processing errors without stopping poll loop', async () => {
      const messages = [
        makeSignalMessage({
          envelope: {
            sourceNumber: '+15559876543',
            dataMessage: { timestamp: Date.now(), message: 'msg1' },
          },
        }),
        makeSignalMessage({
          envelope: {
            sourceNumber: '+15559876543',
            dataMessage: { timestamp: Date.now() + 1, message: 'msg2' },
          },
        }),
      ];

      setupConnectMocks(messages);

      const receivedMessages: string[] = [];
      channel.on('message', (msg) => {
        receivedMessages.push(msg.content);
      });

      await connectAndWaitForPoll(channel);

      expect(receivedMessages).toContain('msg1');
      expect(receivedMessages).toContain('msg2');
    });

    it('should handle non-Error objects in error paths', async () => {
      channel.on('error', () => {}); // prevent unhandled

      mockFetch.mockImplementation(() => Promise.reject('string error'));

      await expect(channel.connect()).rejects.toBe('string error');

      const status = channel.getStatus();
      expect(status.error).toBe('string error');
    });

    it('should handle connect failure when trust_mode setting fails', async () => {
      const ch = new SignalChannel({
        ...defaultConfig,
        trustAllIdentities: true,
      });

      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        { pattern: '/v1/configuration/', response: mockErrorResponse(404, 'Not supported') },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        { pattern: '/v1/receive/', response: mockJsonResponse([]), once: true },
      ]);

      await connectAndWaitForPoll(ch);
      expect(ch.getStatus().connected).toBe(true);

      await ch.disconnect();
    });

    it('should handle group loading failure gracefully', async () => {
      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        {
          pattern: '/v1/groups/',
          response: () => Promise.reject(new Error('Groups not available')),
        },
        { pattern: '/v1/receive/', response: mockJsonResponse([]), once: true },
      ]);

      await connectAndWaitForPoll(channel);

      expect(channel.getStatus().connected).toBe(true);
    });
  });

  // ==========================================================================
  // DM Pairing
  // ==========================================================================

  describe('DM pairing integration', () => {
    it('should block messages when DM pairing is not approved', async () => {
      const { getDMPairing } = jest.requireMock('../../src/channels/dm-pairing.js');
      getDMPairing.mockReturnValue({
        requiresPairing: jest.fn(() => true),
        checkSender: jest.fn(() => ({
          approved: false,
          code: 'PAIR123',
          senderId: '+15559876543',
          channelType: 'signal',
        })),
        getPairingMessage: jest.fn(() => 'Please pair with code: PAIR123'),
      });

      setMockRoutes([
        { pattern: '/v1/about', response: mockJsonResponse({ version: '0.60' }) },
        { pattern: '/v1/accounts/', response: mockJsonResponse({}) },
        { pattern: '/v1/groups/', response: mockJsonResponse([]) },
        {
          pattern: '/v1/receive/',
          response: mockJsonResponse([makeSignalMessage()]),
          once: true,
        },
        { pattern: '/v2/send', response: mockJsonResponse({ timestamp: 1 }) },
      ]);

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).not.toHaveBeenCalled();

      // Reset mock to default
      getDMPairing.mockReturnValue({
        requiresPairing: jest.fn(() => false),
        checkSender: jest.fn(() => ({ approved: true, senderId: '', channelType: 'signal' })),
        getPairingMessage: jest.fn(() => null),
      });
    });
  });

  // ==========================================================================
  // Sync Messages
  // ==========================================================================

  describe('sync messages', () => {
    it('should ignore sync messages (no dataMessage)', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const syncMsg: SignalMessage = {
        envelope: {
          sourceNumber: '+15551234567',
          syncMessage: {
            sentMessage: {
              destination: '+15559876543',
              timestamp: Date.now(),
              message: 'Sent from another device',
            },
          },
        },
      };

      setupConnectMocks([syncMsg]);

      await connectAndWaitForPoll(channel);

      expect(messageSpy).not.toHaveBeenCalled();
    });
  });
});
