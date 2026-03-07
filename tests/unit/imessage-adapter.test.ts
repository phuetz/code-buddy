/**
 * Unit tests for IMessageAdapter (BlueBubbles channel adapter)
 * Tests lifecycle, API methods, polling, reconnection, and error handling.
 */

import { IMessageAdapter, IMessageConfig } from '../../src/channels/imessage/index';
import { vi } from 'vitest';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function createConfig(overrides?: Partial<IMessageConfig>): IMessageConfig {
  return {
    serverUrl: 'http://localhost',
    password: 'test-password',
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, status = 200, ok = true): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: jest.fn(),
    body: null,
    bodyUsed: false,
    formData: jest.fn(),
    blob: jest.fn(),
  } as unknown as Response;
}

/**
 * Sets up global.fetch to respond based on URL patterns.
 * Returns the mock function for assertions.
 */
function setupFetchRouter(routes: Record<string, () => Response>): jest.Mock {
  const mockFetch = jest.fn((url: string) => {
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return Promise.resolve(handler());
      }
    }
    return Promise.resolve(mockFetchResponse({ status: 404, message: 'Not found', data: null }, 404, false));
  });
  global.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
}

// ============================================================================
// Tests
// ============================================================================

describe('IMessageAdapter', () => {
  let adapter: IMessageAdapter;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    // Default: all API calls succeed
    mockFetch = setupFetchRouter({
      '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
      '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
    });
    adapter = new IMessageAdapter(createConfig());
  });

  afterEach(async () => {
    // Clean up running adapter
    if (adapter.isRunning()) {
      // Temporarily override fetch for stop cleanup
      await adapter.stop();
    }
    vi.useRealTimers();
    jest.restoreAllMocks();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    it('should apply default config values', () => {
      const config = adapter.getConfig();
      expect(config.serverUrl).toBe('http://localhost');
      expect(config.password).toBe('test-password');
      expect(config.port).toBe(1234);
      expect(config.pollingInterval).toBe(3000);
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelay).toBe(5000);
    });

    it('should allow overriding default values', () => {
      const custom = new IMessageAdapter(createConfig({
        port: 9999,
        pollingInterval: 1000,
        maxRetries: 3,
        retryDelay: 2000,
      }));
      const config = custom.getConfig();
      expect(config.port).toBe(9999);
      expect(config.pollingInterval).toBe(1000);
      expect(config.maxRetries).toBe(3);
      expect(config.retryDelay).toBe(2000);
    });

    it('should return a copy of config from getConfig', () => {
      const config1 = adapter.getConfig();
      const config2 = adapter.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  // ==========================================================================
  // Lifecycle - start()
  // ==========================================================================

  describe('start()', () => {
    it('should connect successfully when health check passes', async () => {
      const connectedHandler = jest.fn();
      adapter.on('connected', connectedHandler);

      await adapter.start();

      expect(adapter.isRunning()).toBe(true);
      expect(connectedHandler).toHaveBeenCalledTimes(1);
      // Should have called health check endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/server/info')
      );
    });

    it('should throw when already running', async () => {
      await adapter.start();
      await expect(adapter.start()).rejects.toThrow('IMessageAdapter is already running');
    });

    it('should throw when health check fails', async () => {
      setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse(null, 503, false),
      });

      await expect(adapter.start()).rejects.toThrow('BlueBubbles server health check failed: 503');
      expect(adapter.isRunning()).toBe(false);
    });

    it('should throw when fetch rejects (network error)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

      await expect(adapter.start()).rejects.toThrow('ECONNREFUSED');
      expect(adapter.isRunning()).toBe(false);
    });
  });

  // ==========================================================================
  // Lifecycle - stop()
  // ==========================================================================

  describe('stop()', () => {
    it('should stop a running adapter', async () => {
      await adapter.start();
      const disconnectedHandler = jest.fn();
      adapter.on('disconnected', disconnectedHandler);

      await adapter.stop();

      expect(adapter.isRunning()).toBe(false);
      expect(disconnectedHandler).toHaveBeenCalledTimes(1);
    });

    it('should throw when not running', async () => {
      await expect(adapter.stop()).rejects.toThrow('IMessageAdapter is not running');
    });
  });

  // ==========================================================================
  // sendMessage()
  // ==========================================================================

  describe('sendMessage()', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    it('should send a message and return the guid', async () => {
      mockFetch = setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message/text': () => mockFetchResponse({
          status: 200,
          message: 'OK',
          data: { guid: 'msg-guid-123' },
        }),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      const result = await adapter.sendMessage('chat-guid-1', 'Hello!');

      expect(result.success).toBe(true);
      expect(result.messageGuid).toBe('msg-guid-123');

      // Verify POST body
      const sendCall = mockFetch.mock.calls.find(
        (call: string[]) => call[0].includes('/api/v1/message/text')
      );
      expect(sendCall).toBeDefined();
      const body = JSON.parse(sendCall![1].body);
      expect(body.chatGuid).toBe('chat-guid-1');
      expect(body.message).toBe('Hello!');
      expect(body.method).toBe('apple-script');
    });

    it('should throw when not running', async () => {
      await adapter.stop();
      await expect(adapter.sendMessage('chat', 'hi')).rejects.toThrow('IMessageAdapter is not running');
    });

    it('should throw when API returns error', async () => {
      setupFetchRouter({
        '/api/v1/message/text': () => mockFetchResponse('Server error', 500, false),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await expect(adapter.sendMessage('chat', 'hi')).rejects.toThrow('BlueBubbles API error: 500');
    });
  });

  // ==========================================================================
  // sendReaction()
  // ==========================================================================

  describe('sendReaction()', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    it('should send a reaction successfully', async () => {
      mockFetch = setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message/react': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      const result = await adapter.sendReaction('chat-1', 'msg-1', 'love');

      expect(result.success).toBe(true);

      const reactCall = mockFetch.mock.calls.find(
        (call: string[]) => call[0].includes('/api/v1/message/react')
      );
      expect(reactCall).toBeDefined();
      const body = JSON.parse(reactCall![1].body);
      expect(body.chatGuid).toBe('chat-1');
      expect(body.selectedMessageGuid).toBe('msg-1');
      expect(body.reaction).toBe('love');
    });

    it('should throw when not running', async () => {
      await adapter.stop();
      await expect(adapter.sendReaction('chat', 'msg', 'like')).rejects.toThrow('IMessageAdapter is not running');
    });
  });

  // ==========================================================================
  // getChats()
  // ==========================================================================

  describe('getChats()', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    it('should return chat list', async () => {
      const chats = [
        { guid: 'chat-1', displayName: 'Alice', participants: ['alice@icloud.com'], lastMessage: 'Hey' },
        { guid: 'chat-2', displayName: 'Bob', participants: ['bob@icloud.com'] },
      ];

      setupFetchRouter({
        '/api/v1/chat': () => mockFetchResponse({ status: 200, message: 'OK', data: chats }),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      const result = await adapter.getChats();
      expect(result).toEqual(chats);
    });

    it('should pass limit and offset query params', async () => {
      mockFetch = setupFetchRouter({
        '/api/v1/chat': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await adapter.getChats(10, 5);

      const chatCall = mockFetch.mock.calls.find(
        (call: string[]) => call[0].includes('/api/v1/chat')
      );
      expect(chatCall![0]).toContain('limit=10');
      expect(chatCall![0]).toContain('offset=5');
    });

    it('should throw when not running', async () => {
      await adapter.stop();
      await expect(adapter.getChats()).rejects.toThrow('IMessageAdapter is not running');
    });
  });

  // ==========================================================================
  // getMessages()
  // ==========================================================================

  describe('getMessages()', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    it('should return messages for a chat', async () => {
      const messages = [
        { guid: 'msg-1', text: 'Hello', handle: 'alice', chatGuid: 'chat-1', dateCreated: '2026-01-01T00:00:00Z', isFromMe: false },
      ];

      setupFetchRouter({
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: messages }),
      });

      const result = await adapter.getMessages('chat-1');
      expect(result).toEqual(messages);
    });

    it('should encode chatGuid in URL', async () => {
      mockFetch = setupFetchRouter({
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await adapter.getMessages('iMessage;+;chat123');

      const msgCall = mockFetch.mock.calls.find(
        (call: string[]) => call[0].includes('chatGuid=')
      );
      expect(msgCall![0]).toContain(encodeURIComponent('iMessage;+;chat123'));
    });

    it('should throw when not running', async () => {
      await adapter.stop();
      await expect(adapter.getMessages('chat-1')).rejects.toThrow('IMessageAdapter is not running');
    });
  });

  // ==========================================================================
  // getAttachment()
  // ==========================================================================

  describe('getAttachment()', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    it('should download attachment as Buffer', async () => {
      const fakeData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

      setupFetchRouter({
        '/api/v1/attachment/': () => ({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: jest.fn().mockResolvedValue(fakeData),
          json: jest.fn(),
          text: jest.fn(),
          headers: new Headers(),
          redirected: false,
          type: 'basic' as ResponseType,
          url: '',
          clone: jest.fn(),
          body: null,
          bodyUsed: false,
          formData: jest.fn(),
          blob: jest.fn(),
        } as unknown as Response),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      const buffer = await adapter.getAttachment('att-guid-1');

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBe(4);
    });

    it('should throw on failed download', async () => {
      setupFetchRouter({
        '/api/v1/attachment/': () => mockFetchResponse(null, 404, false),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await expect(adapter.getAttachment('bad-guid')).rejects.toThrow('Failed to download attachment: 404');
    });

    it('should throw when not running', async () => {
      await adapter.stop();
      await expect(adapter.getAttachment('att-1')).rejects.toThrow('IMessageAdapter is not running');
    });

    it('should encode attachment guid and password in URL', async () => {
      mockFetch = setupFetchRouter({
        '/api/v1/attachment/': () => ({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
          json: jest.fn(),
          text: jest.fn(),
          headers: new Headers(),
          redirected: false,
          type: 'basic' as ResponseType,
          url: '',
          clone: jest.fn(),
          body: null,
          bodyUsed: false,
          formData: jest.fn(),
          blob: jest.fn(),
        } as unknown as Response),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await adapter.getAttachment('att/special&chars');

      const attCall = mockFetch.mock.calls.find(
        (call: string[]) => call[0].includes('/api/v1/attachment/')
      );
      expect(attCall![0]).toContain(encodeURIComponent('att/special&chars'));
      expect(attCall![0]).toContain('password=');
    });
  });

  // ==========================================================================
  // Polling - incoming messages
  // ==========================================================================

  describe('polling', () => {
    it('should emit message events for incoming messages', async () => {
      const incomingMessages = [
        {
          guid: 'msg-in-1',
          text: 'Hey there!',
          handle: 'alice@icloud.com',
          chatGuid: 'chat-1',
          dateCreated: new Date(Date.now() + 1000).toISOString(),
          isFromMe: false,
        },
        {
          guid: 'msg-in-2',
          text: 'How are you?',
          handle: 'bob@icloud.com',
          chatGuid: 'chat-2',
          dateCreated: new Date(Date.now() + 2000).toISOString(),
          isFromMe: false,
        },
      ];

      let pollCount = 0;
      setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message': () => {
          pollCount++;
          if (pollCount === 1) {
            return mockFetchResponse({ status: 200, message: 'OK', data: incomingMessages });
          }
          return mockFetchResponse({ status: 200, message: 'OK', data: [] });
        },
      });

      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      await adapter.start();

      // Advance past the polling interval
      await vi.advanceTimersByTimeAsync(3000);

      expect(messageHandler).toHaveBeenCalledTimes(2);

      const firstCall = messageHandler.mock.calls[0][0];
      expect(firstCall.id).toBe('msg-in-1');
      expect(firstCall.content).toBe('Hey there!');
      expect(firstCall.sender).toBe('alice@icloud.com');
      expect(firstCall.chatGuid).toBe('chat-1');

      const secondCall = messageHandler.mock.calls[1][0];
      expect(secondCall.id).toBe('msg-in-2');
      expect(secondCall.content).toBe('How are you?');
    });

    it('should skip messages from self (isFromMe=true)', async () => {
      const messages = [
        {
          guid: 'msg-self',
          text: 'My own message',
          handle: 'me',
          chatGuid: 'chat-1',
          dateCreated: new Date(Date.now() + 1000).toISOString(),
          isFromMe: true,
        },
        {
          guid: 'msg-other',
          text: 'Other message',
          handle: 'alice',
          chatGuid: 'chat-1',
          dateCreated: new Date(Date.now() + 2000).toISOString(),
          isFromMe: false,
        },
      ];

      let pollCount = 0;
      setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message': () => {
          pollCount++;
          if (pollCount === 1) {
            return mockFetchResponse({ status: 200, message: 'OK', data: messages });
          }
          return mockFetchResponse({ status: 200, message: 'OK', data: [] });
        },
      });

      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      await adapter.start();
      await vi.advanceTimersByTimeAsync(3000);

      expect(messageHandler).toHaveBeenCalledTimes(1);
      expect(messageHandler.mock.calls[0][0].id).toBe('msg-other');
    });

    it('should not emit when poll returns empty data', async () => {
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      await adapter.start();
      await vi.advanceTimersByTimeAsync(3000);

      expect(messageHandler).not.toHaveBeenCalled();
    });

    it('should update lastMessageTimestamp after receiving messages', async () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const messages = [
        {
          guid: 'msg-1',
          text: 'Hello',
          handle: 'alice',
          chatGuid: 'chat-1',
          dateCreated: futureTime,
          isFromMe: false,
        },
      ];

      let pollCount = 0;
      setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message': () => {
          pollCount++;
          if (pollCount === 1) {
            return mockFetchResponse({ status: 200, message: 'OK', data: messages });
          }
          return mockFetchResponse({ status: 200, message: 'OK', data: [] });
        },
      });

      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      await adapter.start();
      await vi.advanceTimersByTimeAsync(3000);

      // Second poll should use the updated timestamp in the URL
      await vi.advanceTimersByTimeAsync(3000);

      // The second poll call should have after= with the updated timestamp
      const pollCalls = (global.fetch as jest.Mock).mock.calls.filter(
        (call: string[]) => call[0].includes('/api/v1/message') && call[0].includes('after=')
      );
      expect(pollCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // Reconnection on polling failure
  // ==========================================================================

  describe('reconnection', () => {
    it('should attempt reconnection after max polling failures', async () => {
      await adapter.start();

      // Make polling fail
      setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message': () => mockFetchResponse('Error', 500, false),
      });

      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);
      const reconnectedHandler = jest.fn();
      adapter.on('reconnected', reconnectedHandler);

      // Advance through 5 polling failures (maxRetries = 5)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(3000);
      }

      // After max retries, error should be emitted and reconnect attempted
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(errorHandler.mock.calls[0][0].message).toContain('Polling failed after max retries');

      // Health check succeeds, so reconnection should succeed
      expect(reconnectedHandler).toHaveBeenCalled();
      expect(adapter.isRunning()).toBe(true);
    });

    it('should emit disconnected when reconnection fails permanently', async () => {
      await adapter.start();

      // Make everything fail
      setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse('Down', 503, false),
        '/api/v1/message': () => mockFetchResponse('Error', 500, false),
      });

      const disconnectedHandler = jest.fn();
      adapter.on('disconnected', disconnectedHandler);
      // Must listen for 'error' to prevent EventEmitter from throwing
      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);

      // Trigger max polling failures (5 intervals)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(3000);
      }

      // Reconnect will retry with exponential backoff: 5000, 10000, 20000, 40000, 80000
      // Advance through all retry delays generously
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(5000 * Math.pow(2, i) + 100);
      }

      expect(disconnectedHandler).toHaveBeenCalled();
      expect(adapter.isRunning()).toBe(false);
    });

    it('should reset retry count on successful poll', async () => {
      let failCount = 0;
      const maxFails = 3;

      setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message': () => {
          failCount++;
          if (failCount <= maxFails) {
            return mockFetchResponse('Error', 500, false);
          }
          return mockFetchResponse({ status: 200, message: 'OK', data: [] });
        },
      });

      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);

      await adapter.start();

      // 3 failures, then success - should not trigger reconnect (maxRetries=5)
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(3000);
      }

      expect(errorHandler).not.toHaveBeenCalled();
      expect(adapter.isRunning()).toBe(true);
    });
  });

  // ==========================================================================
  // Error handling for failed API calls
  // ==========================================================================

  describe('error handling', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    it('should throw with status and message on API error', async () => {
      setupFetchRouter({
        '/api/v1/chat': () => mockFetchResponse('Unauthorized', 401, false),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await expect(adapter.getChats()).rejects.toThrow(/BlueBubbles API error: 401/);
    });

    it('should handle network errors in API requests', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network timeout')) as unknown as typeof fetch;

      await expect(adapter.getChats()).rejects.toThrow('Network timeout');
    });

    it('should include password in API request URLs', async () => {
      const pwAdapter = new IMessageAdapter(createConfig({ password: 'secret&key' }));
      mockFetch = setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await pwAdapter.start();

      const infoCalls = mockFetch.mock.calls.filter(
        (call: string[]) => call[0].includes('/api/v1/server/info')
      );
      expect(infoCalls[0][0]).toContain('password=' + encodeURIComponent('secret&key'));

      await pwAdapter.stop();
    });

    it('should use correct base URL with custom port', async () => {
      const customAdapter = new IMessageAdapter(createConfig({ port: 8080 }));
      mockFetch = setupFetchRouter({
        '/api/v1/server/info': () => mockFetchResponse({ status: 200, message: 'OK', data: {} }),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await customAdapter.start();

      const calls = mockFetch.mock.calls;
      expect(calls[0][0]).toContain('http://localhost:8080');

      await customAdapter.stop();
    });

    it('should set Content-Type header on API requests', async () => {
      mockFetch = setupFetchRouter({
        '/api/v1/message/text': () => mockFetchResponse({ status: 200, message: 'OK', data: { guid: 'g1' } }),
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await adapter.sendMessage('chat-1', 'test');

      const sendCall = mockFetch.mock.calls.find(
        (call: string[]) => call[0].includes('/api/v1/message/text')
      );
      expect(sendCall![1].headers['Content-Type']).toBe('application/json');
    });
  });

  // ==========================================================================
  // getChatMessages()
  // ==========================================================================

  describe('getChatMessages()', () => {
    beforeEach(async () => {
      await adapter.start();
    });

    it('should return messages for a chat', async () => {
      const messages = [
        { guid: 'msg-1', text: 'Hi', handle: 'alice', chatGuid: 'c1', dateCreated: '2026-01-01', isFromMe: false },
      ];

      setupFetchRouter({
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: messages }),
      });

      const result = await adapter.getChatMessages('c1');
      expect(result).toEqual(messages);
    });

    it('should include after parameter when provided', async () => {
      mockFetch = setupFetchRouter({
        '/api/v1/message': () => mockFetchResponse({ status: 200, message: 'OK', data: [] }),
      });

      await adapter.getChatMessages('c1', 1700000000000);

      const call = mockFetch.mock.calls.find(
        (c: string[]) => c[0].includes('chatGuid=')
      );
      expect(call![0]).toContain('after=1700000000000');
    });

    it('should throw when not running', async () => {
      await adapter.stop();
      await expect(adapter.getChatMessages('c1')).rejects.toThrow('IMessageAdapter is not running');
    });
  });

  // ==========================================================================
  // isRunning()
  // ==========================================================================

  describe('isRunning()', () => {
    it('should return false before start', () => {
      expect(adapter.isRunning()).toBe(false);
    });

    it('should return true after start', async () => {
      await adapter.start();
      expect(adapter.isRunning()).toBe(true);
    });

    it('should return false after stop', async () => {
      await adapter.start();
      await adapter.stop();
      expect(adapter.isRunning()).toBe(false);
    });
  });
});
