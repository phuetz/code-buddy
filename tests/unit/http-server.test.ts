/**
 * Comprehensive unit tests for HttpServer
 *
 * Tests cover:
 * - Server startup and port binding
 * - CORS handling for cross-origin requests
 * - Route handling for all endpoints
 * - SSE streaming format and behavior
 * - Error responses (400, 404, 405, 500)
 * - Request parsing (JSON body, query params)
 * - Graceful shutdown and cleanup
 */

import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

// Mock types
interface MockServer extends EventEmitter {
  listen: jest.Mock;
  close: jest.Mock;
}

interface MockRequest extends EventEmitter {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface MockResponse {
  writeHead: jest.Mock;
  setHeader: jest.Mock;
  write: jest.Mock;
  end: jest.Mock;
  statusCode?: number;
  headers: Record<string, string>;
}

// Hoist mock variables so they are available inside vi.mock factories
const { mockCreateServer } = vi.hoisted(() => ({
  mockCreateServer: vi.fn(),
}));

// Create mock HTTP module before importing
const mockServer: MockServer = Object.assign(new EventEmitter(), {
  listen: vi.fn(),
  close: vi.fn(),
});

mockCreateServer.mockReturnValue(mockServer);

vi.mock('http', () => {
  const impl = { createServer: mockCreateServer };
  return { ...impl, default: impl };
});

// Mock stream helpers
vi.mock('../../src/utils/stream-helpers', () => ({
  withStreamTimeout: vi.fn((iterable: any) => iterable),
  withMaxIterations: vi.fn((iterable: any) => iterable),
  handleStreamError: vi.fn().mockReturnValue({
    message: 'Stream error',
    category: 'unknown',
    isRetryable: false,
  }),
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks
import { HttpServer, HttpServerOptions } from '../../src/ui/http-server/server';
import type { ChatEntry } from '../../src/agent/codebuddy-agent';

// Helper to create mock request
function createMockRequest(options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): MockRequest {
  const req = Object.assign(new EventEmitter(), {
    url: options.url || '/',
    method: options.method || 'GET',
    headers: options.headers || { host: 'localhost:3000' },
  }) as MockRequest;

  // Simulate body data if provided
  if (options.body !== undefined) {
    setTimeout(() => {
      req.emit('data', options.body);
      req.emit('end');
    }, 0);
  } else {
    setTimeout(() => {
      req.emit('end');
    }, 0);
  }

  return req;
}

// Helper to create mock response
function createMockResponse(): MockResponse {
  const headers: Record<string, string> = {};
  return {
    writeHead: jest.fn((code: number, hdrs?: Record<string, string>) => {
      if (hdrs) Object.assign(headers, hdrs);
    }),
    setHeader: jest.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    }),
    write: jest.fn(),
    end: jest.fn(),
    headers,
  };
}

// Create mock agent
function createMockAgent() {
  return {
    processUserMessage: jest.fn().mockResolvedValue([
      {
        type: 'assistant',
        content: 'Test response',
        timestamp: new Date(),
      },
    ] as ChatEntry[]),
    processUserMessageStream: jest.fn().mockImplementation(async function* () {
      yield { type: 'content', content: 'Hello' };
      yield { type: 'content', content: ' World' };
    }),
    getCurrentModel: jest.fn().mockReturnValue('grok-3-fast'),
    setModel: jest.fn(),
  };
}

describe('HttpServer', () => {
  let server: HttpServer;
  let mockAgent: ReturnType<typeof createMockAgent>;
  let requestHandler: (req: IncomingMessage, res: ServerResponse) => void;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock server
    mockServer.removeAllListeners();
    mockServer.listen.mockImplementation((_port, _host, callback) => {
      if (callback) callback();
    });
    mockServer.close.mockImplementation((callback) => {
      if (callback) callback();
    });

    // Capture request handler
    mockCreateServer.mockImplementation((handler) => {
      requestHandler = handler;
      return mockServer;
    });

    mockAgent = createMockAgent();
  });

  afterEach(() => {
    if (server) {
      server.stop();
    }
  });

  describe('Server Startup', () => {
    it('should start server on default port 3000', async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      const url = await server.start();

      expect(url).toBe('http://localhost:3000');
      expect(mockServer.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
    });

    it('should start server on custom port', async () => {
      server = new HttpServer({
        agent: mockAgent as unknown as HttpServerOptions['agent'],
        port: 8080,
      });
      const url = await server.start();

      expect(url).toBe('http://localhost:8080');
      expect(mockServer.listen).toHaveBeenCalledWith(8080, 'localhost', expect.any(Function));
    });

    it('should start server on custom host', async () => {
      server = new HttpServer({
        agent: mockAgent as unknown as HttpServerOptions['agent'],
        host: '0.0.0.0',
        port: 3000,
      });
      const url = await server.start();

      expect(url).toBe('http://0.0.0.0:3000');
      expect(mockServer.listen).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function));
    });

    it('should retry on EADDRINUSE by incrementing port', async () => {
      let callCount = 0;
      mockServer.listen.mockImplementation((_port, _host, callback) => {
        callCount++;
        if (callCount === 1) {
          // First call - simulate port in use
          setTimeout(() => {
            const error = new Error('Address in use') as NodeJS.ErrnoException;
            error.code = 'EADDRINUSE';
            mockServer.emit('error', error);
          }, 0);
        } else {
          // Second call - success
          if (callback) callback();
        }
      });

      server = new HttpServer({
        agent: mockAgent as unknown as HttpServerOptions['agent'],
        port: 3000,
      });

      const url = await server.start();

      expect(url).toBe('http://localhost:3001');
      expect(mockServer.listen).toHaveBeenCalledTimes(2);
    });

    it('should reject on non-EADDRINUSE errors', async () => {
      mockServer.listen.mockImplementation((_port, _host, _callback) => {
        setTimeout(() => {
          const error = new Error('Permission denied') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          mockServer.emit('error', error);
        }, 0);
      });

      server = new HttpServer({
        agent: mockAgent as unknown as HttpServerOptions['agent'],
        port: 80,
      });

      await expect(server.start()).rejects.toThrow('Permission denied');
    });
  });

  describe('CORS Handling', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should set CORS headers on all requests', () => {
      const req = createMockRequest({ url: '/', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type');
    });

    it('should handle OPTIONS preflight requests', () => {
      const req = createMockRequest({ url: '/api/chat', method: 'OPTIONS' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle OPTIONS for any path', () => {
      const req = createMockRequest({ url: '/api/stream', method: 'OPTIONS' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('Route Handling - Root Path', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should serve HTML page on GET /', () => {
      const req = createMockRequest({ url: '/', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'));
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('Code Buddy'));
    });

    it('should include model selector in HTML', () => {
      const req = createMockRequest({ url: '/', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      const htmlContent = res.end.mock.calls[0][0];
      expect(htmlContent).toContain('model-select');
      expect(htmlContent).toContain('data.models.map');
      expect(htmlContent).toContain('model-select');
    });
  });

  describe('Route Handling - /api/chat', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should handle POST /api/chat with valid JSON body', async () => {
      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockAgent.processUserMessage).toHaveBeenCalledWith('Hello', { surface: 'http' });
      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(
        expect.stringContaining('"entries"')
      );
    });

    it('should return 405 for non-POST requests to /api/chat', () => {
      const req = createMockRequest({ url: '/api/chat', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(405);
      expect(res.end).toHaveBeenCalledWith('Method not allowed');
    });

    it('should handle agent errors gracefully', async () => {
      mockAgent.processUserMessage.mockRejectedValueOnce(new Error('Agent error'));

      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(
        expect.stringContaining('Agent error')
      );
    });

    it('should handle invalid JSON body', async () => {
      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: 'invalid json',
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
    });
  });

  describe('Route Handling - /api/stream (SSE)', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should set SSE headers for streaming', async () => {
      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
    });

    it('should send user entry first', async () => {
      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Test message' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Check that user entry was sent
      const calls = res.write.mock.calls.map((c) => c[0]);
      const userEntryCall = calls.find((c: string) => c.includes('"type":"user"'));
      expect(userEntryCall).toBeDefined();
      expect(userEntryCall).toContain('Test message');
    });

    it('should format SSE events correctly', async () => {
      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      // All SSE events should start with "data: " and end with "\n\n"
      const calls = res.write.mock.calls.map((c) => c[0]);
      for (const call of calls) {
        expect(call).toMatch(/^data: .+\n\n$/);
      }
    });

    it('should send [DONE] at end of stream', async () => {
      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(res.write).toHaveBeenCalledWith('data: [DONE]\n\n');
      expect(res.end).toHaveBeenCalled();
    });

    it('should stream content chunks from agent', async () => {
      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      const calls = res.write.mock.calls.map((c) => c[0]);
      const contentCalls = calls.filter((c: string) => c.includes('"content"'));
      expect(contentCalls.length).toBeGreaterThan(0);
    });

    it('should return 405 for non-POST requests', () => {
      const req = createMockRequest({ url: '/api/stream', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(405);
      expect(res.end).toHaveBeenCalledWith('Method not allowed');
    });

    it('should handle streaming errors', async () => {
      mockAgent.processUserMessageStream.mockImplementation(async function* () {
        yield { type: 'error', content: 'Stream error' };
        throw new Error('Stream error');
      });

      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      const calls = res.write.mock.calls.map((c) => c[0]);
      const errorCall = calls.find((c: string) => c.includes('"type":"error"'));
      expect(errorCall).toBeDefined();
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('Route Handling - /api/history', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should return empty history initially', () => {
      const req = createMockRequest({ url: '/api/history', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith('{"history":[]}');
    });

    it('should return accumulated history after chat', async () => {
      // First, make a chat request
      const chatReq = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const chatRes = createMockResponse();
      requestHandler(chatReq as unknown as IncomingMessage, chatRes as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Then get history
      const historyReq = createMockRequest({ url: '/api/history', method: 'GET' });
      const historyRes = createMockResponse();
      requestHandler(historyReq as unknown as IncomingMessage, historyRes as unknown as ServerResponse);

      expect(historyRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      const response = JSON.parse(historyRes.end.mock.calls[0][0]);
      expect(response.history.length).toBeGreaterThan(0);
    });
  });

  describe('Route Handling - /api/model', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should return current model on GET', () => {
      const req = createMockRequest({ url: '/api/model', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(mockAgent.getCurrentModel).toHaveBeenCalled();
      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      const body = JSON.parse(res.end.mock.calls[0][0]);
      expect(body.model).toBe('grok-3-fast');
      expect(body.models).toContain('grok-4.7');
      expect(body.models).toContain(body.model);
    });

    it('should set model on POST', async () => {
      const req = createMockRequest({
        url: '/api/model',
        method: 'POST',
        body: JSON.stringify({ model: 'grok-4-latest' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockAgent.setModel).toHaveBeenCalledWith('grok-4-latest');
      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(
        expect.stringContaining('"success":true')
      );
    });

    it('should handle model set errors', async () => {
      mockAgent.setModel.mockImplementation(function() {
        throw new Error('Invalid model');
      });

      const req = createMockRequest({
        url: '/api/model',
        method: 'POST',
        body: JSON.stringify({ model: 'invalid-model' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(
        expect.stringContaining('Invalid model')
      );
    });
  });

  describe('Error Responses', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should return 404 for unknown routes', () => {
      const req = createMockRequest({ url: '/unknown', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalledWith('Not found');
    });

    it('should return 404 for /api/unknown', () => {
      const req = createMockRequest({ url: '/api/unknown', method: 'GET' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalledWith('Not found');
    });

    it('should return 405 for wrong HTTP methods', () => {
      const req = createMockRequest({ url: '/api/chat', method: 'PUT' });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(405);
      expect(res.end).toHaveBeenCalledWith('Method not allowed');
    });
  });

  describe('Request Parsing', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should parse JSON body correctly', async () => {
      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: 'Test message with special chars: <>&"' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockAgent.processUserMessage).toHaveBeenCalledWith(
        'Test message with special chars: <>&"',
        { surface: 'http' },
      );
    });

    it('should handle unicode in JSON body', async () => {
      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello \u4E16\u754C \u{1F600}' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockAgent.processUserMessage).toHaveBeenCalledWith(
        'Hello \u4E16\u754C \u{1F600}',
        { surface: 'http' },
      );
    });

    it('should handle empty body', async () => {
      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: '',
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should fail with JSON parse error
      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
    });

    it('should handle chunked body data', async () => {
      const req = Object.assign(new EventEmitter(), {
        url: '/api/chat',
        method: 'POST',
        headers: { host: 'localhost:3000' },
      }) as MockRequest;

      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      // Simulate chunked data
      setTimeout(() => {
        req.emit('data', '{"message"');
        req.emit('data', ':"chunked"}');
        req.emit('end');
      }, 0);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(mockAgent.processUserMessage).toHaveBeenCalledWith('chunked', { surface: 'http' });
    });

    it('should handle body read errors', async () => {
      const req = Object.assign(new EventEmitter(), {
        url: '/api/chat',
        method: 'POST',
        headers: { host: 'localhost:3000' },
      }) as MockRequest;

      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      // Simulate read error
      setTimeout(() => {
        req.emit('error', new Error('Connection reset'));
      }, 0);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
    });
  });

  describe('Shutdown', () => {
    it('should close server on stop()', async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();

      server.stop();

      expect(mockServer.close).toHaveBeenCalled();
    });

    it('should handle stop() when server not started', () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });

      // Should not throw
      expect(() => server.stop()).not.toThrow();
    });

    it('should handle multiple stop() calls', async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();

      server.stop();
      server.stop();

      // close should only be called once (on first stop)
      expect(mockServer.close).toHaveBeenCalledTimes(1);
    });

    it('should set server to null after stop', async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();

      server.stop();

      // Second stop should not throw
      expect(() => server.stop()).not.toThrow();
    });
  });

  describe('SSE Streaming Format', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should include timestamp in user entry', async () => {
      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      const calls = res.write.mock.calls.map((c) => c[0]);
      const userEntryCall = calls.find((c: string) => c.includes('"type":"user"'));
      expect(userEntryCall).toContain('timestamp');
    });

    it('should stream multiple content chunks', async () => {
      mockAgent.processUserMessageStream.mockImplementation(async function* () {
        yield { type: 'content', content: 'First' };
        yield { type: 'content', content: 'Second' };
        yield { type: 'content', content: 'Third' };
      });

      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      const calls = res.write.mock.calls.map((c) => c[0]);
      expect(calls.filter((c: string) => c.includes('"content"')).length).toBeGreaterThanOrEqual(3);
    });

    it('should handle tool result chunks', async () => {
      mockAgent.processUserMessageStream.mockImplementation(async function* () {
        yield {
          type: 'tool_result',
          toolCall: { function: { name: 'bash' } },
          toolResult: { output: 'file1.txt\nfile2.txt' },
        };
      });

      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'List files' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      const calls = res.write.mock.calls.map((c) => c[0]);
      const toolResultCall = calls.find((c: string) => c.includes('tool_result'));
      expect(toolResultCall).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should handle URL with query parameters', () => {
      const req = createMockRequest({
        url: '/?param=value',
        method: 'GET',
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
    });

    it('should handle missing host header', () => {
      const req = createMockRequest({
        url: '/',
        method: 'GET',
        headers: {},
      });
      const res = createMockResponse();

      // Should not throw
      expect(() => {
        requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
      }).not.toThrow();
    });

    it('should handle very long messages', async () => {
      const longMessage = 'A'.repeat(100000);
      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: longMessage }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockAgent.processUserMessage).toHaveBeenCalledWith(longMessage, { surface: 'http' });
    });

    it('should handle non-Error exceptions', async () => {
      mockAgent.processUserMessage.mockRejectedValueOnce('String error');

      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(
        expect.stringContaining('String error')
      );
    });

    it('should handle null/undefined in error objects', async () => {
      mockAgent.processUserMessage.mockRejectedValueOnce(null);

      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
    });

    it('should handle URL with trailing slash', () => {
      const req = createMockRequest({
        url: '/api/history/',
        method: 'GET',
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      // Depending on implementation, may return 404 or redirect
      // Current implementation would return 404 since paths don't match exactly
      expect(res.writeHead).toHaveBeenCalled();
    });
  });

  describe('History Management', () => {
    beforeEach(async () => {
      server = new HttpServer({ agent: mockAgent as unknown as HttpServerOptions['agent'] });
      await server.start();
    });

    it('should accumulate entries from streaming responses', async () => {
      const req = createMockRequest({
        url: '/api/stream',
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Check history
      const historyReq = createMockRequest({ url: '/api/history', method: 'GET' });
      const historyRes = createMockResponse();
      requestHandler(historyReq as unknown as IncomingMessage, historyRes as unknown as ServerResponse);

      const response = JSON.parse(historyRes.end.mock.calls[0][0]);
      expect(response.history.length).toBeGreaterThan(0);
      expect(response.history[0].type).toBe('user');
      expect(response.history[0].content).toBe('Hello');
    });

    it('should accumulate entries from non-streaming responses', async () => {
      const req = createMockRequest({
        url: '/api/chat',
        method: 'POST',
        body: JSON.stringify({ message: 'Test' }),
      });
      const res = createMockResponse();

      requestHandler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Check history
      const historyReq = createMockRequest({ url: '/api/history', method: 'GET' });
      const historyRes = createMockResponse();
      requestHandler(historyReq as unknown as IncomingMessage, historyRes as unknown as ServerResponse);

      const response = JSON.parse(historyRes.end.mock.calls[0][0]);
      expect(response.history.length).toBeGreaterThan(0);
    });
  });
});
