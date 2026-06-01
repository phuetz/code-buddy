import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { WeComAdapter, WeComChannel } from '../../src/channels/wecom/index.js';

interface CapturedRequest {
  body: Record<string, unknown>;
  headers: http.IncomingHttpHeaders;
  method: string;
  url: string;
}

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => closeServer(server)));
  servers.length = 0;
});

describe('WeComChannel real HTTP webhook publishing', () => {
  it('posts text messages to a local WeCom-compatible webhook without exposing the key in status', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalWeComServer(requests);
    const webhookUrl = `${localServerUrl(server)}/cgi-bin/webhook/send?key=wecom-key-123`;
    const channel = new WeComChannel({
      type: 'wecom',
      enabled: true,
      webhookUrl,
      mentionedList: ['@all'],
      mentionedMobileList: ['15555550123'],
    });

    await channel.connect();
    expect(JSON.stringify(channel.getStatus().info)).not.toContain('wecom-key-123');

    const result = await channel.send({
      channelId: 'robot',
      content: 'Hermes WeCom smoke from Code Buddy',
      contentType: 'text',
    });

    expect(result.success, result.error).toBe(true);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url, localServerUrl(server));
    expect(requests[0]).toMatchObject({
      method: 'POST',
    });
    expect(url.pathname).toBe('/cgi-bin/webhook/send');
    expect(url.searchParams.get('key')).toBe('wecom-key-123');
    expect(requests[0]?.headers['content-type']).toContain('application/json');
    expect(requests[0]?.body).toEqual({
      msgtype: 'text',
      text: {
        content: 'Hermes WeCom smoke from Code Buddy',
        mentioned_list: ['@all'],
        mentioned_mobile_list: ['15555550123'],
      },
    });

    await channel.disconnect();
    expect(channel.getStatus().connected).toBe(false);
  });

  it('supports markdown messages through the adapter key shortcut', async () => {
    const requests: CapturedRequest[] = [];
    const server = await startLocalWeComServer(requests);
    const adapter = new WeComAdapter({
      webhookUrl: `${localServerUrl(server)}/cgi-bin/webhook/send?key=abc`,
      msgType: 'markdown',
    });

    await adapter.start();
    const result = await adapter.send('### Build complete\nAll checks passed');

    expect(result).toEqual({
      errcode: 0,
      errmsg: 'ok',
      success: true,
      status: 200,
    });
    expect(requests[0]?.body).toEqual({
      markdown: {
        content: '### Build complete\nAll checks passed',
      },
      msgtype: 'markdown',
    });

    await adapter.stop();
  });
});

async function startLocalWeComServer(requests: CapturedRequest[]): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        body: JSON.parse(body) as Record<string, unknown>,
        headers: request.headers,
        method: request.method ?? '',
        url: request.url ?? '',
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server;
}

function localServerUrl(server: http.Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
