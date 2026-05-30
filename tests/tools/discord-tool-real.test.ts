import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { createDiscordTools } from '../../src/tools/registry/discord-tools.js';

interface CapturedRequest {
  method: string;
  path: string;
  authorization?: string;
  body?: unknown;
}

let server: Server;
let baseUrl: string;
let requests: CapturedRequest[];

describe('Hermes discord real HTTP integration', () => {
  beforeEach(async () => {
    requests = [];
    server = createServer(handleDiscordRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('fetches Discord messages through a real HTTP request', async () => {
    const [tool] = createDiscordTools({ token: 'test-discord-token', apiBaseUrl: baseUrl });

    const result = await tool!.execute({
      action: 'fetch_messages',
      channel_id: 'channel-123',
      limit: 2,
      before: '999',
    });

    expect(result.success, result.error).toBe(true);
    const payload = JSON.parse(result.output as string) as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: 'discord_result',
      ok: true,
      action: 'fetch_messages',
      request: {
        method: 'GET',
        path: '/channels/channel-123/messages',
      },
    });
    expect(payload.data).toMatchObject({
      count: 1,
      messages: [
        {
          id: 'msg-1',
          content: 'real Discord payload',
          author: {
            id: 'user-1',
            username: 'patrice',
          },
        },
      ],
    });
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'GET',
      path: '/channels/channel-123/messages?limit=2&before=999',
      authorization: 'Bot test-discord-token',
    }));
  });

  it('searches members and creates threads through the same exact tool', async () => {
    const [tool] = createDiscordTools({ token: 'test-discord-token', apiBaseUrl: baseUrl });

    const search = await tool!.execute({
      action: 'search_members',
      guild_id: 'guild-1',
      query: 'pat',
      limit: 5,
    });
    expect(search.success, search.error).toBe(true);
    expect(JSON.parse(search.output as string)).toMatchObject({
      action: 'search_members',
      data: {
        count: 1,
        members: [
          {
            user_id: 'user-1',
            username: 'patrice',
            roles: ['role-1'],
          },
        ],
      },
    });

    const create = await tool!.execute({
      action: 'create_thread',
      channel_id: 'channel-123',
      name: 'Hermes parity thread',
      auto_archive_duration: 60,
    });
    expect(create.success, create.error).toBe(true);
    expect(JSON.parse(create.output as string)).toMatchObject({
      action: 'create_thread',
      data: {
        success: true,
        thread_id: 'thread-1',
        name: 'Hermes parity thread',
      },
    });
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'GET',
      path: '/guilds/guild-1/members/search?query=pat&limit=5',
    }));
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: '/channels/channel-123/threads',
      body: {
        name: 'Hermes parity thread',
        auto_archive_duration: 60,
        type: 11,
      },
    }));
  });

  it('marks official Hermes discord as exact local tool parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-30T19:45:00.000Z');
    expect(manifest.tools).toContainEqual(expect.objectContaining({
      name: 'discord',
      status: 'exact',
      detectedCodeBuddyTools: ['discord'],
    }));
  });
});

async function handleDiscordRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const parsedBody = body ? JSON.parse(body) as unknown : undefined;
  const url = req.url ?? '/';
  requests.push({
    method: req.method ?? 'GET',
    path: url,
    authorization: req.headers.authorization,
    ...(parsedBody !== undefined ? { body: parsedBody } : {}),
  });

  if (req.method === 'GET' && url === '/channels/channel-123/messages?limit=2&before=999') {
    writeJson(res, [
      {
        id: 'msg-1',
        content: 'real Discord payload',
        author: {
          id: 'user-1',
          username: 'patrice',
          global_name: 'Patrice',
          bot: false,
        },
        timestamp: '2026-05-30T19:45:00.000Z',
        attachments: [],
        reactions: [],
        pinned: false,
      },
    ]);
    return;
  }

  if (req.method === 'GET' && url === '/guilds/guild-1/members/search?query=pat&limit=5') {
    writeJson(res, [
      {
        user: {
          id: 'user-1',
          username: 'patrice',
          global_name: 'Patrice',
          bot: false,
        },
        nick: 'Patrice',
        roles: ['role-1'],
      },
    ]);
    return;
  }

  if (req.method === 'POST' && url === '/channels/channel-123/threads') {
    expect(parsedBody).toEqual({
      name: 'Hermes parity thread',
      auto_archive_duration: 60,
      type: 11,
    });
    writeJson(res, {
      id: 'thread-1',
      name: 'Hermes parity thread',
    });
    return;
  }

  res.statusCode = 404;
  writeJson(res, { message: `Unhandled ${req.method} ${url}` });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, data: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
