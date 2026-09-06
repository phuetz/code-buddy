/**
 * Webhook server request handling — D5 leak of error.message in HTTP 500.
 */

import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import { WebhookServer } from '../../src/channels/webhook-server.js';
import { resetChannelLaneQueue } from '../../src/channels/index.js';
import { logger } from '../../src/utils/logger.js';

describe('WebhookServer handleRequest', () => {
  afterEach(() => {
    resetChannelLaneQueue();
  });

  it('D5: une 500 ne renvoie pas error.message brut au client', async () => {
    const server = new WebhookServer({ port: 0, host: '127.0.0.1' });
    server.on('error', () => {});
    server.registerHandler('/test', async () => {
      throw new Error('Telegram returned 401: invalid bot token ABC:XYZ');
    });

    const req = new EventEmitter() as IncomingMessage & EventEmitter;
    req.url = '/webhook/test';
    req.method = 'POST';
    req.headers = { host: '127.0.0.1', 'content-type': 'application/json' };
    req.setTimeout = (() => req) as IncomingMessage['setTimeout'];

    const res = {
      statusCode: 0,
      body: '',
      setTimeout: () => res,
      writeHead(status: number) {
        res.statusCode = status;
        return res;
      },
      end(chunk?: string) {
        res.body = chunk ?? '';
        return res;
      },
    };

    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const handle = (
      server as unknown as {
        handleRequest: (incoming: IncomingMessage, outgoing: ServerResponse) => Promise<void>;
      }
    ).handleRequest.bind(server);

    const pending = handle(req as IncomingMessage, res as unknown as ServerResponse);
    req.emit('data', Buffer.from('{}'));
    req.emit('end');
    await pending;

    expect(res.statusCode).toBe(500);
    const payload = JSON.parse(res.body) as { error: string; traceId?: string };
    expect(payload.error).toBe('Internal server error');
    expect(payload.traceId).toEqual(expect.any(String));
    expect(res.body).not.toContain('ABC:XYZ');
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).toContain(payload.traceId);

    errorSpy.mockRestore();
  });
});
