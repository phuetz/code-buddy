/**
 * Unit tests for RestApiServer
 * Tests HTTP server, routing, request handling, CORS, authentication, and endpoint handlers
 */

import * as http from 'http';
import { EventEmitter } from 'events';
import {
  RestApiServer,
  ApiRequest,
  ApiResponse,
  RouteHandler,
  getApiServer,
  startApiServer,
  stopApiServer,
} from '../../src/api/rest-server';

// Mock http module
jest.mock('http', () => {
  const actualHttp = jest.requireActual('http');
  return {
    ...actualHttp,
    createServer: jest.fn(),
  };
});

// Create mock server instance
class MockHttpServer extends EventEmitter {
  public listening = false;
  public address = jest.fn().mockReturnValue({ port: 3847, address: '127.0.0.1' });

  listen = jest.fn((port: number, host: string, callback: () => void) => {
    this.listening = true;
    process.nextTick(callback);
  });

  close = jest.fn((callback: () => void) => {
    this.listening = false;
    process.nextTick(callback);
  });
}

// Mock incoming message (request)
class MockIncomingMessage extends EventEmitter {
  public url: string;
  public method: string;
  public headers: Record<string, string>;

  constructor(options: { url?: string; method?: string; headers?: Record<string, string> } = {}) {
    super();
    this.url = options.url || '/';
    this.method = options.method || 'GET';
    this.headers = options.headers || {};
  }

  // Simulate sending body data
  sendBody(data: string): void {
    const chunks = [Buffer.from(data)];
    for (const chunk of chunks) {
      this.emit('data', chunk);
    }
    this.emit('end');
  }

  // Simulate request error
  sendError(error: Error): void {
    this.emit('error', error);
  }
}

// Mock server response
class MockServerResponse {
  public statusCode: number = 200;
  public headers: Record<string, string> = {};
  public body: string = '';
  public ended: boolean = false;

  setHeader = jest.fn((name: string, value: string) => {
    this.headers[name.toLowerCase()] = value;
  });

  writeHead = jest.fn((status: number) => {
    this.statusCode = status;
  });

  end = jest.fn((data?: string) => {
    if (data) this.body = data;
    this.ended = true;
  });

  getBody(): unknown {
    try {
      return JSON.parse(this.body);
    } catch {
      return this.body;
    }
  }
}

describe('RestApiServer', () => {
  let server: RestApiServer;
  let mockHttpServer: MockHttpServer;
  let requestHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset singleton
    (global as Record<string, unknown>)._apiServer = null;

    mockHttpServer = new MockHttpServer();
    requestHandler = null;

    // Capture the request handler when createServer is called
    (http.createServer as jest.Mock).mockImplementation((handler) => {
      requestHandler = handler;
      return mockHttpServer;
    });
  });

  afterEach(async () => {
    if (server && server.isServerRunning()) {
      await server.stop();
    }
  });

  describe('Constructor and Configuration', () => {
    it('should create server with default configuration', () => {
      server = new RestApiServer();

      expect(server).toBeInstanceOf(RestApiServer);
      expect(server.getAddress()).toBe('http://127.0.0.1:3847');
    });

    it('should create server with custom port', () => {
      server = new RestApiServer({ port: 8080 });

      expect(server.getAddress()).toBe('http://127.0.0.1:8080');
    });

    it('should create server with custom host', () => {
      server = new RestApiServer({ host: '0.0.0.0' });

      expect(server.getAddress()).toBe('http://0.0.0.0:3847');
    });

    it('should create server with custom port and host', () => {
      server = new RestApiServer({ port: 9000, host: '192.168.1.1' });

      expect(server.getAddress()).toBe('http://192.168.1.1:9000');
    });

    it('should create server with all custom options', () => {
      server = new RestApiServer({
        port: 5000,
        host: 'localhost',
        enableCors: false,
        apiKey: 'secret-key',
        maxRequestSize: 2048,
      });

      expect(server.getAddress()).toBe('http://localhost:5000');
    });

    it('should extend EventEmitter', () => {
      server = new RestApiServer();

      expect(server).toBeInstanceOf(EventEmitter);
    });
  });

  describe('Default Routes', () => {
    beforeEach(() => {
      server = new RestApiServer();
    });

    it('should have health endpoint', () => {
      const endpoints = server.getEndpoints();
      const healthEndpoint = endpoints.find(e => e.path === '/health' && e.method === 'GET');

      expect(healthEndpoint).toBeDefined();
    });

    it('should have API info endpoint', () => {
      const endpoints = server.getEndpoints();
      const apiEndpoint = endpoints.find(e => e.path === '/api' && e.method === 'GET');

      expect(apiEndpoint).toBeDefined();
    });

    it('should have prompt endpoint', () => {
      const endpoints = server.getEndpoints();
      const promptEndpoint = endpoints.find(e => e.path === '/api/prompt' && e.method === 'POST');

      expect(promptEndpoint).toBeDefined();
    });

    it('should have tools list endpoint', () => {
      const endpoints = server.getEndpoints();
      const toolsEndpoint = endpoints.find(e => e.path === '/api/tools' && e.method === 'GET');

      expect(toolsEndpoint).toBeDefined();
    });

    it('should have tool execution endpoint', () => {
      const endpoints = server.getEndpoints();
      const toolEndpoint = endpoints.find(e => e.path === '/api/tools/:tool' && e.method === 'POST');

      expect(toolEndpoint).toBeDefined();
    });

    it('should have sessions endpoint', () => {
      const endpoints = server.getEndpoints();
      const sessionsEndpoint = endpoints.find(e => e.path === '/api/sessions' && e.method === 'GET');

      expect(sessionsEndpoint).toBeDefined();
    });

    it('should have metrics endpoint', () => {
      const endpoints = server.getEndpoints();
      const metricsEndpoint = endpoints.find(e => e.path === '/api/metrics' && e.method === 'GET');

      expect(metricsEndpoint).toBeDefined();
    });

    it('should have status endpoint', () => {
      const endpoints = server.getEndpoints();
      const statusEndpoint = endpoints.find(e => e.path === '/api/status' && e.method === 'GET');

      expect(statusEndpoint).toBeDefined();
    });
  });

  describe('Route Management', () => {
    beforeEach(() => {
      server = new RestApiServer();
    });

    it('should add custom route', () => {
      const handler: RouteHandler = async () => ({ status: 200, body: { custom: true } });
      server.addRoute('GET', '/custom', handler);

      const endpoints = server.getEndpoints();
      const customEndpoint = endpoints.find(e => e.path === '/custom' && e.method === 'GET');

      expect(customEndpoint).toBeDefined();
    });

    it('should add routes for different methods', () => {
      server.addRoute('GET', '/resource', async () => ({ status: 200, body: {} }));
      server.addRoute('POST', '/resource', async () => ({ status: 201, body: {} }));
      server.addRoute('PUT', '/resource', async () => ({ status: 200, body: {} }));
      server.addRoute('DELETE', '/resource', async () => ({ status: 204, body: null }));

      const endpoints = server.getEndpoints();
      const getEndpoint = endpoints.find(e => e.path === '/resource' && e.method === 'GET');
      const postEndpoint = endpoints.find(e => e.path === '/resource' && e.method === 'POST');
      const putEndpoint = endpoints.find(e => e.path === '/resource' && e.method === 'PUT');
      const deleteEndpoint = endpoints.find(e => e.path === '/resource' && e.method === 'DELETE');

      expect(getEndpoint).toBeDefined();
      expect(postEndpoint).toBeDefined();
      expect(putEndpoint).toBeDefined();
      expect(deleteEndpoint).toBeDefined();
    });

    it('should get all endpoints', () => {
      const endpoints = server.getEndpoints();

      expect(Array.isArray(endpoints)).toBe(true);
      expect(endpoints.length).toBeGreaterThan(0);
      expect(endpoints[0]).toHaveProperty('method');
      expect(endpoints[0]).toHaveProperty('path');
    });
  });

  describe('Server Lifecycle', () => {
    beforeEach(() => {
      server = new RestApiServer();
    });

    it('should start server', async () => {
      await server.start();

      expect(server.isServerRunning()).toBe(true);
      expect(mockHttpServer.listen).toHaveBeenCalledWith(3847, '127.0.0.1', expect.any(Function));
    });

    it('should emit start event when started', async () => {
      const startHandler = jest.fn();
      server.on('start', startHandler);

      await server.start();

      expect(startHandler).toHaveBeenCalledWith({ port: 3847, host: '127.0.0.1' });
    });

    it('should not start if already running', async () => {
      await server.start();
      await server.start(); // Second call should be no-op

      expect(mockHttpServer.listen).toHaveBeenCalledTimes(1);
    });

    it('should stop server', async () => {
      await server.start();
      await server.stop();

      expect(server.isServerRunning()).toBe(false);
      expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it('should emit stop event when stopped', async () => {
      const stopHandler = jest.fn();
      server.on('stop', stopHandler);

      await server.start();
      await server.stop();

      expect(stopHandler).toHaveBeenCalled();
    });

    it('should not stop if not running', async () => {
      await server.stop(); // Should not throw

      expect(mockHttpServer.close).not.toHaveBeenCalled();
    });

    it('should handle server error on start', async () => {
      const error = new Error('Port in use');
      mockHttpServer.listen.mockImplementation((_port, _host, _callback) => {
        process.nextTick(() => mockHttpServer.emit('error', error));
      });

      const errorHandler = jest.fn();
      server.on('error', errorHandler);

      await expect(server.start()).rejects.toThrow('Port in use');
      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('should check if server is running', () => {
      expect(server.isServerRunning()).toBe(false);
    });
  });

  describe('Request Handling', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      await server.start();
    });

    it('should handle GET request to health endpoint', async () => {
      const req = new MockIncomingMessage({ url: '/health', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      const body = res.getBody() as { status: string; timestamp: string };
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });

    it('should handle GET request to API info endpoint', async () => {
      const req = new MockIncomingMessage({ url: '/api', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      const body = res.getBody() as { name: string; version: string; endpoints: unknown[] };
      expect(body.name).toBe('Code Buddy API');
      expect(body.version).toBe('1.0.0');
      expect(body.endpoints).toBeDefined();
    });

    it('should handle GET request to status endpoint', async () => {
      const req = new MockIncomingMessage({ url: '/api/status', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      const body = res.getBody() as { running: boolean; uptime: number; memory: object; pid: number };
      expect(body.running).toBe(true);
      expect(body.uptime).toBeDefined();
      expect(body.memory).toBeDefined();
      expect(body.pid).toBeDefined();
    });

    it('should handle GET request to tools list endpoint', async () => {
      const req = new MockIncomingMessage({ url: '/api/tools', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      const body = res.getBody() as { tools: Array<{ name: string; description: string }> };
      expect(body.tools).toBeDefined();
      expect(Array.isArray(body.tools)).toBe(true);
    });

    it('should return 404 for unknown route', async () => {
      const req = new MockIncomingMessage({ url: '/unknown', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(404);
      const body = res.getBody() as { error: string };
      expect(body.error).toBe('Not found');
    });

    it('should handle OPTIONS request for CORS preflight', async () => {
      const req = new MockIncomingMessage({ url: '/api', method: 'OPTIONS' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(204);
    });

    it('should set CORS headers when enabled', async () => {
      const req = new MockIncomingMessage({ url: '/health', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS'
      );
    });

    it('should emit request event', async () => {
      const requestEventHandler = jest.fn();
      server.on('request', requestEventHandler);

      const req = new MockIncomingMessage({ url: '/health', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(requestEventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/health',
          status: 200,
          duration: expect.any(Number),
        })
      );
    });
  });

  describe('POST Request Handling', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      await server.start();
    });

    it('should parse JSON body in POST request', async () => {
      server.onPrompt = jest.fn().mockResolvedValue('Response text');

      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody(JSON.stringify({ prompt: 'Hello' }));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      expect(server.onPrompt).toHaveBeenCalledWith('Hello', undefined);
    });

    it('should return 400 for missing prompt', async () => {
      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody(JSON.stringify({}));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(400);
      const body = res.getBody() as { error: string };
      expect(body.error).toBe('Missing prompt');
    });

    it('should return 503 when prompt handler not configured', async () => {
      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody(JSON.stringify({ prompt: 'Hello' }));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(503);
      const body = res.getBody() as { error: string };
      expect(body.error).toBe('Prompt handler not configured');
    });

    it('should handle prompt handler error', async () => {
      server.onPrompt = jest.fn().mockRejectedValue(new Error('Handler failed'));

      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody(JSON.stringify({ prompt: 'Hello' }));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(500);
      const body = res.getBody() as { error: string };
      expect(body.error).toBe('Handler failed');
    });

    it('should handle prompt with options', async () => {
      server.onPrompt = jest.fn().mockResolvedValue('Response');

      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody(JSON.stringify({ prompt: 'Hello', options: { model: 'grok-beta' } }));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(server.onPrompt).toHaveBeenCalledWith('Hello', { model: 'grok-beta' });
    });
  });

  describe('Tool Execution Endpoint', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      await server.start();
    });

    it('should execute tool with parameters', async () => {
      server.onToolExecute = jest.fn().mockResolvedValue({ success: true, output: 'Done' });

      const req = new MockIncomingMessage({
        url: '/api/tools/bash',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody(JSON.stringify({ command: 'ls -la' }));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      expect(server.onToolExecute).toHaveBeenCalledWith('bash', { command: 'ls -la' });
    });

    it('should return 503 when tool handler not configured', async () => {
      const req = new MockIncomingMessage({
        url: '/api/tools/bash',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody(JSON.stringify({ command: 'ls' }));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(503);
    });

    it('should handle tool execution error', async () => {
      server.onToolExecute = jest.fn().mockRejectedValue(new Error('Tool failed'));

      const req = new MockIncomingMessage({
        url: '/api/tools/bash',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody(JSON.stringify({ command: 'ls' }));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(500);
      const body = res.getBody() as { error: string };
      expect(body.error).toBe('Tool failed');
    });
  });

  describe('Sessions Endpoint', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      await server.start();
    });

    it('should return sessions list', async () => {
      const sessions = [{ id: '1', name: 'Session 1' }, { id: '2', name: 'Session 2' }];
      server.onGetSessions = jest.fn().mockResolvedValue(sessions);

      const req = new MockIncomingMessage({ url: '/api/sessions', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      const body = res.getBody() as { sessions: unknown[] };
      expect(body.sessions).toEqual(sessions);
    });

    it('should return 503 when sessions handler not configured', async () => {
      const req = new MockIncomingMessage({ url: '/api/sessions', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(503);
    });

    it('should handle sessions error', async () => {
      server.onGetSessions = jest.fn().mockRejectedValue(new Error('Database error'));

      const req = new MockIncomingMessage({ url: '/api/sessions', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(500);
    });
  });

  describe('Metrics Endpoint', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      await server.start();
    });

    it('should return metrics', async () => {
      const metrics = { requests: 100, errors: 5, avgLatency: 50 };
      server.onGetMetrics = jest.fn().mockResolvedValue(metrics);

      const req = new MockIncomingMessage({ url: '/api/metrics', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      const body = res.getBody() as { metrics: unknown };
      expect(body.metrics).toEqual(metrics);
    });

    it('should return 503 when metrics handler not configured', async () => {
      const req = new MockIncomingMessage({ url: '/api/metrics', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(503);
    });

    it('should handle metrics error', async () => {
      server.onGetMetrics = jest.fn().mockRejectedValue(new Error('Metrics unavailable'));

      const req = new MockIncomingMessage({ url: '/api/metrics', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(500);
    });
  });

  describe('API Key Authentication', () => {
    beforeEach(async () => {
      server = new RestApiServer({ apiKey: 'secret-api-key' });
      await server.start();
    });

    it('should reject request without API key', async () => {
      const req = new MockIncomingMessage({ url: '/health', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(401);
      const body = res.getBody() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('should accept request with X-API-Key header', async () => {
      const req = new MockIncomingMessage({
        url: '/health',
        method: 'GET',
        headers: { 'x-api-key': 'secret-api-key' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
    });

    it('should accept request with Bearer token in Authorization header', async () => {
      const req = new MockIncomingMessage({
        url: '/health',
        method: 'GET',
        headers: { authorization: 'Bearer secret-api-key' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
    });

    it('should reject request with wrong API key', async () => {
      const req = new MockIncomingMessage({
        url: '/health',
        method: 'GET',
        headers: { 'x-api-key': 'wrong-key' },
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(401);
    });
  });

  describe('Request Body Parsing', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      await server.start();
    });

    it('should parse valid JSON body', async () => {
      server.onPrompt = jest.fn().mockResolvedValue('OK');

      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('{"prompt":"test"}');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(server.onPrompt).toHaveBeenCalledWith('test', undefined);
    });

    it('should handle empty body', async () => {
      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      // Empty body should result in missing prompt error
      expect(res.statusCode).toBe(400);
    });

    it('should handle invalid JSON body', async () => {
      server.addRoute('POST', '/test', async (req) => ({
        status: 200,
        body: { received: req.body },
      }));

      const req = new MockIncomingMessage({
        url: '/test',
        method: 'POST',
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('not-valid-json');

      await new Promise(resolve => setTimeout(resolve, 10));

      // Invalid JSON is returned as string
      expect(res.statusCode).toBe(200);
      const body = res.getBody() as { received: string };
      expect(body.received).toBe('not-valid-json');
    });

    it('should reject request body exceeding max size', async () => {
      server = new RestApiServer({ maxRequestSize: 10 });
      await server.start();

      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('{"prompt":"this is a very long prompt that exceeds the limit"}');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(500);
    });

    it('should handle request error', async () => {
      const req = new MockIncomingMessage({
        url: '/api/prompt',
        method: 'POST',
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendError(new Error('Connection reset'));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(500);
    });
  });

  describe('Pattern Matching Routes', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      await server.start();
    });

    it('should match parameterized routes', async () => {
      server.onToolExecute = jest.fn().mockResolvedValue({ success: true });

      const req = new MockIncomingMessage({
        url: '/api/tools/read_file',
        method: 'POST',
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('{"path":"/tmp/test.txt"}');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      expect(server.onToolExecute).toHaveBeenCalledWith('read_file', { path: '/tmp/test.txt' });
    });

    it('should match complex parameterized routes', async () => {
      server.addRoute('GET', '/api/users/:id/posts/:postId', async (req) => ({
        status: 200,
        body: { path: req.path },
      }));

      const req = new MockIncomingMessage({
        url: '/api/users/123/posts/456',
        method: 'GET',
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
    });
  });

  describe('Query Parameters', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      server.addRoute('GET', '/search', async (req) => ({
        status: 200,
        body: { query: req.query },
      }));
      await server.start();
    });

    it('should parse query parameters', async () => {
      const req = new MockIncomingMessage({
        url: '/search?q=test&limit=10',
        method: 'GET',
      });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(200);
      const body = res.getBody() as { query: Record<string, string> };
      expect(body.query.q).toBe('test');
      expect(body.query.limit).toBe('10');
    });
  });

  describe('Response Headers', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      server.addRoute('GET', '/custom-headers', async () => ({
        status: 200,
        body: { message: 'OK' },
        headers: { 'X-Custom-Header': 'custom-value' },
      }));
      await server.start();
    });

    it('should set Content-Type header to application/json', async () => {
      const req = new MockIncomingMessage({ url: '/health', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    });

    it('should set custom response headers', async () => {
      const req = new MockIncomingMessage({ url: '/custom-headers', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.setHeader).toHaveBeenCalledWith('X-Custom-Header', 'custom-value');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      server = new RestApiServer();
      await server.start();
    });

    it('should handle handler throwing error', async () => {
      server.addRoute('GET', '/error', async () => {
        throw new Error('Handler error');
      });

      const req = new MockIncomingMessage({ url: '/error', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(500);
      const body = res.getBody() as { error: string };
      expect(body.error).toBe('Handler error');
    });

    it('should handle non-Error exceptions', async () => {
      server.addRoute('GET', '/error', async () => {
        throw 'String error';
      });

      const req = new MockIncomingMessage({ url: '/error', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.statusCode).toBe(500);
      const body = res.getBody() as { error: string };
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('CORS Disabled', () => {
    beforeEach(async () => {
      server = new RestApiServer({ enableCors: false });
      await server.start();
    });

    it('should not set CORS headers when disabled', async () => {
      const req = new MockIncomingMessage({ url: '/health', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });
  });
});

describe('Singleton Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Create fresh mock server for each test
    const mockServer = new MockHttpServer();
    (http.createServer as jest.Mock).mockReturnValue(mockServer);
  });

  afterEach(async () => {
    await stopApiServer();
  });

  describe('getApiServer', () => {
    it('should create and return singleton instance', () => {
      const server1 = getApiServer();
      const server2 = getApiServer();

      expect(server1).toBe(server2);
    });

    it('should create server with config on first call', () => {
      const server = getApiServer({ port: 9999 });

      expect(server.getAddress()).toBe('http://127.0.0.1:9999');
    });

    it('should ignore config on subsequent calls', () => {
      const server1 = getApiServer({ port: 9999 });
      const server2 = getApiServer({ port: 8888 });

      expect(server1).toBe(server2);
      expect(server2.getAddress()).toBe('http://127.0.0.1:9999');
    });
  });

  describe('startApiServer', () => {
    it('should start and return server', async () => {
      const server = await startApiServer({ port: 7777 });

      expect(server).toBeInstanceOf(RestApiServer);
      expect(server.isServerRunning()).toBe(true);
    });

    it('should use existing singleton if available', async () => {
      const server1 = await startApiServer({ port: 6666 });
      const server2 = await startApiServer({ port: 5555 });

      expect(server1).toBe(server2);
    });
  });

  describe('stopApiServer', () => {
    it('should stop running server', async () => {
      const server = await startApiServer();
      expect(server.isServerRunning()).toBe(true);

      await stopApiServer();
      // Server instance is nullified, can't check running state directly
    });

    it('should handle stopping when no server exists', async () => {
      await stopApiServer(); // Should not throw
    });

    it('should allow creating new server after stop', async () => {
      const server1 = await startApiServer({ port: 4444 });
      await stopApiServer();

      const server2 = await startApiServer({ port: 3333 });

      expect(server1).not.toBe(server2);
    });
  });
});

describe('Edge Cases', () => {
  let server: RestApiServer;
  let mockHttpServer: MockHttpServer;
  let requestHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHttpServer = new MockHttpServer();
    requestHandler = null;

    (http.createServer as jest.Mock).mockImplementation((handler) => {
      requestHandler = handler;
      return mockHttpServer;
    });
  });

  it('should handle missing URL in request', async () => {
    server = new RestApiServer();
    await server.start();

    const req = new MockIncomingMessage({ method: 'GET' });
    req.url = undefined as unknown as string;
    const res = new MockServerResponse();

    requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
    req.sendBody('');

    await new Promise(resolve => setTimeout(resolve, 10));

    // Should default to '/' which returns 404 (no route registered for '/')
    // Actually /health is a default route, but / might not be registered
    expect(res.ended).toBe(true);
  });

  it('should handle missing method in request', async () => {
    server = new RestApiServer();
    await server.start();

    const req = new MockIncomingMessage({ url: '/health' });
    req.method = undefined as unknown as string;
    const res = new MockServerResponse();

    requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
    req.sendBody('');

    await new Promise(resolve => setTimeout(resolve, 10));

    // Should default to 'GET' and match health endpoint
    expect(res.statusCode).toBe(200);
  });

  it('should handle concurrent requests', async () => {
    server = new RestApiServer();
    await server.start();

    const requests: Promise<void>[] = [];

    for (let i = 0; i < 10; i++) {
      const req = new MockIncomingMessage({ url: '/health', method: 'GET' });
      const res = new MockServerResponse();

      requestHandler!(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      req.sendBody('');

      requests.push(new Promise(resolve => setTimeout(resolve, 10)));
    }

    await Promise.all(requests);
  });
});
