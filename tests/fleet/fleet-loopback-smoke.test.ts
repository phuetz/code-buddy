/**
 * Fleet loopback smoke test.
 *
 * Starts a real Gateway WebSocket on localhost, authenticates a real
 * FleetListener with a scoped API key, registers it in the slash-command
 * registry, then invokes `/fleet tool` through the same handler the CLI uses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { startServer, stopServer } from '../../src/server/index.js';
import { createApiKey } from '../../src/server/auth/api-keys.js';
import { FleetListener } from '../../src/fleet/fleet-listener.js';
import { getFleetRegistry } from '../../src/fleet/fleet-registry.js';
import { resetCapabilityCache } from '../../src/fleet/capability-registry.js';
import { wirePeerChatBridge, unwirePeerChatBridge } from '../../src/fleet/peer-chat-bridge.js';
import {
  wirePeerSessionBridge,
  unwirePeerSessionBridge,
} from '../../src/fleet/peer-session-bridge.js';
import {
  PeerSessionStore,
  _setPeerSessionStoreForTests,
  resetPeerSessionStore,
} from '../../src/fleet/peer-session-store.js';
import {
  handleFleet,
  _resetFleetHandlerForTests,
} from '../../src/commands/handlers/fleet-handler.js';
import {
  executePeerDelegate,
  _resetCallCounterForTests,
} from '../../src/tools/peer-delegate-tool.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { CodeBuddyTool } from '../../src/codebuddy/client.js';

type ServerHandle = Awaited<ReturnType<typeof startServer>>;

function mockTool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: `loopback ${name}`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  };
}

function seedFleetSafeRegistry(): void {
  const registry = ToolRegistry.getInstance();
  registry.clear();
  for (const name of ['view_file', 'list_directory', 'search']) {
    registry.registerTool(mockTool(name), {
      name,
      category: 'file_read',
      keywords: [],
      priority: 5,
      description: name,
      fleetSafe: true,
    });
  }
}

function makeMockPeerChatClient(answer = 'loopback delegated review'): {
  client: { chat: ReturnType<typeof vi.fn> };
  chat: ReturnType<typeof vi.fn>;
} {
  const chat = vi.fn(async () => ({
    choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
  }));
  return { client: { chat }, chat };
}

describe('Fleet loopback smoke', () => {
  const loopbackTimeoutMs = 10_000;
  let tmpRoot = '';
  let serverHandle: ServerHandle | null = null;
  let listener: FleetListener | null = null;
  let previousWorkspaceRoot: string | undefined;
  let previousAuthPath: string | undefined;
  let previousChatGptModel: string | undefined;
  let previousPeerProvider: string | undefined;

  beforeEach(async () => {
    previousWorkspaceRoot = process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    previousAuthPath = process.env.CODEBUDDY_CODEX_AUTH_PATH;
    previousChatGptModel = process.env.CHATGPT_MODEL;
    previousPeerProvider = process.env.CODEBUDDY_PEER_PROVIDER;
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-loopback-'));
    tmpRoot = await fs.realpath(tmpRoot);
    await fs.writeFile(path.join(tmpRoot, 'hello.txt'), 'hello from loopback\n');
    _setPeerSessionStoreForTests(
      new PeerSessionStore({ storeDir: path.join(tmpRoot, 'peer-sessions') }),
    );
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = tmpRoot;
    process.env.CODEBUDDY_CODEX_AUTH_PATH = path.join(tmpRoot, 'codex-auth.json');
    process.env.CHATGPT_MODEL = 'gpt-5.1-codex';
    process.env.CODEBUDDY_PEER_PROVIDER = 'chatgpt-oauth';
    await fs.writeFile(
      process.env.CODEBUDDY_CODEX_AUTH_PATH,
      JSON.stringify({ tokens: { access_token: 'test-oauth-token' } }),
    );
    resetCapabilityCache();
    seedFleetSafeRegistry();
    _resetFleetHandlerForTests();
    _resetCallCounterForTests();
  });

  afterEach(async () => {
    _resetFleetHandlerForTests();
    unwirePeerSessionBridge();
    resetPeerSessionStore();
    if (listener) {
      await listener.disconnect().catch(() => undefined);
      listener = null;
    }
    if (serverHandle) {
      await stopServer(serverHandle.server).catch(() => undefined);
      serverHandle = null;
    }
    ToolRegistry.getInstance().clear();
    if (previousWorkspaceRoot === undefined) {
      delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    } else {
      process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = previousWorkspaceRoot;
    }
    if (previousAuthPath === undefined) {
      delete process.env.CODEBUDDY_CODEX_AUTH_PATH;
    } else {
      process.env.CODEBUDDY_CODEX_AUTH_PATH = previousAuthPath;
    }
    if (previousChatGptModel === undefined) {
      delete process.env.CHATGPT_MODEL;
    } else {
      process.env.CHATGPT_MODEL = previousChatGptModel;
    }
    if (previousPeerProvider === undefined) {
      delete process.env.CODEBUDDY_PEER_PROVIDER;
    } else {
      process.env.CODEBUDDY_PEER_PROVIDER = previousPeerProvider;
    }
    resetCapabilityCache();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function connectLoopbackPeer(peerChatClient?: { chat: ReturnType<typeof vi.fn> }): Promise<void> {
    const { key } = createApiKey({
      name: 'loopback-smoke',
      userId: 'test-loopback',
      scopes: ['fleet:listen', 'peer:invoke'],
    });
    serverHandle = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: true,
      rateLimit: false,
      logging: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = serverHandle.server.address() as AddressInfo;
    if (peerChatClient) {
      await new Promise((resolve) => setImmediate(resolve));
      unwirePeerChatBridge();
      wirePeerChatBridge(() => peerChatClient as never, {
        provider: 'chatgpt-oauth',
        model: 'gpt-5.1-codex',
        isLocal: false,
      });
      unwirePeerSessionBridge();
      await wirePeerSessionBridge(() => peerChatClient as never);
    }
    listener = new FleetListener({
      url: `ws://127.0.0.1:${address.port}/ws`,
      apiKey: key,
      connectTimeoutMs: loopbackTimeoutMs,
      authTimeoutMs: loopbackTimeoutMs,
    });
    await listener.connect();
    getFleetRegistry().register({
      id: 'loopback',
      url: `ws://127.0.0.1:${address.port}/ws`,
      startedAt: new Date(),
      eventCount: 0,
      autoReconnect: false,
      maxAttempts: 0,
      listener,
    });
  }

  it('routes /fleet tool through a real loopback peer.tool.invoke', async () => {
    await connectLoopbackPeer();

    const result = await handleFleet([
      'tool',
      'loopback',
      'view_file',
      '{"file_path":"hello.txt"}',
      '--timeout',
      String(loopbackTimeoutMs),
    ]);

    expect(result.entry?.content).toContain('Peer "loopback" → view_file OK');
    expect(result.entry?.content).toContain('hello from loopback');
  });

  it('routes /fleet tool --stream chunks through the real loopback websocket', async () => {
    await connectLoopbackPeer();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const result = await handleFleet([
        'tool',
        'loopback',
        'view_file',
        '{"file_path":"hello.txt"}',
        '--stream',
        '--timeout',
        String(loopbackTimeoutMs),
      ]);

      const written = writeSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(written).toContain('hello from loopback');
      expect(result.entry?.content).toContain('Peer "loopback" → view_file (stream) OK');
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('routes /fleet route through real loopback peer.describe capabilities', async () => {
    await connectLoopbackPeer();

    const result = await handleFleet([
      'route',
      'think',
      'deeply',
      'about',
      'fleet',
      '--privacy',
      'public',
      '--timeout',
      String(loopbackTimeoutMs),
    ]);

    const out = result.entry?.content ?? '';
    expect(out).toContain('Fleet route recommendation');
    expect(out).toContain('Primary: loopback / gpt-5.1-codex');
    expect(out).toContain('peer_delegate');
  });

  it('routes /fleet route --profile through real loopback peer.describe capabilities', async () => {
    await connectLoopbackPeer();

    const result = await handleFleet([
      'route',
      'review',
      'this',
      'patch',
      '--profile',
      'review',
      '--privacy',
      'public',
      '--timeout',
      String(loopbackTimeoutMs),
    ]);

    const out = result.entry?.content ?? '';
    expect(out).toContain('Fleet route recommendation');
    expect(out).toContain('Primary: loopback / gpt-5.1-codex');
    expect(out).toContain('Profile: review');
    expect(out).toContain('Tool policy: minimal / confirm');
    expect(out).toContain('peer_delegate');
    expect(out).toContain('"dispatchProfile":"review"');
  });

  it('routes peer_delegate dispatchProfile metadata through real loopback peer.chat', async () => {
    const { client, chat } = makeMockPeerChatClient();
    await connectLoopbackPeer(client);

    const result = await executePeerDelegate({
      peer: 'loopback',
      prompt: 'review this patch',
      dispatchProfile: 'review',
      timeoutMs: loopbackTimeoutMs,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('loopback delegated review');
    expect(result.output).toContain('[profile: review | policy: minimal / confirm]');

    const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('Prioritize defects');
    expect(messages[0].content).toContain('Tool policy hint:');

    expect(result.data).toMatchObject({
      peer: 'loopback',
      text: 'loopback delegated review',
      dispatchProfile: 'review',
      toolPolicy: {
        policyProfile: 'minimal',
        defaultAction: 'confirm',
      },
      toolDecisions: expect.arrayContaining([
        expect.objectContaining({ tool: 'view_file', action: 'allow' }),
        expect.objectContaining({ tool: 'create_file', action: 'deny' }),
        expect.objectContaining({ tool: 'bash', action: 'deny' }),
      ]),
    });
  });

  it('routes /fleet route --delegate --profile through real loopback peer.chat', async () => {
    const { client, chat } = makeMockPeerChatClient('route delegated review');
    await connectLoopbackPeer(client);

    const result = await handleFleet([
      'route',
      'review',
      'this',
      'patch',
      '--profile',
      'review',
      '--delegate',
      '--privacy',
      'public',
      '--timeout',
      String(loopbackTimeoutMs),
      '--delegate-timeout',
      String(loopbackTimeoutMs),
    ]);

    const out = result.entry?.content ?? '';
    expect(out).toContain('Fleet route recommendation');
    expect(out).toContain('Profile: review');
    expect(out).toContain('Delegated response');
    expect(out).toContain('route delegated review');
    expect(out).toContain('[profile: review | policy: minimal / confirm]');

    const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('Prioritize defects');
  });

  it('routes /fleet chat start --profile through real loopback peer.chat-session', async () => {
    const { client, chat } = makeMockPeerChatClient('session review answer');
    await connectLoopbackPeer(client);

    const start = await handleFleet([
      'chat',
      'start',
      'loopback',
      '--profile',
      'review',
      '--name',
      'review-session',
    ]);

    expect(start.entry?.content).toContain('Chat session "review-session" opened');
    expect(start.entry?.content).toContain('Profile: review');

    const say = await handleFleet([
      'chat',
      'say',
      'please',
      'review',
      'this',
      'patch',
      '--session',
      'review-session',
    ]);

    expect(say.entry?.content).toContain('session review answer');
    const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('Prioritize defects');
    expect(messages[0].content).toContain('Tool policy hint:');

    const status = await handleFleet(['status', '--with-sessions']);
    expect(status.entry?.content).toContain('profile review');
  });

  it('renders /fleet describe from a real loopback peer.describe response', async () => {
    await connectLoopbackPeer();

    const result = await handleFleet(['describe', 'loopback', '--timeout', String(loopbackTimeoutMs)]);

    const out = result.entry?.content ?? '';
    expect(out).toContain('Fleet peer "loopback"');
    expect(out).toContain('Peer chat:     chatgpt-oauth / gpt-5.1-codex');
    expect(out).toContain('Capabilities:');
    expect(out).toContain('Top models:   gpt-5.1-codex');
  });
});
