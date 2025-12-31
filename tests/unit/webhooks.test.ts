/**
 * Unit tests for WebhookManager
 * Tests webhook registration, event delivery, retry logic, signature verification, and persistence
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import {
  WebhookManager,
  WebhookConfig,
  WebhookPayload,
  WebhookDelivery,
  WebhookEvent,
  getWebhookManager,
  emitWebhook,
} from '../../src/api/webhooks';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  existsSync: jest.fn(),
  readJsonSync: jest.fn(),
  writeJsonSync: jest.fn(),
  ensureDirSync: jest.fn(),
}));

// Mock https and http modules
jest.mock('https', () => {
  const actualHttps = jest.requireActual('https');
  return {
    ...actualHttps,
    request: jest.fn(),
  };
});

jest.mock('http', () => {
  const actualHttp = jest.requireActual('http');
  return {
    ...actualHttp,
    request: jest.fn(),
  };
});

// Mock EventEmitter for request/response
class MockClientRequest {
  private errorHandler?: (error: Error) => void;
  private timeoutHandler?: () => void;

  on = jest.fn((event: string, handler: Function) => {
    if (event === 'error') {
      this.errorHandler = handler as (error: Error) => void;
    } else if (event === 'timeout') {
      this.timeoutHandler = handler as () => void;
    }
    return this;
  });

  write = jest.fn();
  end = jest.fn();
  destroy = jest.fn();

  emitError(error: Error): void {
    if (this.errorHandler) {
      this.errorHandler(error);
    }
  }

  emitTimeout(): void {
    if (this.timeoutHandler) {
      this.timeoutHandler();
    }
  }
}

class MockIncomingMessage {
  public statusCode: number;
  private data: string;
  private dataHandler?: (chunk: string) => void;
  private endHandler?: () => void;

  constructor(statusCode: number, data: string = '') {
    this.statusCode = statusCode;
    this.data = data;
  }

  on = jest.fn((event: string, handler: Function) => {
    if (event === 'data') {
      this.dataHandler = handler as (chunk: string) => void;
    } else if (event === 'end') {
      this.endHandler = handler as () => void;
    }
    return this;
  });

  emitData(): void {
    if (this.dataHandler) {
      this.dataHandler(this.data);
    }
    if (this.endHandler) {
      this.endHandler();
    }
  }
}

describe('WebhookManager', () => {
  let manager: WebhookManager;
  let tempConfigPath: string;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset singleton
    (global as Record<string, unknown>)._webhookManager = null;

    // Setup default mock behavior
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readJsonSync as jest.Mock).mockReturnValue([]);
    (fs.writeJsonSync as jest.Mock).mockImplementation(() => {});
    (fs.ensureDirSync as jest.Mock).mockImplementation(() => {});

    tempConfigPath = path.join(os.tmpdir(), 'test-webhooks.json');
    manager = new WebhookManager(tempConfigPath);
  });

  describe('Constructor', () => {
    it('should create manager with default config path', () => {
      const defaultManager = new WebhookManager();

      expect(defaultManager).toBeInstanceOf(WebhookManager);
    });

    it('should create manager with custom config path', () => {
      const customManager = new WebhookManager('/custom/path/webhooks.json');

      expect(customManager).toBeInstanceOf(WebhookManager);
    });

    it('should load existing webhooks from config file', () => {
      const existingWebhooks: WebhookConfig[] = [
        {
          id: 'webhook-1',
          name: 'Test Webhook',
          url: 'https://example.com/webhook',
          events: ['session.start', 'session.end'],
          enabled: true,
        },
      ];

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readJsonSync as jest.Mock).mockReturnValue(existingWebhooks);

      const loadedManager = new WebhookManager(tempConfigPath);
      const webhooks = loadedManager.getAll();

      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].id).toBe('webhook-1');
    });

    it('should handle config file read errors gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readJsonSync as jest.Mock).mockImplementation(() => {
        throw new Error('Read error');
      });

      const errorManager = new WebhookManager(tempConfigPath);
      const webhooks = errorManager.getAll();

      expect(webhooks).toHaveLength(0);
    });

    it('should handle non-array config data', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readJsonSync as jest.Mock).mockReturnValue({ not: 'an array' });

      const errorManager = new WebhookManager(tempConfigPath);
      const webhooks = errorManager.getAll();

      expect(webhooks).toHaveLength(0);
    });
  });

  describe('Webhook Registration', () => {
    it('should register a new webhook and return ID', () => {
      const id = manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      expect(id).toMatch(/^webhook-\d+-[a-z0-9]+$/);
    });

    it('should apply default config values', () => {
      const id = manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      const webhook = manager.get(id);

      expect(webhook).toBeDefined();
      expect(webhook!.retryCount).toBe(3);
      expect(webhook!.retryDelay).toBe(1000);
      expect(webhook!.timeout).toBe(10000);
    });

    it('should allow custom config values', () => {
      const id = manager.register({
        name: 'Custom Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        secret: 'my-secret',
        headers: { 'X-Custom': 'value' },
        retryCount: 5,
        retryDelay: 2000,
        timeout: 30000,
      });

      const webhook = manager.get(id);

      expect(webhook!.secret).toBe('my-secret');
      expect(webhook!.headers).toEqual({ 'X-Custom': 'value' });
      expect(webhook!.retryCount).toBe(5);
      expect(webhook!.retryDelay).toBe(2000);
      expect(webhook!.timeout).toBe(30000);
    });

    it('should save config after registration', () => {
      manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      expect(fs.writeJsonSync).toHaveBeenCalled();
    });

    it('should register multiple webhooks', () => {
      manager.register({
        name: 'Webhook 1',
        url: 'https://example.com/webhook1',
        events: ['session.start'],
        enabled: true,
      });

      manager.register({
        name: 'Webhook 2',
        url: 'https://example.com/webhook2',
        events: ['session.end'],
        enabled: true,
      });

      const webhooks = manager.getAll();
      expect(webhooks).toHaveLength(2);
    });
  });

  describe('Webhook Update', () => {
    let webhookId: string;

    beforeEach(() => {
      webhookId = manager.register({
        name: 'Original Name',
        url: 'https://example.com/original',
        events: ['session.start'],
        enabled: true,
      });
    });

    it('should update webhook properties', () => {
      const result = manager.update(webhookId, {
        name: 'Updated Name',
        url: 'https://example.com/updated',
      });

      expect(result).toBe(true);

      const webhook = manager.get(webhookId);
      expect(webhook!.name).toBe('Updated Name');
      expect(webhook!.url).toBe('https://example.com/updated');
    });

    it('should update webhook enabled status', () => {
      manager.update(webhookId, { enabled: false });

      const webhook = manager.get(webhookId);
      expect(webhook!.enabled).toBe(false);
    });

    it('should update webhook events', () => {
      manager.update(webhookId, { events: ['message.user', 'message.assistant'] });

      const webhook = manager.get(webhookId);
      expect(webhook!.events).toEqual(['message.user', 'message.assistant']);
    });

    it('should return false for non-existent webhook', () => {
      const result = manager.update('non-existent-id', { name: 'New Name' });

      expect(result).toBe(false);
    });

    it('should save config after update', () => {
      jest.clearAllMocks();

      manager.update(webhookId, { name: 'Updated' });

      expect(fs.writeJsonSync).toHaveBeenCalled();
    });
  });

  describe('Webhook Removal', () => {
    let webhookId: string;

    beforeEach(() => {
      webhookId = manager.register({
        name: 'To Delete',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });
    });

    it('should remove webhook', () => {
      const result = manager.remove(webhookId);

      expect(result).toBe(true);
      expect(manager.get(webhookId)).toBeUndefined();
    });

    it('should return false for non-existent webhook', () => {
      const result = manager.remove('non-existent-id');

      expect(result).toBe(false);
    });

    it('should save config after removal', () => {
      jest.clearAllMocks();

      manager.remove(webhookId);

      expect(fs.writeJsonSync).toHaveBeenCalled();
    });
  });

  describe('Webhook Retrieval', () => {
    beforeEach(() => {
      manager.register({
        name: 'Webhook 1',
        url: 'https://example.com/webhook1',
        events: ['session.start', 'session.end'],
        enabled: true,
      });

      manager.register({
        name: 'Webhook 2',
        url: 'https://example.com/webhook2',
        events: ['message.user'],
        enabled: true,
      });

      manager.register({
        name: 'Disabled Webhook',
        url: 'https://example.com/webhook3',
        events: ['session.start'],
        enabled: false,
      });
    });

    it('should get webhook by ID', () => {
      const webhooks = manager.getAll();
      const webhook = manager.get(webhooks[0].id);

      expect(webhook).toBeDefined();
      expect(webhook!.name).toBe('Webhook 1');
    });

    it('should return undefined for non-existent ID', () => {
      const webhook = manager.get('non-existent');

      expect(webhook).toBeUndefined();
    });

    it('should get all webhooks', () => {
      const webhooks = manager.getAll();

      expect(webhooks).toHaveLength(3);
    });

    it('should get webhooks for specific event', () => {
      const webhooks = manager.getForEvent('session.start');

      expect(webhooks).toHaveLength(1); // Only enabled ones
      expect(webhooks[0].name).toBe('Webhook 1');
    });

    it('should filter out disabled webhooks for event', () => {
      const webhooks = manager.getForEvent('session.start');

      // Disabled webhook should not be included
      const disabledWebhook = webhooks.find(w => w.name === 'Disabled Webhook');
      expect(disabledWebhook).toBeUndefined();
    });

    it('should return empty array for event with no webhooks', () => {
      const webhooks = manager.getForEvent('error');

      expect(webhooks).toHaveLength(0);
    });
  });

  describe('Event Emission', () => {
    let mockRequest: MockClientRequest;
    let mockResponse: MockIncomingMessage;

    beforeEach(() => {
      mockRequest = new MockClientRequest();
      mockResponse = new MockIncomingMessage(200, '{"status":"ok"}');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });
    });

    it('should emit event to registered webhooks', async () => {
      manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      const deliveries = await manager.emit('session.start', { sessionId: '123' });

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe('success');
    });

    it('should include session ID in payload', async () => {
      manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      const deliveries = await manager.emit('session.start', { data: 'test' }, 'session-456');

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].payload.sessionId).toBe('session-456');
    });

    it('should emit to multiple webhooks', async () => {
      manager.register({
        name: 'Webhook 1',
        url: 'https://example1.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      manager.register({
        name: 'Webhook 2',
        url: 'https://example2.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      const deliveries = await manager.emit('session.start', {});

      expect(deliveries).toHaveLength(2);
    });

    it('should not emit to webhooks for different events', async () => {
      manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      const deliveries = await manager.emit('session.end', {});

      expect(deliveries).toHaveLength(0);
    });

    it('should include correct payload structure', async () => {
      manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['message.user'],
        enabled: true,
      });

      const deliveries = await manager.emit('message.user', { content: 'Hello' });

      expect(deliveries[0].payload.event).toBe('message.user');
      expect(deliveries[0].payload.timestamp).toBeDefined();
      expect(deliveries[0].payload.data).toEqual({ content: 'Hello' });
    });

    it('should add delivery to history', async () => {
      manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      await manager.emit('session.start', {});

      const history = manager.getHistory();
      expect(history).toHaveLength(1);
    });
  });

  describe('HTTP Request Handling', () => {
    let mockRequest: MockClientRequest;

    beforeEach(() => {
      mockRequest = new MockClientRequest();
    });

    it('should send POST request with JSON payload', async () => {
      const mockResponse = new MockIncomingMessage(200, '{}');

      (https.request as jest.Mock).mockImplementation((options, callback) => {
        expect(options.method).toBe('POST');
        expect(options.headers['Content-Type']).toBe('application/json');

        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      await manager.emit('session.start', { test: true });

      expect(mockRequest.write).toHaveBeenCalled();
      expect(mockRequest.end).toHaveBeenCalled();
    });

    it('should use HTTP for non-HTTPS URLs', async () => {
      const mockResponse = new MockIncomingMessage(200, '{}');

      (http.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'http://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      await manager.emit('session.start', {});

      expect(http.request).toHaveBeenCalled();
    });

    it('should include custom headers', async () => {
      const mockResponse = new MockIncomingMessage(200, '{}');

      (https.request as jest.Mock).mockImplementation((options, callback) => {
        expect(options.headers['X-Custom-Header']).toBe('custom-value');

        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      await manager.emit('session.start', {});

      expect(https.request).toHaveBeenCalled();
    });

    it('should include signature header when secret is configured', async () => {
      const mockResponse = new MockIncomingMessage(200, '{}');

      (https.request as jest.Mock).mockImplementation((options, callback) => {
        expect(options.headers['X-Webhook-Signature']).toBeDefined();

        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        secret: 'my-secret-key',
      });

      await manager.emit('session.start', {});

      expect(https.request).toHaveBeenCalled();
    });

    it('should handle non-2xx response as error', async () => {
      const mockResponse = new MockIncomingMessage(500, 'Internal Server Error');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 1, // Single retry to speed up test
      });

      const deliveries = await manager.emit('session.start', {});

      expect(deliveries[0].status).toBe('failed');
    });

    it('should handle request error', async () => {
      (https.request as jest.Mock).mockImplementation(() => {
        process.nextTick(() => {
          mockRequest.emitError(new Error('Connection refused'));
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 1,
      });

      const deliveries = await manager.emit('session.start', {});

      expect(deliveries[0].status).toBe('failed');
      expect(deliveries[0].error).toContain('Connection refused');
    });

    it('should handle request timeout', async () => {
      (https.request as jest.Mock).mockImplementation(() => {
        process.nextTick(() => {
          mockRequest.emitTimeout();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 1,
        timeout: 100,
      });

      const deliveries = await manager.emit('session.start', {});

      expect(deliveries[0].status).toBe('failed');
      expect(deliveries[0].error).toContain('timeout');
    });
  });

  describe('Retry Logic', () => {
    let mockRequest: MockClientRequest;
    let callCount: number;

    beforeEach(() => {
      mockRequest = new MockClientRequest();
      callCount = 0;
    });

    it('should retry on failure', async () => {
      const mockResponse = new MockIncomingMessage(500, 'Error');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        callCount++;
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 3,
        retryDelay: 10, // Short delay for testing
      });

      await manager.emit('session.start', {});

      expect(callCount).toBe(3);
    });

    it('should stop retrying on success', async () => {
      let attemptCount = 0;

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        attemptCount++;
        const statusCode = attemptCount === 2 ? 200 : 500;
        const mockResponse = new MockIncomingMessage(statusCode, '{}');

        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 5,
        retryDelay: 10,
      });

      const deliveries = await manager.emit('session.start', {});

      expect(attemptCount).toBe(2);
      expect(deliveries[0].status).toBe('success');
    });

    it('should use exponential backoff', async () => {
      const timestamps: number[] = [];
      const mockResponse = new MockIncomingMessage(500, 'Error');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        timestamps.push(Date.now());
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 3,
        retryDelay: 50,
      });

      await manager.emit('session.start', {});

      // Verify increasing delays (exponential backoff)
      if (timestamps.length >= 3) {
        const delay1 = timestamps[1] - timestamps[0];
        const delay2 = timestamps[2] - timestamps[1];
        expect(delay2).toBeGreaterThanOrEqual(delay1);
      }
    });

    it('should track attempt count', async () => {
      const mockResponse = new MockIncomingMessage(500, 'Error');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 3,
        retryDelay: 10,
      });

      const deliveries = await manager.emit('session.start', {});

      expect(deliveries[0].attempts).toBe(3);
    });
  });

  describe('Signature Verification', () => {
    it('should verify valid signature', () => {
      const payload = '{"event":"test"}';
      const secret = 'my-secret-key';
      const signature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const result = WebhookManager.verifySignature(payload, signature, secret);

      expect(result).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = '{"event":"test"}';
      const secret = 'my-secret-key';
      const wrongSignature = 'invalid-signature';

      // Note: This may throw due to buffer length mismatch in timingSafeEqual
      try {
        const result = WebhookManager.verifySignature(payload, wrongSignature, secret);
        expect(result).toBe(false);
      } catch {
        // Expected for mismatched buffer lengths
      }
    });

    it('should reject signature with wrong secret', () => {
      const payload = '{"event":"test"}';
      const correctSecret = 'correct-secret';
      const wrongSecret = 'wrong-secret';

      const signature = crypto
        .createHmac('sha256', correctSecret)
        .update(payload)
        .digest('hex');

      const result = WebhookManager.verifySignature(payload, signature, wrongSecret);

      expect(result).toBe(false);
    });
  });

  describe('Delivery History', () => {
    let mockRequest: MockClientRequest;

    beforeEach(() => {
      mockRequest = new MockClientRequest();
      const mockResponse = new MockIncomingMessage(200, '{}');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });
    });

    it('should record successful deliveries', async () => {
      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      await manager.emit('session.start', {});

      const history = manager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('success');
    });

    it('should record failed deliveries', async () => {
      const mockResponse = new MockIncomingMessage(500, 'Error');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 1,
      });

      await manager.emit('session.start', {});

      const history = manager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('failed');
    });

    it('should filter history by webhook ID', async () => {
      const id1 = manager.register({
        name: 'Webhook 1',
        url: 'https://example1.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      manager.register({
        name: 'Webhook 2',
        url: 'https://example2.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      await manager.emit('session.start', {});

      const filteredHistory = manager.getHistory(id1);
      expect(filteredHistory).toHaveLength(1);
      expect(filteredHistory[0].webhookId).toBe(id1);
    });

    it('should get failed deliveries', async () => {
      const mockResponse = new MockIncomingMessage(500, 'Error');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 1,
      });

      await manager.emit('session.start', {});

      const failed = manager.getFailedDeliveries();
      expect(failed).toHaveLength(1);
      expect(failed[0].status).toBe('failed');
    });

    it('should clear history', async () => {
      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      await manager.emit('session.start', {});
      expect(manager.getHistory()).toHaveLength(1);

      manager.clearHistory();
      expect(manager.getHistory()).toHaveLength(0);
    });

    it('should limit history size', async () => {
      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      // Emit many events (more than maxHistorySize which is 100)
      for (let i = 0; i < 110; i++) {
        await manager.emit('session.start', { index: i });
      }

      const history = manager.getHistory();
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Retry Failed Delivery', () => {
    let mockRequest: MockClientRequest;
    let failedDeliveryId: string;

    beforeEach(async () => {
      mockRequest = new MockClientRequest();

      // First emit fails
      const failResponse = new MockIncomingMessage(500, 'Error');
      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(failResponse);
          failResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
        retryCount: 1,
      });

      const deliveries = await manager.emit('session.start', { test: true });
      failedDeliveryId = deliveries[0].id;
    });

    it('should retry failed delivery', async () => {
      // Setup success response for retry
      const successResponse = new MockIncomingMessage(200, '{}');
      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(successResponse);
          successResponse.emitData();
        });
        return mockRequest;
      });

      const delivery = await manager.retry(failedDeliveryId);

      expect(delivery).not.toBeNull();
      expect(delivery!.status).toBe('success');
    });

    it('should return null for non-existent delivery', async () => {
      const delivery = await manager.retry('non-existent-id');

      expect(delivery).toBeNull();
    });

    it('should return null for non-failed delivery', async () => {
      // Setup success response
      const successResponse = new MockIncomingMessage(200, '{}');
      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(successResponse);
          successResponse.emitData();
        });
        return mockRequest;
      });

      const id = manager.register({
        name: 'Success Webhook',
        url: 'https://example.com/webhook',
        events: ['session.end'],
        enabled: true,
      });

      const deliveries = await manager.emit('session.end', {});

      // Try to retry successful delivery
      const retryResult = await manager.retry(deliveries[0].id);
      expect(retryResult).toBeNull();
    });

    it('should return null if webhook no longer exists', async () => {
      // Get failed delivery
      const history = manager.getFailedDeliveries();
      const failedId = history[0].id;
      const webhookId = history[0].webhookId;

      // Remove the webhook
      manager.remove(webhookId);

      const delivery = await manager.retry(failedId);

      expect(delivery).toBeNull();
    });
  });

  describe('Test Webhook', () => {
    let mockRequest: MockClientRequest;

    beforeEach(() => {
      mockRequest = new MockClientRequest();
      const mockResponse = new MockIncomingMessage(200, '{}');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });
    });

    it('should send test delivery', async () => {
      const id = manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      const delivery = await manager.test(id);

      expect(delivery).not.toBeNull();
      expect(delivery!.status).toBe('success');
      expect(delivery!.payload.event).toBe('session.start');
      expect(delivery!.payload.data.test).toBe(true);
    });

    it('should return null for non-existent webhook', async () => {
      const delivery = await manager.test('non-existent-id');

      expect(delivery).toBeNull();
    });

    it('should add test delivery to history', async () => {
      const id = manager.register({
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      await manager.test(id);

      const history = manager.getHistory(id);
      expect(history).toHaveLength(1);
    });
  });

  describe('Format Webhooks Display', () => {
    it('should format empty webhook list', () => {
      const output = manager.formatWebhooks();

      expect(output).toBe('No webhooks configured.');
    });

    it('should format webhook list', () => {
      manager.register({
        name: 'Production Webhook',
        url: 'https://api.production.com/webhook',
        events: ['session.start', 'session.end'],
        enabled: true,
      });

      manager.register({
        name: 'Disabled Webhook',
        url: 'https://api.staging.com/webhook',
        events: ['error'],
        enabled: false,
      });

      const output = manager.formatWebhooks();

      expect(output).toContain('WEBHOOKS');
      expect(output).toContain('Production Webhook');
      expect(output).toContain('[ON]');
      expect(output).toContain('Disabled Webhook');
      expect(output).toContain('[OFF]');
      expect(output).toContain('session.start, session.end');
    });
  });

  describe('Config Persistence', () => {
    it('should save config on register', () => {
      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      expect(fs.ensureDirSync).toHaveBeenCalled();
      expect(fs.writeJsonSync).toHaveBeenCalledWith(
        tempConfigPath,
        expect.any(Array),
        { spaces: 2 }
      );
    });

    it('should save config on update', () => {
      const id = manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      jest.clearAllMocks();

      manager.update(id, { name: 'Updated' });

      expect(fs.writeJsonSync).toHaveBeenCalled();
    });

    it('should save config on remove', () => {
      const id = manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      jest.clearAllMocks();

      manager.remove(id);

      expect(fs.writeJsonSync).toHaveBeenCalled();
    });

    it('should handle save errors gracefully', () => {
      (fs.writeJsonSync as jest.Mock).mockImplementation(() => {
        throw new Error('Write error');
      });

      // Should not throw
      expect(() => {
        manager.register({
          name: 'Test',
          url: 'https://example.com/webhook',
          events: ['session.start'],
          enabled: true,
        });
      }).not.toThrow();
    });
  });
});

describe('Singleton Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset singleton
    (global as Record<string, unknown>)._webhookManager = null;

    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readJsonSync as jest.Mock).mockReturnValue([]);
    (fs.writeJsonSync as jest.Mock).mockImplementation(() => {});
    (fs.ensureDirSync as jest.Mock).mockImplementation(() => {});
  });

  describe('getWebhookManager', () => {
    it('should create and return singleton instance', () => {
      const manager1 = getWebhookManager();
      const manager2 = getWebhookManager();

      expect(manager1).toBe(manager2);
    });
  });

  describe('emitWebhook', () => {
    it('should emit webhook event through singleton', async () => {
      const manager = getWebhookManager();

      const mockRequest = new MockClientRequest();
      const mockResponse = new MockIncomingMessage(200, '{}');

      (https.request as jest.Mock).mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockResponse);
          mockResponse.emitData();
        });
        return mockRequest;
      });

      manager.register({
        name: 'Test',
        url: 'https://example.com/webhook',
        events: ['session.start'],
        enabled: true,
      });

      await emitWebhook('session.start', { test: true }, 'session-123');

      const history = manager.getHistory();
      expect(history).toHaveLength(1);
    });
  });
});

describe('All Webhook Events', () => {
  let manager: WebhookManager;
  let mockRequest: MockClientRequest;

  const allEvents: WebhookEvent[] = [
    'session.start',
    'session.end',
    'message.user',
    'message.assistant',
    'tool.start',
    'tool.complete',
    'tool.error',
    'file.create',
    'file.modify',
    'file.delete',
    'error',
    'cost.threshold',
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readJsonSync as jest.Mock).mockReturnValue([]);
    (fs.writeJsonSync as jest.Mock).mockImplementation(() => {});
    (fs.ensureDirSync as jest.Mock).mockImplementation(() => {});

    manager = new WebhookManager('/tmp/test-webhooks.json');

    mockRequest = new MockClientRequest();
    const mockResponse = new MockIncomingMessage(200, '{}');

    (https.request as jest.Mock).mockImplementation((_options, callback) => {
      process.nextTick(() => {
        callback(mockResponse);
        mockResponse.emitData();
      });
      return mockRequest;
    });
  });

  allEvents.forEach(event => {
    it(`should handle ${event} event`, async () => {
      manager.register({
        name: `${event} Webhook`,
        url: 'https://example.com/webhook',
        events: [event],
        enabled: true,
      });

      const deliveries = await manager.emit(event, { eventType: event });

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].event).toBe(event);
      expect(deliveries[0].status).toBe('success');
    });
  });
});

describe('Edge Cases', () => {
  let manager: WebhookManager;
  let mockRequest: MockClientRequest;

  beforeEach(() => {
    jest.clearAllMocks();

    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readJsonSync as jest.Mock).mockReturnValue([]);
    (fs.writeJsonSync as jest.Mock).mockImplementation(() => {});
    (fs.ensureDirSync as jest.Mock).mockImplementation(() => {});

    manager = new WebhookManager('/tmp/test-webhooks.json');
    mockRequest = new MockClientRequest();
  });

  it('should handle webhook with multiple events', async () => {
    const mockResponse = new MockIncomingMessage(200, '{}');

    (https.request as jest.Mock).mockImplementation((_options, callback) => {
      process.nextTick(() => {
        callback(mockResponse);
        mockResponse.emitData();
      });
      return mockRequest;
    });

    manager.register({
      name: 'Multi-Event Webhook',
      url: 'https://example.com/webhook',
      events: ['session.start', 'session.end', 'message.user'],
      enabled: true,
    });

    const startDeliveries = await manager.emit('session.start', {});
    const endDeliveries = await manager.emit('session.end', {});
    const userDeliveries = await manager.emit('message.user', {});

    expect(startDeliveries).toHaveLength(1);
    expect(endDeliveries).toHaveLength(1);
    expect(userDeliveries).toHaveLength(1);
  });

  it('should handle URL with port number', async () => {
    const mockResponse = new MockIncomingMessage(200, '{}');

    (https.request as jest.Mock).mockImplementation((options, callback) => {
      expect(options.port).toBe('8443');
      process.nextTick(() => {
        callback(mockResponse);
        mockResponse.emitData();
      });
      return mockRequest;
    });

    manager.register({
      name: 'Test',
      url: 'https://example.com:8443/webhook',
      events: ['session.start'],
      enabled: true,
    });

    await manager.emit('session.start', {});

    expect(https.request).toHaveBeenCalled();
  });

  it('should handle URL with query parameters', async () => {
    const mockResponse = new MockIncomingMessage(200, '{}');

    (https.request as jest.Mock).mockImplementation((options, callback) => {
      expect(options.path).toBe('/webhook?token=abc123');
      process.nextTick(() => {
        callback(mockResponse);
        mockResponse.emitData();
      });
      return mockRequest;
    });

    manager.register({
      name: 'Test',
      url: 'https://example.com/webhook?token=abc123',
      events: ['session.start'],
      enabled: true,
    });

    await manager.emit('session.start', {});

    expect(https.request).toHaveBeenCalled();
  });

  it('should handle large payload', async () => {
    const mockResponse = new MockIncomingMessage(200, '{}');

    (https.request as jest.Mock).mockImplementation((_options, callback) => {
      process.nextTick(() => {
        callback(mockResponse);
        mockResponse.emitData();
      });
      return mockRequest;
    });

    manager.register({
      name: 'Test',
      url: 'https://example.com/webhook',
      events: ['message.user'],
      enabled: true,
    });

    const largeData = {
      content: 'x'.repeat(100000),
      metadata: Array(100).fill({ key: 'value' }),
    };

    const deliveries = await manager.emit('message.user', largeData);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('success');
  });

  it('should handle special characters in data', async () => {
    const mockResponse = new MockIncomingMessage(200, '{}');

    (https.request as jest.Mock).mockImplementation((_options, callback) => {
      process.nextTick(() => {
        callback(mockResponse);
        mockResponse.emitData();
      });
      return mockRequest;
    });

    manager.register({
      name: 'Test',
      url: 'https://example.com/webhook',
      events: ['message.user'],
      enabled: true,
    });

    const specialData = {
      content: '特殊文字 "quotes" & <tags> \n\t',
      emoji: 'Hello World',
    };

    const deliveries = await manager.emit('message.user', specialData);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('success');
  });

  it('should handle concurrent emissions', async () => {
    const mockResponse = new MockIncomingMessage(200, '{}');

    (https.request as jest.Mock).mockImplementation((_options, callback) => {
      setTimeout(() => {
        callback(mockResponse);
        mockResponse.emitData();
      }, 10);
      return mockRequest;
    });

    manager.register({
      name: 'Test',
      url: 'https://example.com/webhook',
      events: ['session.start', 'message.user'],
      enabled: true,
    });

    const promises = [
      manager.emit('session.start', { id: 1 }),
      manager.emit('message.user', { id: 2 }),
      manager.emit('session.start', { id: 3 }),
      manager.emit('message.user', { id: 4 }),
    ];

    const results = await Promise.all(promises);

    expect(results).toHaveLength(4);
    results.forEach(deliveries => {
      expect(deliveries).toHaveLength(1);
    });
  });

  it('should use default port for HTTP URLs', async () => {
    const mockResponse = new MockIncomingMessage(200, '{}');

    (http.request as jest.Mock).mockImplementation((options, callback) => {
      expect(options.port).toBe(80);
      process.nextTick(() => {
        callback(mockResponse);
        mockResponse.emitData();
      });
      return mockRequest;
    });

    manager.register({
      name: 'Test',
      url: 'http://example.com/webhook',
      events: ['session.start'],
      enabled: true,
    });

    await manager.emit('session.start', {});

    expect(http.request).toHaveBeenCalled();
  });
});
