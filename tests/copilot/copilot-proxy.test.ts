import { CopilotProxy } from '../../src/copilot/copilot-proxy.js';
import http from 'http';

describe('CopilotProxy', () => {
  let proxy: CopilotProxy;
  let currentPort = 19876;

  function createProxy(overrides: Record<string, unknown> = {}): CopilotProxy {
    currentPort++; // Use different port each test to avoid conflicts
    return new CopilotProxy({
      port: currentPort,
      host: '127.0.0.1',
      authToken: 'test-token',
      requireAuth: true,
      maxTokens: 100,
      maxTokensLimit: 500,
      rateLimitPerMinute: 100,
      onCompletion: async () => ({
        id: 'test-1',
        choices: [{ text: 'hello', index: 0, finish_reason: 'stop' as const }],
      }),
      ...overrides,
    });
  }

  afterEach(async () => {
    if (proxy?.isRunning()) {
      await proxy.stop();
    }
  });

  function makeRequest(port: number, options: http.RequestOptions, body?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, ...options }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  it('should reject requests without auth token', async () => {
    proxy = createProxy();
    await proxy.start();
    const res = await makeRequest(currentPort, { path: '/health', method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('should accept requests with valid auth token', async () => {
    proxy = createProxy();
    await proxy.start();
    const res = await makeRequest(currentPort, {
      path: '/health',
      method: 'GET',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
  });

  it('should enforce rate limiting', async () => {
    proxy = createProxy({ rateLimitPerMinute: 3 });
    await proxy.start();
    const headers = { authorization: 'Bearer test-token' };

    // Send requests up to the limit
    for (let i = 0; i < 3; i++) {
      const res = await makeRequest(currentPort, { path: '/health', method: 'GET', headers });
      expect(res.status).toBe(200);
    }

    // Next request should be rate limited
    const res = await makeRequest(currentPort, { path: '/health', method: 'GET', headers });
    expect(res.status).toBe(429);
  });

  it('should track request count', async () => {
    proxy = createProxy();
    await proxy.start();
    expect(proxy.getRequestCount()).toBe(0);
    await makeRequest(currentPort, { path: '/health', method: 'GET', headers: { authorization: 'Bearer test-token' } });
    expect(proxy.getRequestCount()).toBe(1);
  });

  it('should report running state', async () => {
    proxy = createProxy();
    expect(proxy.isRunning()).toBe(false);
    await proxy.start();
    expect(proxy.isRunning()).toBe(true);
    await proxy.stop();
    expect(proxy.isRunning()).toBe(false);
  });

  it('should reject when requireAuth is true and no token configured', async () => {
    proxy = createProxy({ authToken: undefined, requireAuth: true });
    await proxy.start();
    const res = await makeRequest(currentPort, { path: '/health', method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('should allow when no auth token and requireAuth is false', async () => {
    proxy = createProxy({ authToken: undefined, requireAuth: false });
    await proxy.start();
    const res = await makeRequest(currentPort, { path: '/health', method: 'GET' });
    expect(res.status).toBe(200);
  });
});
