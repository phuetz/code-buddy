import fs from 'fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { createYuanbaoTools } from '../../src/tools/registry/yuanbao-tools.js';
import type { ITool } from '../../src/tools/registry/types.js';

interface CapturedRequest {
  method: string;
  path: string;
  authorization?: string;
  userAgent?: string;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let tempDir: string;
let requests: CapturedRequest[];

describe('Hermes Yuanbao real HTTP integration', () => {
  beforeEach(async () => {
    requests = [];
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-yuanbao-real-'));
    server = createServer(handleYuanbaoRequest);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('queries group info and members through a real Yuanbao gateway HTTP path', async () => {
    const tools = createYuanbaoTools({
      gatewayUrl: baseUrl,
      token: 'yuanbao-token',
      userAgent: 'Code-Buddy-Yuanbao-Test/1.0',
    });

    const info = await getTool('yb_query_group_info', tools).execute({
      group_code: '328306697',
    });
    const find = await getTool('yb_query_group_members', tools).execute({
      group_code: '328306697',
      action: 'find',
      name: 'Alice',
      mention: true,
    });
    const bots = await getTool('yb_query_group_members', tools).execute({
      group_code: '328306697',
      action: 'list_bots',
    });

    expect(info.success, info.error).toBe(true);
    expect(JSON.parse(info.output as string)).toMatchObject({
      kind: 'yuanbao_result',
      ok: true,
      tool: 'yb_query_group_info',
      data: {
        success: true,
        group_code: '328306697',
        group_name: 'Code Buddy Pai',
        member_count: 5,
        owner: {
          user_id: 'u-owner',
          nickname: 'Patrice',
        },
      },
      request: {
        method: 'POST',
        path: '/yuanbao/query_group_info',
      },
    });
    expect(JSON.parse(find.output as string)).toMatchObject({
      tool: 'yb_query_group_members',
      data: {
        success: true,
        msg: 'Found 1 member(s) matching "Alice".',
        members: [
          {
            user_id: 'u-1',
            nickname: 'Alice',
            role: 'user',
          },
        ],
        mention_hint: expect.stringContaining(' @Alice '),
      },
    });
    expect(JSON.parse(bots.output as string)).toMatchObject({
      tool: 'yb_query_group_members',
      data: {
        success: true,
        msg: 'Found 2 bot(s).',
        members: expect.arrayContaining([
          expect.objectContaining({ nickname: 'Yuanbao AI', role: 'yuanbao_ai' }),
          expect.objectContaining({ nickname: 'Deploy Bot', role: 'bot' }),
        ]),
      },
    });
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'POST',
        path: '/yuanbao/query_group_info',
        authorization: 'Bearer yuanbao-token',
        userAgent: 'Code-Buddy-Yuanbao-Test/1.0',
        body: { group_code: '328306697' },
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/yuanbao/get_group_member_list',
        authorization: 'Bearer yuanbao-token',
        body: { group_code: '328306697' },
      }),
    ]));
  });

  it('searches and sends Yuanbao stickers through real HTTP with delivery approval', async () => {
    const tools = createYuanbaoTools({
      gatewayUrl: baseUrl,
      token: 'yuanbao-token',
      homeChatId: 'group:328306697',
    });

    const search = await getTool('yb_search_sticker', tools).execute({
      query: 'cool',
      limit: 2,
    });
    const denied = await getTool('yb_send_sticker', tools).execute({
      sticker: '3',
    });
    const sent = await getTool('yb_send_sticker', tools).execute({
      sticker: '3',
      reply_to: 'msg-previous',
      approved_by: 'real-test-reviewer',
    });

    expect(search.success, search.error).toBe(true);
    expect(JSON.parse(search.output as string)).toMatchObject({
      tool: 'yb_search_sticker',
      data: {
        success: true,
        query: 'cool',
        count: 1,
        results: [
          {
            sticker_id: '3',
            name: 'cool',
            description: 'Cool Yuanbao sticker',
          },
        ],
      },
    });
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('requires approved_by');
    expect(sent.success, sent.error).toBe(true);
    expect(JSON.parse(sent.output as string)).toMatchObject({
      tool: 'yb_send_sticker',
      data: {
        success: true,
        chat_id: 'group:328306697',
        sticker: {
          sticker_id: '3',
          name: 'cool',
        },
        message_id: 'sticker-msg-1',
      },
      request: {
        method: 'POST',
        path: '/yuanbao/send_sticker',
      },
    });
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'POST',
        path: '/yuanbao/search_sticker',
        body: { query: 'cool', limit: 2 },
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/yuanbao/send_sticker',
        body: {
          chat_id: 'group:328306697',
          sticker: '3',
          reply_to: 'msg-previous',
        },
      }),
    ]));
  });

  it('resolves users and sends Yuanbao DMs through real HTTP with local media verification', async () => {
    const mediaPath = path.join(tempDir, 'note.txt');
    await fs.writeFile(mediaPath, 'real attachment bytes');
    const tools = createYuanbaoTools({
      gatewayUrl: baseUrl,
      token: 'yuanbao-token',
      homeChatId: 'group:328306697',
    });

    const ambiguous = await getTool('yb_send_dm', tools).execute({
      group_code: '328306697',
      name: 'Pat',
      message: 'Bonjour',
      approved_by: 'real-test-reviewer',
    });
    const missingApproval = await getTool('yb_send_dm', tools).execute({
      group_code: '328306697',
      name: 'Alice',
      message: 'Bonjour',
    });
    const sent = await getTool('yb_send_dm', tools).execute({
      name: 'Alice',
      message: 'Bonjour Alice',
      media_files: [{ path: mediaPath }],
      approved_by: 'real-test-reviewer',
    });

    expect(ambiguous.success, ambiguous.error).toBe(true);
    expect(JSON.parse(ambiguous.output as string)).toMatchObject({
      tool: 'yb_send_dm',
      data: {
        success: false,
        error: 'Multiple members match "Pat". Please specify which one.',
        candidates: expect.arrayContaining([
          { user_id: 'u-4', nickname: 'Patrice' },
          { user_id: 'u-5', nickname: 'Patricia' },
        ]),
      },
    });
    expect(missingApproval.success).toBe(false);
    expect(missingApproval.error).toContain('requires approved_by');
    expect(sent.success, sent.error).toBe(true);
    expect(JSON.parse(sent.output as string)).toMatchObject({
      tool: 'yb_send_dm',
      data: {
        success: true,
        user_id: 'u-1',
        nickname: 'Alice',
        message_id: 'dm-msg-1',
        note: 'DM sent to "Alice" successfully.',
      },
    });
    expect(requests).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: '/yuanbao/send_dm',
      body: {
        group_code: '328306697',
        user_id: 'u-1',
        name: 'Alice',
        message: 'Bonjour Alice',
        media_files: [
          {
            path: mediaPath,
            is_voice: false,
            media_kind: 'document',
          },
        ],
      },
    }));
  });

  it('marks official Hermes Yuanbao tools as exact local tool parity', () => {
    const manifest = buildLocalHermesToolParityManifest('2026-05-31T00:15:00.000Z');
    expect(manifest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'yb_query_group_info',
        status: 'exact',
        detectedCodeBuddyTools: ['yb_query_group_info'],
      }),
      expect.objectContaining({
        name: 'yb_query_group_members',
        status: 'exact',
        detectedCodeBuddyTools: ['yb_query_group_members'],
      }),
      expect.objectContaining({
        name: 'yb_send_dm',
        status: 'exact',
        detectedCodeBuddyTools: ['yb_send_dm'],
      }),
      expect.objectContaining({
        name: 'yb_search_sticker',
        status: 'exact',
        detectedCodeBuddyTools: ['yb_search_sticker'],
      }),
      expect.objectContaining({
        name: 'yb_send_sticker',
        status: 'exact',
        detectedCodeBuddyTools: ['yb_send_sticker'],
      }),
    ]));
  });
});

async function handleYuanbaoRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const parsedBody = body ? JSON.parse(body) as Record<string, unknown> : {};
  const url = req.url ?? '/';
  requests.push({
    method: req.method ?? 'GET',
    path: url,
    authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    body: parsedBody,
  });

  if (req.method === 'POST' && url === '/yuanbao/query_group_info') {
    writeJson(res, {
      success: true,
      data: {
        group_code: parsedBody.group_code,
        group_name: 'Code Buddy Pai',
        member_count: 5,
        owner_id: 'u-owner',
        owner_nickname: 'Patrice',
      },
    });
    return;
  }

  if (req.method === 'POST' && url === '/yuanbao/get_group_member_list') {
    writeJson(res, {
      success: true,
      data: {
        members: [
          { user_id: 'u-1', nickname: 'Alice', user_type: 1 },
          { user_id: 'u-2', nickname: 'Yuanbao AI', user_type: 2 },
          { user_id: 'u-3', nickname: 'Deploy Bot', role: 3 },
          { user_id: 'u-4', nickname: 'Patrice', user_type: 1 },
          { user_id: 'u-5', nickname: 'Patricia', user_type: 1 },
        ],
      },
    });
    return;
  }

  if (req.method === 'POST' && url === '/yuanbao/search_sticker') {
    writeJson(res, {
      success: true,
      data: {
        results: [
          { sticker_id: '3', name: 'cool', description: 'Cool Yuanbao sticker', package_id: 'basic' },
        ],
      },
    });
    return;
  }

  if (req.method === 'POST' && url === '/yuanbao/send_sticker') {
    writeJson(res, {
      success: true,
      data: {
        chat_id: parsedBody.chat_id,
        sticker: { sticker_id: parsedBody.sticker, name: 'cool' },
        message_id: 'sticker-msg-1',
      },
    });
    return;
  }

  if (req.method === 'POST' && url === '/yuanbao/send_dm') {
    writeJson(res, {
      success: true,
      data: {
        user_id: parsedBody.user_id,
        nickname: parsedBody.name,
        message_id: 'dm-msg-1',
      },
    });
    return;
  }

  writeJson(res, { success: false, error: `Unhandled route: ${req.method} ${url}` }, 404);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function getTool(name: string, tools: ITool[]): ITool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}
