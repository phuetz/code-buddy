/**
 * Integration test: a real ACP tool-using turn, end to end.
 *
 * We instantiate the REAL `AcpStdioServer` over in-memory ndjson streams and
 * play a simulated ACP client (the editor) on top of the JSON-RPC transport.
 * Only the LLM is mocked — the entire ACP path (transport, dispatch, the
 * agentic runner, the agent→client round-trips) is exercised for real.
 *
 * Flow proven by this test:
 *   initialize (announce fs + permission caps) → session/new → session/prompt
 *     → LLM round 1: emits a `view_file` tool call
 *     → server emits `tool_call` (in_progress) + executes the tool
 *     → runner calls `session/request_permission` → simulated client ALLOWS
 *     → runner calls `fs/read_text_file` → simulated client returns buffer content
 *     → server emits `tool_call_update` (completed) carrying that content
 *     → LLM round 2 SEES the file content in the tool-role message → final text
 *     → `agent_message_chunk` + stopReason `end_turn`
 *
 * The strongest assertion is #3: the content the simulated client returned
 * for `fs/read_text_file` must appear in the tool message the LLM receives on
 * its second call. That's a true round-trip, not a shape check.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpSessionStore } from '../../../src/protocols/acp/acp-session-store.js';

import {
  AcpStdioServer,
  ACP_PROTOCOL_VERSION,
  type AcpClientCapabilities,
} from '../../../src/protocols/acp/acp-stdio-server.js';
import {
  createAcpAgenticRunner,
  type AcpChatFn,
} from '../../../src/protocols/acp/acp-agentic-runner.js';
import type {
  CodeBuddyMessage,
  CodeBuddyResponse,
} from '../../../src/codebuddy/client.js';

const FILE_CONTENT = 'export const SECRET_MARKER = "buffer-only-edit-42";\n';

/**
 * Drives a real AcpStdioServer over ndjson streams AND acts as the editor:
 * it answers agent→client requests (`fs/read_text_file`,
 * `session/request_permission`) by writing JSON-RPC responses back.
 */
class SimulatedEditor {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  readonly messages: Array<Record<string, any>> = [];
  readonly clientRequests: Array<Record<string, any>> = [];
  readonly server: AcpStdioServer;
  readonly storeDir: string;
  /** Records of fs/read_text_file requests the agent made. */
  readonly reads: Array<Record<string, any>> = [];
  /** Records of fs/write_text_file requests the agent made. */
  readonly writes: Array<Record<string, any>> = [];
  readonly permissions: Array<Record<string, any>> = [];

  constructor(
    runner: (ctx: any) => Promise<{ stopReason: any }>,
    files: Record<string, string>,
  ) {
    this.output.setEncoding('utf8');
    this.output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const msg = JSON.parse(trimmed);
        this.messages.push(msg);
        // Agent→client request: has an id AND a method.
        if (msg.id !== undefined && typeof msg.method === 'string') {
          this.clientRequests.push(msg);
          this.answerClientRequest(msg, files);
        }
      }
    });
    // Persist into a private temp store, not the runner's real ~/.codebuddy.
    this.storeDir = mkdtempSync(join(tmpdir(), 'acp-agentic-turn-'));
    this.server = new AcpStdioServer({
      input: this.input,
      output: this.output,
      promptRunner: runner,
      store: new AcpSessionStore({ storeDir: this.storeDir }),
      // Keep the pending-request timer short so nothing lingers.
      clientRequestTimeoutMs: 2_000,
    });
    this.server.start();
  }

  private answerClientRequest(msg: Record<string, any>, files: Record<string, string>): void {
    if (msg.method === 'session/request_permission') {
      this.permissions.push(msg);
      this.send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { outcome: { outcome: 'selected', optionId: 'allow' } },
      });
      return;
    }
    if (msg.method === 'fs/read_text_file') {
      this.reads.push(msg);
      const requested = String(msg.params?.path ?? '');
      const content = files[requested] ?? files[Object.keys(files)[0] ?? ''] ?? '';
      this.send({ jsonrpc: '2.0', id: msg.id, result: { content } });
      return;
    }
    if (msg.method === 'fs/write_text_file') {
      this.writes.push(msg);
      this.send({ jsonrpc: '2.0', id: msg.id, result: null });
      return;
    }
    // Unknown agent→client method — fail it so the runner doesn't hang.
    this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unsupported' } });
  }

  send(message: Record<string, unknown>): void {
    this.input.write(`${JSON.stringify(message)}\n`);
  }

  async flush(iterations = 6): Promise<void> {
    // Multiple macrotask hops let the agent↔client round-trips settle.
    for (let i = 0; i < iterations; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Wait until a JSON-RPC response (or error) for `id` has been written back,
   * rather than flushing a fixed number of ticks. A fixed `flush(N)` is flaky
   * under load — a saturated test box may need more macrotask hops than the
   * count assumed in isolation. Only the LLM is mocked here, so a response
   * always arrives; this just polls for it with a generous ceiling.
   */
  async waitForResponse(id: number, timeoutMs = 5000): Promise<Record<string, any> | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.responseFor(id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return this.responseFor(id);
  }

  responseFor(id: number): Record<string, any> | undefined {
    return this.messages.find((m) => m.id === id && ('result' in m || 'error' in m));
  }

  updates(): Array<Record<string, any>> {
    return this.messages.filter((m) => m.method === 'session/update' && m.id === undefined);
  }

  updatesOfType(type: string): Array<Record<string, any>> {
    return this.updates().filter((m) => m.params?.update?.sessionUpdate === type);
  }
}

const FS_CAPS: AcpClientCapabilities = { fs: { readTextFile: true, writeTextFile: false } };
const FS_WRITE_CAPS: AcpClientCapabilities = { fs: { readTextFile: true, writeTextFile: true } };

describe('ACP agentic tool-using turn (real server + simulated editor)', () => {
  let editor: SimulatedEditor;

  afterEach(() => {
    editor?.server.stop();
    if (editor) rmSync(editor.storeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('runs a real tool round-trip: tool_call → permission → fs/read → tool_call_update → end_turn', async () => {
    const absPath = '/workspace/app.ts';

    // Mock ONLY the LLM. Round 1 emits a view_file tool call; round 2 (after
    // it has seen the file content) returns the final answer.
    const chatCalls: CodeBuddyMessage[][] = [];
    const chat: AcpChatFn = vi.fn(async (messages) => {
      chatCalls.push(messages.map((m) => ({ ...m })) as CodeBuddyMessage[]);
      const round = chatCalls.length;
      if (round === 1) {
        const res: CodeBuddyResponse = {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'view_file', arguments: JSON.stringify({ file_path: absPath }) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
        return res;
      }
      const res: CodeBuddyResponse = {
        choices: [
          {
            message: { role: 'assistant', content: 'The file defines SECRET_MARKER.', tool_calls: [] },
            finish_reason: 'stop',
          },
        ],
      };
      return res;
    });

    const runner = createAcpAgenticRunner({ chat });
    editor = new SimulatedEditor(runner, { [absPath]: FILE_CONTENT });

    // initialize — announce fs read + permission capabilities.
    editor.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: FS_CAPS },
    });
    await editor.waitForResponse(1);
    expect(editor.responseFor(1)?.result?.protocolVersion).toBe(ACP_PROTOCOL_VERSION);

    // session/new
    editor.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/workspace', mcpServers: [] } });
    await editor.waitForResponse(2);
    const sessionId = editor.responseFor(2)?.result?.sessionId as string;
    expect(sessionId).toBeTruthy();

    // session/prompt — kicks off the agentic loop.
    editor.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'What does app.ts define?' }] },
    });
    await editor.waitForResponse(3);

    // (1) The turn completed with end_turn.
    expect(editor.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });

    // (2) The server emitted a spec-shaped tool_call (in_progress, camelCase id).
    const toolCalls = editor.updatesOfType('tool_call');
    expect(toolCalls).toHaveLength(1);
    const toolCall = toolCalls[0]!.params.update;
    expect(toolCall.toolCallId).toBeTruthy();
    expect(toolCall.kind).toBe('read');
    expect(toolCall.status).toBe('in_progress');
    expect(toolCall.rawInput).toMatchObject({ file_path: absPath });

    // (2b) ...and a tool_call_update (completed) carrying the file content.
    const toolUpdates = editor.updatesOfType('tool_call_update');
    expect(toolUpdates).toHaveLength(1);
    const toolUpdate = toolUpdates[0]!.params.update;
    expect(toolUpdate.toolCallId).toBe(toolCall.toolCallId);
    expect(toolUpdate.status).toBe('completed');
    expect(toolUpdate.content[0].content.text).toContain('SECRET_MARKER');

    // (3) The agent→client round-trips actually happened, and the permission
    // prompt referenced the SAME live tool call id the editor saw.
    expect(editor.permissions).toHaveLength(1);
    expect(editor.permissions[0]!.params.sessionId).toBe(sessionId);
    expect(editor.permissions[0]!.params.toolCall.toolCallId).toBe(toolCall.toolCallId);
    expect(editor.reads).toHaveLength(1);
    expect(editor.reads[0]!.params).toMatchObject({ sessionId, path: absPath });

    // (4) THE KEY PROOF: the content the editor returned for fs/read_text_file
    // flowed into the tool-role message the LLM saw on its SECOND call.
    expect(chatCalls).toHaveLength(2);
    const round2 = chatCalls[1]!;
    const toolMsg = round2.find((m) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect(String((toolMsg as any).content)).toContain('SECRET_MARKER');

    // (5) The final assistant text reached the editor.
    const chunks = editor.updatesOfType('agent_message_chunk');
    expect(chunks.at(-1)?.params.update.content.text).toBe('The file defines SECRET_MARKER.');
  });

  it('falls back to disk read when the client does not advertise fs.readTextFile', async () => {
    // Without fs caps, no fs/read_text_file request should be made; the runner
    // reads from disk (here a nonexistent path → tool failure, but the ACP
    // path still completes cleanly with end_turn).
    const chat: AcpChatFn = vi.fn(async () => {
      const round = (chat as any).mock.calls.length;
      if (round === 1) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'view_file', arguments: JSON.stringify({ file_path: 'missing.ts' }) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        } as CodeBuddyResponse;
      }
      return {
        choices: [{ message: { role: 'assistant', content: 'done', tool_calls: [] }, finish_reason: 'stop' }],
      } as CodeBuddyResponse;
    });

    const runner = createAcpAgenticRunner({ chat });
    editor = new SimulatedEditor(runner, {});

    editor.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: {} },
    });
    editor.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/workspace', mcpServers: [] } });
    await editor.waitForResponse(2);
    const sessionId = editor.responseFor(2)?.result?.sessionId as string;

    editor.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'read missing.ts' }] },
    });
    await editor.waitForResponse(3);

    // No client fs/read_text_file or permission requests were made.
    expect(editor.reads).toHaveLength(0);
    expect(editor.permissions).toHaveLength(0);
    // Tool failed (disk miss) but the turn still ended cleanly.
    const toolUpdate = editor.updatesOfType('tool_call_update').at(-1)?.params.update;
    expect(toolUpdate.status).toBe('failed');
    expect(editor.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('does not expose or execute write_file without the editor write capability', async () => {
    const seenToolNames: string[][] = [];
    const chat: AcpChatFn = vi.fn(async (_messages, tools) => {
      seenToolNames.push((tools ?? []).map((tool) => tool.function.name));
      const round = (chat as any).mock.calls.length;
      if (round === 1) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_write',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments: JSON.stringify({ file_path: 'app.ts', content: 'changed' }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        } as CodeBuddyResponse;
      }
      return {
        choices: [{ message: { role: 'assistant', content: 'done', tool_calls: [] }, finish_reason: 'stop' }],
      } as CodeBuddyResponse;
    });

    const runner = createAcpAgenticRunner({ chat });
    editor = new SimulatedEditor(runner, {});

    editor.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: FS_CAPS },
    });
    editor.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/workspace', mcpServers: [] } });
    await editor.waitForResponse(2);
    const sessionId = editor.responseFor(2)?.result?.sessionId as string;

    editor.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'try to write app.ts' }] },
    });
    await editor.waitForResponse(3);

    expect(seenToolNames[0]).not.toContain('write_file');
    expect(editor.writes).toHaveLength(0);
    const toolUpdate = editor.updatesOfType('tool_call_update').at(-1)?.params.update;
    expect(toolUpdate.status).toBe('failed');
    expect(toolUpdate.content[0].content.text).toContain('did not advertise fs.writeTextFile');
    expect(editor.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('routes write_file through editor permission and fs.write_text_file when advertised', async () => {
    const absPath = '/workspace/app.ts';
    const seenToolNames: string[][] = [];
    const chat: AcpChatFn = vi.fn(async (_messages, tools) => {
      seenToolNames.push((tools ?? []).map((tool) => tool.function.name));
      const round = (chat as any).mock.calls.length;
      if (round === 1) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_write',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments: JSON.stringify({ file_path: absPath, content: 'export const value = 1;\n' }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        } as CodeBuddyResponse;
      }
      return {
        choices: [{ message: { role: 'assistant', content: 'write complete', tool_calls: [] }, finish_reason: 'stop' }],
      } as CodeBuddyResponse;
    });

    const runner = createAcpAgenticRunner({ chat });
    editor = new SimulatedEditor(runner, {});

    editor.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: FS_WRITE_CAPS },
    });
    editor.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/workspace', mcpServers: [] } });
    await editor.waitForResponse(2);
    const sessionId = editor.responseFor(2)?.result?.sessionId as string;

    editor.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'write app.ts' }] },
    });
    await editor.waitForResponse(3);

    expect(seenToolNames[0]).toContain('write_file');
    const toolCall = editor.updatesOfType('tool_call')[0]!.params.update;
    expect(toolCall.kind).toBe('edit');
    expect(editor.permissions).toHaveLength(1);
    expect(editor.permissions[0]!.params.toolCall.toolCallId).toBe(toolCall.toolCallId);
    expect(editor.writes).toHaveLength(1);
    expect(editor.writes[0]!.params).toMatchObject({
      sessionId,
      path: absPath,
      content: 'export const value = 1;\n',
    });
    const toolUpdate = editor.updatesOfType('tool_call_update').at(-1)?.params.update;
    expect(toolUpdate.status).toBe('completed');
    expect(editor.responseFor(3)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('returns max_turn_requests when the model never stops calling tools', async () => {
    // Always emit a tool call → loop should hit the round cap and bail.
    const chat: AcpChatFn = vi.fn(async () => ({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_loop',
                type: 'function',
                function: { name: 'list_directory', arguments: JSON.stringify({ path: '.' }) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }) as CodeBuddyResponse);

    const runner = createAcpAgenticRunner({ chat, maxRounds: 3 });
    editor = new SimulatedEditor(runner, {});

    editor.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: {} },
    });
    editor.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: process.cwd(), mcpServers: [] } });
    await editor.waitForResponse(2);
    const sessionId = editor.responseFor(2)?.result?.sessionId as string;

    editor.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'loop forever' }] },
    });
    await editor.waitForResponse(3);

    expect(editor.responseFor(3)?.result).toEqual({ stopReason: 'max_turn_requests' });
    expect((chat as any).mock.calls.length).toBe(3);
  });
});
