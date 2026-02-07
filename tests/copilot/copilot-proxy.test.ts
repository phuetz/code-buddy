import http from 'http';
import { CopilotProxy, CopilotCompletionRequest, CopilotCompletionResponse, CopilotProxyConfig } from '../../src/copilot/copilot-proxy.js';

function makeRequest(port: number, method: string, path: string, body?: object, headers?: Record<string, string>): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

const mockResponse: CopilotCompletionResponse = {
  id: 'cmpl-test',
  choices: [{ text: 'console.log("hello")', index: 0, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('CopilotProxy', () => {
  describe('unit tests', () => {
    it('should store config in constructor', () => {
      const config: CopilotProxyConfig = {
        port: 5100,
        host: '127.0.0.1',
        maxTokens: 256,
        onCompletion: jest.fn(),
      };
      const proxy = new CopilotProxy(config);
      expect(proxy).toBeInstanceOf(CopilotProxy);
    });

    it('should return false for isRunning before start', () => {
      const proxy = new CopilotProxy({
        port: 0,
        host: '127.0.0.1',
        maxTokens: 256,
        onCompletion: jest.fn(),
      });
      expect(proxy.isRunning()).toBe(false);
    });

    it('should return 0 for getRequestCount initially', () => {
      const proxy = new CopilotProxy({
        port: 0,
        host: '127.0.0.1',
        maxTokens: 256,
        onCompletion: jest.fn(),
      });
      expect(proxy.getRequestCount()).toBe(0);
    });
  });

  describe('server tests (no auth)', () => {
    let proxy: CopilotProxy;
    let port: number;
    const onCompletion = jest.fn<Promise<CopilotCompletionResponse>, [CopilotCompletionRequest]>();

    beforeAll(async () => {
      onCompletion.mockResolvedValue(mockResponse);
      proxy = new CopilotProxy({
        port: 0,
        host: '127.0.0.1',
        maxTokens: 256,
        onCompletion,
      });
      await proxy.start();
      const addr = (proxy as any).server.address();
      port = addr.port;
    });

    afterAll(async () => {
      await proxy.stop();
    });

    it('should be running after start', () => {
      expect(proxy.isRunning()).toBe(true);
    });

    it('GET /health returns 200', async () => {
      const res = await makeRequest(port, 'GET', '/health');
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('ok');
    });

    it('GET /v1/models returns model list', async () => {
      const res = await makeRequest(port, 'GET', '/v1/models');
      expect(res.status).toBe(200);
      expect(res.data.data).toEqual([{ id: 'codebuddy', object: 'model' }]);
    });

    it('POST /v1/completions calls onCompletion and returns result', async () => {
      const res = await makeRequest(port, 'POST', '/v1/completions', { prompt: 'function add(' });
      expect(res.status).toBe(200);
      expect(res.data.id).toBe('cmpl-test');
      expect(res.data.choices[0].text).toBe('console.log("hello")');
      expect(onCompletion).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'function add(' }));
    });

    it('POST /v1/engines/codex/completions works as alias', async () => {
      const res = await makeRequest(port, 'POST', '/v1/engines/codex/completions', { prompt: 'test' });
      expect(res.status).toBe(200);
      expect(res.data.id).toBe('cmpl-test');
    });

    it('POST /v1/completions without prompt returns 400', async () => {
      const res = await makeRequest(port, 'POST', '/v1/completions', { suffix: 'no prompt' });
      expect(res.status).toBe(400);
      expect(res.data.error.message).toContain('prompt');
    });

    it('POST /v1/completions with invalid JSON returns 400', async () => {
      return new Promise<void>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'POST',
          path: '/v1/completions',
          headers: { 'Content-Type': 'application/json', 'Content-Length': 5 },
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            expect(res.statusCode).toBe(400);
            expect(data.error.message).toContain('Invalid JSON');
            resolve();
          });
        });
        req.on('error', reject);
        req.write('{bad}');
        req.end();
      });
    });

    it('GET /unknown returns 404', async () => {
      const res = await makeRequest(port, 'GET', '/unknown');
      expect(res.status).toBe(404);
      expect(res.data.error.code).toBe(404);
    });

    it('increments request count', () => {
      expect(proxy.getRequestCount()).toBeGreaterThan(0);
    });
  });

  describe('server tests (with auth)', () => {
    let proxy: CopilotProxy;
    let port: number;
    const token = 'test-secret-token';

    beforeAll(async () => {
      proxy = new CopilotProxy({
        port: 0,
        host: '127.0.0.1',
        maxTokens: 256,
        authToken: token,
        onCompletion: jest.fn<Promise<CopilotCompletionResponse>, [CopilotCompletionRequest]>().mockResolvedValue(mockResponse),
      });
      await proxy.start();
      const addr = (proxy as any).server.address();
      port = addr.port;
    });

    afterAll(async () => {
      await proxy.stop();
    });

    it('rejects request without token', async () => {
      const res = await makeRequest(port, 'GET', '/health');
      expect(res.status).toBe(401);
    });

    it('rejects request with bad token', async () => {
      const res = await makeRequest(port, 'GET', '/health', undefined, { Authorization: 'Bearer wrong' });
      expect(res.status).toBe(401);
    });

    it('accepts request with valid token', async () => {
      const res = await makeRequest(port, 'GET', '/health', undefined, { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('ok');
    });
  });
});
