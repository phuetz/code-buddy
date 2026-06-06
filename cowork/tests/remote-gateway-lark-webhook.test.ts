import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { RemoteGateway } from '../src/main/remote/gateway';
import type { GatewayConfig, IChannel, RemoteMessage, RemoteResponse } from '../src/main/remote/types';
import type { MessageRouter } from '../src/main/remote/message-router';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

class MockRequest extends EventEmitter {
  headers = { 'content-type': 'application/json' };
  socket = { remoteAddress: '127.0.0.1' };
  destroy = vi.fn();
}

class MockResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = '';

  writeHead(statusCode: number, headers: Record<string, string>) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  end(body: string) {
    this.body = body;
  }
}

function createGateway(): RemoteGateway {
  const config: GatewayConfig = {
    enabled: true,
    port: 18789,
    bind: '127.0.0.1',
    auth: { mode: 'allowlist', allowlist: [] },
  };

  const messageRouter = {
    onResponse: vi.fn(),
    getActiveSessionCount: vi.fn(() => 0),
  } as unknown as MessageRouter;

  return new RemoteGateway(config, messageRouter);
}

function createFeishuChannel(): IChannel {
  return {
    type: 'feishu',
    connected: true,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async (_response: RemoteResponse) => {}),
    onMessage: vi.fn((_handler: (message: RemoteMessage) => void) => {}),
    onError: vi.fn((_handler: (error: Error) => void) => {}),
  };
}

describe('RemoteGateway Lark webhook alias', () => {
  it('routes /webhook/lark to the Feishu channel listener', () => {
    const gateway = createGateway();
    gateway.registerChannel(createFeishuChannel());

    const webhookHandler = vi.fn((data: { body: string; respond: (status: number, data: unknown) => void }) => {
      data.respond(200, { code: 0, received: data.body });
    });
    gateway.on('webhook:feishu', webhookHandler);

    const req = new MockRequest();
    const res = new MockResponse();

    (
      gateway as unknown as {
        handleWebhook: (req: MockRequest, res: MockResponse, url: string) => void;
      }
    ).handleWebhook(req, res, '/webhook/lark');
    req.emit('data', Buffer.from('{"event":"ping"}'));
    req.emit('end');

    expect(webhookHandler).toHaveBeenCalledTimes(1);
    expect(webhookHandler.mock.calls[0][0].body).toBe('{"event":"ping"}');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ code: 0, received: '{"event":"ping"}' });
  });
});
