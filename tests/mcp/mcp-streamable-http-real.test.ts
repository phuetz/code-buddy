import { afterEach, describe, expect, it } from 'vitest';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

import { MCPManager } from '../../src/mcp/client.js';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

async function readJson(req: IncomingMessage): Promise<JsonRpcRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRpcRequest;
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startHttpMcpFixture(): Promise<{ baseUrl: string; close: () => Promise<void>; calls: string[] }> {
  const calls: string[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/rpc') {
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.headers.authorization !== 'Bearer fixture-key') { res.writeHead(401); res.end(); return; }
    const rpc = await readJson(req);
    calls.push(rpc.method ?? 'unknown');

    if (rpc.method === 'notifications/initialized') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (rpc.method === 'initialize') {
      sendJson(res, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'qa-http-fixture', version: '1.0.0' },
        },
      });
      return;
    }

    if (rpc.method === 'tools/list') {
      sendJson(res, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          tools: [
            {
              name: 'http_echo_marker',
              description: 'Echo a deterministic marker through the custom HTTP MCP transport.',
              inputSchema: {
                type: 'object',
                properties: { message: { type: 'string' } },
                required: ['message'],
              },
            },
            {
              name: 'http_sum_pair',
              description: 'Add two numbers through the custom HTTP MCP transport.',
              inputSchema: {
                type: 'object',
                properties: {
                  left: { type: 'number' },
                  right: { type: 'number' },
                },
                required: ['left', 'right'],
              },
            },
          ],
        },
      });
      return;
    }

    if (rpc.method === 'tools/call') {
      const args = rpc.params?.arguments ?? {};
      const text =
        rpc.params?.name === 'http_sum_pair'
          ? `MCP_HTTP_SUM:${Number(args.left) + Number(args.right)}`
          : `MCP_HTTP_FIXTURE:${String(args.message ?? '')}`;

      sendJson(res, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          content: [{ type: 'text', text }],
        },
      });
      return;
    }

    sendJson(res, {
      jsonrpc: '2.0',
      id: rpc.id,
      error: { code: -32601, message: `Unknown method ${rpc.method}` },
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe('MCPManager real Streamable HTTP fixture', () => {
  let manager: MCPManager | null = null;
  let fixture: Awaited<ReturnType<typeof startHttpMcpFixture>> | null = null;

  afterEach(async () => {
    await manager?.dispose();
    manager = null;
    await fixture?.close();
    fixture = null;
  });

  it('discovers and invokes tools through a real local HTTP MCP endpoint', async () => {
    fixture = await startHttpMcpFixture();
    manager = new MCPManager();

    await manager.addServer({
      name: 'qa_http',
      transport: {
        type: 'streamable_http',
        url: fixture.baseUrl + '/rpc',
        headers: { Authorization: 'Bearer fixture-key' },
      },
    });

    expect(manager.getServerStatus('qa_http')).toBe('connected');
    expect(manager.getTransportType('qa_http')).toBe('streamable_http');
    expect(fixture.calls).toEqual(
      expect.arrayContaining(['initialize', 'notifications/initialized', 'tools/list'])
    );

    expect(manager.getTools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['mcp__qa_http__http_echo_marker', 'mcp__qa_http__http_sum_pair'])
    );

    const echo = await manager.callTool('mcp__qa_http__http_echo_marker', {
      message: 'OK',
    });
    expect(echo.content).toEqual([{ type: 'text', text: 'MCP_HTTP_FIXTURE:OK' }]);

    const sum = await manager.callTool('mcp__qa_http__http_sum_pair', {
      left: 40,
      right: 2,
    });
    expect(sum.content).toEqual([{ type: 'text', text: 'MCP_HTTP_SUM:42' }]);
    expect(fixture.calls.filter((method) => method === 'tools/call')).toHaveLength(2);
  }, 15_000);
});
