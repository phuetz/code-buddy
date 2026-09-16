import { afterEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { MCPManager } from '../../src/mcp/client.js';

async function startSseLikeEndpoint(): Promise<{
  url: string;
  getRequestCount: () => number;
  close: () => Promise<void>;
}> {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    if (req.url === '/mcp') {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('Legacy SSE endpoint requires a different protocol');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    getRequestCount: () => requestCount,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe('MCPManager streamable HTTP limitation guard', () => {
  let manager: MCPManager | null = null;
  let endpoint: Awaited<ReturnType<typeof startSseLikeEndpoint>> | null = null;

  afterEach(async () => {
    await manager?.dispose();
    manager = null;
    await endpoint?.close();
    endpoint = null;
  });

  it('rejects an incompatible endpoint without exposing a tool catalog', async () => {
    endpoint = await startSseLikeEndpoint();
    manager = new MCPManager();

    await expect(
      manager.addServer({
        name: 'qa_streamable',
        transport: {
          type: 'streamable_http',
          url: endpoint.url,
        },
      }),
    ).rejects.toThrow();

    expect(manager.getServerStatus('qa_streamable')).toBe('error');
    expect(manager.getTransportType('qa_streamable')).toBe('streamable_http');
    expect(manager.getTools()).toHaveLength(0);
    expect(endpoint.getRequestCount()).toBeGreaterThan(0);
  }, 15_000);
});
