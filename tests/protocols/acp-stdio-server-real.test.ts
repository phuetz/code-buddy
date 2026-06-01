import { PassThrough } from 'stream';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AcpStdioServer,
  ACP_PROTOCOL_VERSION,
  type AcpStdioServerOptions,
  type AcpPromptRunner,
} from '../../src/protocols/acp/acp-stdio-server.js';

/** Drives a real AcpStdioServer over in-memory ndjson streams. */
class AcpHarness {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  readonly messages: Array<Record<string, any>> = [];
  readonly server: AcpStdioServer;

  constructor(
    promptRunner: AcpPromptRunner,
    options: Omit<Partial<AcpStdioServerOptions>, 'input' | 'output' | 'promptRunner'> = {},
  ) {
    this.output.setEncoding('utf8');
    this.output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) this.messages.push(JSON.parse(trimmed));
      }
    });
    this.server = new AcpStdioServer({ input: this.input, output: this.output, promptRunner, ...options });
    this.server.start();
  }

  send(message: Record<string, unknown>): void {
    this.input.write(`${JSON.stringify(message)}\n`);
  }

  /** Let queued async dispatch flush. */
  async flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  responseFor(id: number): Record<string, any> | undefined {
    return this.messages.find((m) => m.id === id);
  }

  requestFor(method: string): Record<string, any> | undefined {
    return this.messages.find((m) => m.method === method && m.id !== undefined);
  }

  notifications(method: string): Array<Record<string, any>> {
    return this.messages.filter((m) => m.method === method && m.id === undefined);
  }
}

describe('AcpStdioServer (real ndjson transport)', () => {
  let harness: AcpHarness;

  afterEach(() => {
    harness?.server.stop();
  });

  it('negotiates capabilities on initialize', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));
    harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    await harness.flush();

    const res = harness.responseFor(1);
    expect(res?.jsonrpc).toBe('2.0');
    expect(res?.result.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(res?.result.agentInfo.name).toBe('Code Buddy');
    expect(res?.result.authMethods).toEqual([]);
    expect(res?.result.agentCapabilities.promptCapabilities).toBeTruthy();
    expect(res?.result.agentCapabilities.sessionCapabilities).toEqual({ list: {} });
  });

  it('rejects unsupported initialize protocol versions without applying capabilities', async () => {
    const runner: AcpPromptRunner = async ({ canRequestClient, sendUpdate }) => {
      sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: String(canRequestClient('fs/read_text_file')) },
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);
    harness.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: ACP_PROTOCOL_VERSION + 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } },
      },
    });
    await harness.flush();

    expect(harness.responseFor(1)?.error).toMatchObject({
      code: -32602,
      message: `Unsupported ACP protocolVersion: ${ACP_PROTOCOL_VERSION + 1} (expected ${ACP_PROTOCOL_VERSION})`,
    });

    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(2)?.result.sessionId as string;
    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'capabilities after bad init' }] },
    });
    await harness.flush();

    expect(harness.notifications('session/update').at(-1)?.params.update.content.text).toBe('false');
    expect(harness.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('passes initialized client capabilities into prompt runners', async () => {
    const runner: AcpPromptRunner = async ({ canRequestClient, clientCapabilities, sendUpdate }) => {
      sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: JSON.stringify({
            read: clientCapabilities.fs?.readTextFile === true,
            write: clientCapabilities.fs?.writeTextFile === true,
            canRead: canRequestClient('fs/read_text_file'),
            canWrite: canRequestClient('fs/write_text_file'),
            canRequestPermission: canRequestClient('session/request_permission'),
          }),
        },
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: false },
          terminal: false,
        },
      },
    });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(2)?.result.sessionId as string;
    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'capabilities' }] },
    });
    await harness.flush();

    expect(harness.notifications('session/update').at(-1)?.params.update.content.text).toBe(JSON.stringify({
      read: true,
      write: false,
      canRead: true,
      canWrite: false,
      canRequestPermission: true,
    }));
    expect(harness.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('creates a session and runs a prompt, streaming an agent_message_chunk then end_turn', async () => {
    const runner: AcpPromptRunner = async ({ prompt, sendUpdate }) => {
      const text = prompt[0]?.text ?? '';
      sendUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo: ${text}` } });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp/x', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;
    expect(typeof sessionId).toBe('string');

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'hello' }] },
    });
    await harness.flush();

    const updates = harness.notifications('session/update');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.params.sessionId).toBe(sessionId);
    expect(updates[0]?.params.update).toEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'echo: hello' },
    });

    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('loads an in-process session and replays prior session updates', async () => {
    const seenCwds: string[] = [];
    const runner: AcpPromptRunner = async ({ cwd, prompt, sendUpdate }) => {
      seenCwds.push(cwd);
      sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `history: ${prompt[0]?.text ?? ''}` },
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/old', mcpServers: [] } });
    await harness.flush();
    expect(harness.responseFor(1)?.result.agentCapabilities.loadSession).toBe(true);
    const sessionId = harness.responseFor(2)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'first' }] },
    });
    await harness.flush();
    expect(harness.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });

    harness.send({ jsonrpc: '2.0', id: 4, method: 'session/list', params: {} });
    await harness.flush();
    const updatedBeforeLoad = harness.responseFor(4)?.result.sessions[0].updatedAt;
    expect(updatedBeforeLoad).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const beforeLoadUpdateCount = harness.notifications('session/update').length;
    harness.send({
      jsonrpc: '2.0',
      id: 5,
      method: 'session/load',
      params: { sessionId, cwd: '/tmp/new', mcpServers: [] },
    });
    await harness.flush();

    const updates = harness.notifications('session/update');
    expect(updates).toHaveLength(beforeLoadUpdateCount + 1);
    expect(updates.at(-1)?.params).toEqual({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'history: first' },
      },
    });
    expect(harness.responseFor(5)?.result).toEqual({ configOptions: null, modes: null });

    harness.send({ jsonrpc: '2.0', id: 6, method: 'session/list', params: {} });
    await harness.flush();
    expect(harness.responseFor(6)?.result.sessions[0].updatedAt).not.toBe(updatedBeforeLoad);

    harness.send({
      jsonrpc: '2.0',
      id: 7,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'after-load' }] },
    });
    await harness.flush();
    expect(seenCwds).toEqual(['/tmp/old', '/tmp/new']);
    expect(harness.responseFor(7)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('rejects session/load while a prompt is active', async () => {
    const seenCwds: string[] = [];
    const runner: AcpPromptRunner = ({ cwd, signal }) => {
      seenCwds.push(cwd);
      return new Promise((resolve) => {
        if (signal.aborted) return resolve({ stopReason: 'cancelled' });
        signal.addEventListener('abort', () => resolve({ stopReason: 'end_turn' }));
      });
    };
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp/old', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'long prompt' }] },
    });
    await harness.flush();
    expect(harness.responseFor(2)).toBeUndefined();

    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/load',
      params: { sessionId, cwd: '/tmp/new', mcpServers: [] },
    });
    await harness.flush();

    expect(harness.responseFor(3)?.error).toMatchObject({
      code: -32000,
      message: 'Session has an active prompt; cancel or wait before loading',
    });

    harness.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    await harness.flush();
    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'cancelled' });

    harness.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'after failed load' }] },
    });
    harness.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    await harness.flush();

    expect(seenCwds).toEqual(['/tmp/old', '/tmp/old']);
    expect(harness.responseFor(4)?.result).toEqual({ stopReason: 'cancelled' });
  });

  it('lists in-process sessions with cwd filtering and prompt-derived metadata', async () => {
    const runner: AcpPromptRunner = async ({ prompt, sendUpdate }) => {
      sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `listed: ${prompt[0]?.text ?? ''}` },
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/list', params: {} });
    await harness.flush();
    expect(harness.responseFor(2)?.result).toEqual({ sessions: [] });

    harness.send({ jsonrpc: '2.0', id: 3, method: 'session/new', params: { cwd: '/tmp/project-a', mcpServers: [] } });
    harness.send({ jsonrpc: '2.0', id: 4, method: 'session/new', params: { cwd: '/tmp/project-b', mcpServers: [] } });
    await harness.flush();
    const sessionA = harness.responseFor(3)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 5,
      method: 'session/prompt',
      params: { sessionId: sessionA, prompt: [{ type: 'text', text: 'Implement session list API' }] },
    });
    await harness.flush();

    harness.send({ jsonrpc: '2.0', id: 6, method: 'session/list', params: { cwd: '/tmp/project-a' } });
    await harness.flush();

    const listResult = harness.responseFor(6)?.result;
    expect(listResult.sessions).toEqual([
      expect.objectContaining({
        sessionId: sessionA,
        cwd: '/tmp/project-a',
        title: 'Implement session list API',
        _meta: {
          active: false,
          messageCount: 1,
        },
      }),
    ]);
    expect(listResult.sessions[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(listResult.nextCursor).toBeUndefined();
  });

  it('lists in-process sessions newest first', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp/project-old', mcpServers: [] } });
    await harness.flush();
    const olderSessionId = harness.responseFor(1)?.result.sessionId as string;

    await new Promise((resolve) => setTimeout(resolve, 5));
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project-new', mcpServers: [] } });
    await harness.flush();
    const newerSessionId = harness.responseFor(2)?.result.sessionId as string;

    harness.send({ jsonrpc: '2.0', id: 3, method: 'session/list', params: {} });
    await harness.flush();

    expect(harness.responseFor(3)?.result.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([
      newerSessionId,
      olderSessionId,
    ]);
  });

  it('rejects unsupported session/list cursors instead of pretending pagination exists', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));

    harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/list', params: { cursor: 'opaque-next-page' } });
    await harness.flush();

    expect(harness.responseFor(2)?.error).toMatchObject({
      code: -32602,
      message: 'Invalid or unsupported session/list cursor',
    });
  });

  it('lets prompt runners call client methods and wait for JSON-RPC responses', async () => {
    const runner: AcpPromptRunner = async ({ requestClient, sessionId, sendUpdate }) => {
      const result = await requestClient('fs/read_text_file', {
        sessionId,
        path: '/tmp/project/README.md',
        line: 1,
        limit: 5,
      });
      const content = (result as { content?: string } | null)?.content ?? '';
      sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `client file: ${content}` },
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } },
      },
    });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(2)?.result.sessionId as string;
    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'read file' }] },
    });
    await harness.flush();

    const clientRequest = harness.requestFor('fs/read_text_file');
    expect(clientRequest).toMatchObject({
      jsonrpc: '2.0',
      method: 'fs/read_text_file',
      params: {
        sessionId,
        path: '/tmp/project/README.md',
        line: 1,
        limit: 5,
      },
    });
    expect(typeof clientRequest?.id).toBe('string');
    expect(harness.responseFor(3)).toBeUndefined();

    harness.send({
      jsonrpc: '2.0',
      id: clientRequest?.id,
      result: { content: 'hello from unsaved editor buffer' },
    });
    await harness.flush();

    expect(harness.notifications('session/update').at(-1)?.params.update).toEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'client file: hello from unsaved editor buffer' },
    });
    expect(harness.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('times out unanswered agent-to-client requests instead of hanging forever', async () => {
    const runner: AcpPromptRunner = async ({ requestClient, sessionId }) => {
      await requestClient('fs/read_text_file', {
        sessionId,
        path: '/tmp/project/README.md',
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner, { clientRequestTimeoutMs: 20 });

    harness.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } },
      },
    });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(2)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'read but never receive response' }] },
    });
    await harness.flush();
    expect(harness.requestFor('fs/read_text_file')).toBeTruthy();
    expect(harness.responseFor(3)).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 40));
    await harness.flush();

    expect(harness.responseFor(3)?.error).toMatchObject({
      code: -32000,
      message: 'ACP client request timed out after 20ms: fs/read_text_file',
    });
  });

  it('rejects optional client methods that were not advertised at initialize', async () => {
    const runner: AcpPromptRunner = async ({ requestClient }) => {
      await requestClient('fs/read_text_file', {
        path: '/tmp/project/README.md',
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
    });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(2)?.result.sessionId as string;
    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'read file' }] },
    });
    await harness.flush();

    expect(harness.requestFor('fs/read_text_file')).toBeUndefined();
    expect(harness.responseFor(3)?.error).toMatchObject({
      code: -32601,
      message: 'ACP client method is not advertised by initialize.clientCapabilities: fs/read_text_file',
    });
  });

  it('keeps prompt-derived metadata when a prompt fails', async () => {
    const runner: AcpPromptRunner = async ({ requestClient }) => {
      await requestClient('fs/read_text_file', {
        path: '/tmp/project/README.md',
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
    });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(2)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'Read the missing file' }] },
    });
    await harness.flush();
    expect(harness.responseFor(3)?.error?.code).toBe(-32601);

    harness.send({ jsonrpc: '2.0', id: 4, method: 'session/list', params: {} });
    await harness.flush();

    expect(harness.responseFor(4)?.result.sessions[0]).toMatchObject({
      sessionId,
      title: 'Read the missing file',
      _meta: {
        active: false,
        messageCount: 0,
      },
    });
  });

  it('keeps client capability checks stable for the active prompt', async () => {
    let continueRunner: (() => void) | undefined;
    const runner: AcpPromptRunner = async ({ requestClient, sendUpdate }) => {
      sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'runner ready' },
      });
      await new Promise<void>((resolve) => {
        continueRunner = resolve;
      });
      await requestClient('fs/read_text_file', {
        path: '/tmp/project/README.md',
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
    });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(2)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'read after renegotiation' }] },
    });
    await harness.flush();
    expect(harness.notifications('session/update').at(-1)?.params.update.content.text).toBe('runner ready');

    harness.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } },
      },
    });
    await harness.flush();
    continueRunner?.();
    await harness.flush();

    expect(harness.requestFor('fs/read_text_file')).toBeUndefined();
    expect(harness.responseFor(3)?.error).toMatchObject({
      code: -32601,
      message: 'ACP client method is not advertised by initialize.clientCapabilities: fs/read_text_file',
    });
  });

  it('rejects unknown agent-to-client methods instead of forwarding them', async () => {
    const runner: AcpPromptRunner = async ({ requestClient }) => {
      await requestClient('workspace/read_secret', {
        key: 'token',
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
    await harness.flush();
    const sessionId = harness.responseFor(2)?.result.sessionId as string;
    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'try unknown client method' }] },
    });
    await harness.flush();

    expect(harness.requestFor('workspace/read_secret')).toBeUndefined();
    expect(harness.responseFor(3)?.error).toMatchObject({
      code: -32601,
      message: 'ACP client method is not advertised by initialize.clientCapabilities: workspace/read_secret',
    });
  });

  it('aborts pending client method calls when a session is cancelled', async () => {
    const runner: AcpPromptRunner = async ({ requestClient, sessionId }) => {
      await requestClient('session/request_permission', {
        sessionId,
        toolCall: { kind: 'read', title: 'Read file' },
      });
      return { stopReason: 'end_turn' };
    };
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;
    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'needs approval' }] },
    });
    await harness.flush();
    expect(harness.requestFor('session/request_permission')).toBeTruthy();
    expect(harness.responseFor(2)).toBeUndefined();

    harness.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    await harness.flush();

    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'cancelled' });
  });

  it('returns a JSON-RPC error for an unknown sessionId', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));
    harness.send({ jsonrpc: '2.0', id: 7, method: 'session/prompt', params: { sessionId: 'nope', prompt: [] } });
    await harness.flush();

    const res = harness.responseFor(7);
    expect(res?.error?.code).toBe(-32602);
    expect(res?.result).toBeUndefined();
  });

  it('rejects malformed session/prompt payloads before running the prompt', async () => {
    let called = false;
    harness = new AcpHarness(async () => {
      called = true;
      return { stopReason: 'end_turn' };
    });

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: 'not-an-array' },
    });
    await harness.flush();

    expect(called).toBe(false);
    expect(harness.responseFor(2)?.error).toMatchObject({
      code: -32602,
      message: 'Invalid or missing prompt',
    });
  });

  it('rejects malformed session/prompt content blocks without poisoning the session', async () => {
    const seenTexts: string[] = [];
    harness = new AcpHarness(async ({ prompt }) => {
      seenTexts.push(prompt[0]?.text ?? '');
      return { stopReason: 'end_turn' };
    });

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [null] },
    });
    await harness.flush();

    expect(seenTexts).toEqual([]);
    expect(harness.responseFor(2)?.error).toMatchObject({
      code: -32602,
      message: 'Invalid prompt content block at index 0',
    });

    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'still usable' }] },
    });
    await harness.flush();

    expect(seenTexts).toEqual(['still usable']);
    expect(harness.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('rejects unsupported session/prompt content block types before running the prompt', async () => {
    let called = false;
    harness = new AcpHarness(async () => {
      called = true;
      return { stopReason: 'end_turn' };
    });

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'image', url: 'file:///tmp/private.png' }] },
    });
    await harness.flush();

    expect(called).toBe(false);
    expect(harness.responseFor(2)?.error).toMatchObject({
      code: -32602,
      message: 'Unsupported prompt content block type at index 0: image',
    });
  });

  it('cancels an in-flight turn via the session/cancel notification', async () => {
    const runner: AcpPromptRunner = ({ signal }) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve({ stopReason: 'cancelled' });
        signal.addEventListener('abort', () => resolve({ stopReason: 'end_turn' }));
      });
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'long' }] } });
    await harness.flush(); // prompt is pending on the abort signal
    expect(harness.responseFor(2)).toBeUndefined();

    harness.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }); // notification, no id
    await harness.flush();

    // Server overrides the runner's reason to 'cancelled' because the signal aborted.
    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'cancelled' });
  });

  it('responds when session/cancel is sent as a JSON-RPC request', async () => {
    const runner: AcpPromptRunner = ({ signal }) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve({ stopReason: 'cancelled' });
        signal.addEventListener('abort', () => resolve({ stopReason: 'end_turn' }));
      });
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'long' }] } });
    await harness.flush();
    expect(harness.responseFor(2)).toBeUndefined();

    harness.send({ jsonrpc: '2.0', id: 3, method: 'session/cancel', params: { sessionId } });
    await harness.flush();

    expect(harness.responseFor(3)?.result).toBeNull();
    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'cancelled' });
  });

  it('rejects request-style session/cancel for unknown sessions', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/cancel', params: { sessionId: 'missing-session' } });
    await harness.flush();

    expect(harness.responseFor(1)?.error).toMatchObject({
      code: -32602,
      message: 'Unknown or missing sessionId',
    });
  });

  it('rejects concurrent prompts for the same session', async () => {
    const runner: AcpPromptRunner = ({ signal }) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve({ stopReason: 'cancelled' });
        signal.addEventListener('abort', () => resolve({ stopReason: 'end_turn' }));
      });
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'first long prompt' }] },
    });
    await harness.flush();
    expect(harness.responseFor(2)).toBeUndefined();

    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'second prompt' }] },
    });
    await harness.flush();

    expect(harness.responseFor(3)?.error).toMatchObject({
      code: -32000,
      message: 'Session already has an active prompt',
    });

    harness.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    await harness.flush();
    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'cancelled' });
  });

  it('aborts in-flight turns when the stdio transport stops', async () => {
    const runner: AcpPromptRunner = ({ signal }) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve({ stopReason: 'cancelled' });
        signal.addEventListener('abort', () => resolve({ stopReason: 'end_turn' }));
      });
    harness = new AcpHarness(runner);

    harness.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} });
    await harness.flush();
    const sessionId = harness.responseFor(1)?.result.sessionId as string;

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'long after editor closes' }] },
    });
    await harness.flush();
    expect(harness.responseFor(2)).toBeUndefined();

    harness.server.stop();
    await harness.flush();

    expect(harness.responseFor(2)?.result).toEqual({ stopReason: 'cancelled' });
  });

  it('reports a parse error for malformed input', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));
    harness.input.write('not json\n');
    await harness.flush();

    const parseError = harness.messages.find((m) => m.error?.code === -32700);
    expect(parseError).toBeTruthy();
    expect(parseError?.id).toBeNull();
  });

  it('returns invalid-request for request messages without a string method', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));

    harness.send({ jsonrpc: '2.0', id: 8, params: {} });
    await harness.flush();

    expect(harness.responseFor(8)?.error).toMatchObject({
      code: -32600,
      message: 'Invalid Request',
    });
  });

  it('returns method-not-found for unknown methods', async () => {
    harness = new AcpHarness(async () => ({ stopReason: 'end_turn' }));
    harness.send({ jsonrpc: '2.0', id: 9, method: 'does/not-exist', params: {} });
    await harness.flush();

    expect(harness.responseFor(9)?.error?.code).toBe(-32601);
  });
});
