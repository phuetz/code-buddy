/** The provider is fake; the agent loop, tool registry and security gates are real. */
import fs from 'node:fs';
import axios from 'axios';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAcpAgenticRunner, type AcpAgenticRunner } from '../../../src/protocols/acp/acp-agentic-runner.js';
import type { AcpPromptContext, AcpSessionUpdate } from '../../../src/protocols/acp/acp-stdio-server.js';
import type { AgentModelClient } from '../../../src/agent/codebuddy-agent.js';
import { getPermissionModeManager } from '../../../src/security/permission-modes.js';

let dir: string;
let runner: AcpAgenticRunner;
let updates: AcpSessionUpdate[];
let client: ReturnType<typeof vi.fn>;
let modelMessages: unknown[][];

function model(name: string, args: Record<string, unknown>, forever = false): AgentModelClient {
  let round = 0;
  return {
    getCurrentModel: () => 'fake-local',
    isEffectiveTargetLocal: () => true,
    probeToolSupport: async () => true,
    chatStream: async function* (messages) {
      modelMessages.push(structuredClone(messages) as unknown[]);
      if (round++ === 0 || forever) yield { choices: [{ index: 0, delta: {
        tool_calls: [{ index: 0, id: `call_${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      }, finish_reason: 'tool_calls' }] };
      else yield { choices: [{ index: 0, delta: { content: 'done', reasoning_content: 'checked' }, finish_reason: 'stop' }] };
    },
  };
}
function context(caps = false, signal = new AbortController().signal): AcpPromptContext {
  return {
    sessionId: 'test-session', cwd: dir, signal,
    clientCapabilities: caps ? { fs: { readTextFile: true, writeTextFile: true } } : {},
    prompt: [{ type: 'text', text: 'Read and edit file; use the requested tool' }],
    canRequestClient: (method) => method === 'session/request_permission' || caps,
    requestClient: client,
    sendUpdate: (update) => updates.push(update),
    saveConversation: vi.fn(), mcpServers: [],
  };
}
function create(name: string, args: Record<string, unknown>, forever = false) {
  runner = createAcpAgenticRunner({ apiKey: '', model: 'fake-local', modelClient: model(name, args, forever), maxRounds: 3 });
  return runner;
}

beforeEach(() => {
  const home = path.resolve('_qa/acp/home');
  fs.mkdirSync(home, { recursive: true });
  dir = fs.mkdtempSync(path.join(home, 'unit-'));
  vi.stubEnv('HOME', dir);
  vi.stubEnv('CODEBUDDY_DISABLE_MCP', 'true');
  getPermissionModeManager().setMode('default');
  updates = []; modelMessages = [];
  client = vi.fn(async (method: string) => {
    if (method === 'fs/read_text_file') return { content: 'buffer-only\n' };
    if (method === 'session/request_permission') return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
    return {};
  });
});
afterEach(async () => {
  await runner?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('ACP adapter around the interactive agent', () => {
  it('reads an unsaved buffer, emits tool results and thoughts, feeds the result back into the model', async () => {
    const result = await create('view_file', { path: 'unsaved.txt' })(context(true));
    expect(result.stopReason).toBe('end_turn');
    expect(client).toHaveBeenCalledWith('fs/read_text_file', expect.objectContaining({ path: path.join(dir, 'unsaved.txt') }));
    expect(client.mock.calls.some(([method]) => method === 'session/request_permission')).toBe(false);
    expect(updates.some((update) => update.sessionUpdate === 'agent_thought_chunk')).toBe(true);
    expect(updates.some((update) => update.sessionUpdate === 'tool_call_update' && update.status === 'completed')).toBe(true);
    expect(JSON.stringify(modelMessages[1])).toContain('buffer-only');
  }, 45_000); // First turn imports the full agent/tool graph, also under parallel suite load.
  it('uses the disk when no filesystem capability is advertised', async () => {
    fs.writeFileSync(path.join(dir, 'file.txt'), 'disk-content');
    await create('view_file', { path: 'file.txt' })(context());
    expect(client).not.toHaveBeenCalled();
    expect(JSON.stringify(modelMessages[1])).toContain('disk-content');
  });
  it('writes on disk after normal confirmation, with a structured diff', async () => {
    fs.writeFileSync(path.join(dir, 'file.txt'), 'before');
    await create('str_replace_editor', { path: 'file.txt', old_str: 'before', new_str: 'after' })(context());
    expect(fs.readFileSync(path.join(dir, 'file.txt'), 'utf8')).toBe('after');
    const permissionCall = client.mock.calls.find(([method]) => method === 'session/request_permission');
    expect(permissionCall).toBeTruthy();
    expect(updates.some((update) => Array.isArray(update.content) && update.content.some((item: { type: string; oldText?: string; newText?: string }) => item.type === 'diff' && item.oldText === 'before' && item.newText === 'after'))).toBe(true);
  });
  it.each(['cancelled', 'timeout'])('fails closed on %s permission', async (outcome) => {
    client.mockImplementation(async () => {
      if (outcome === 'timeout') throw new Error('timeout');
      return { outcome: { outcome: 'cancelled' } };
    });
    await create('create_file', { path: 'denied.txt', content: 'never' })(context());
    expect(client).toHaveBeenCalledWith('session/request_permission', expect.objectContaining({ sessionId: 'test-session' }));
    expect(fs.existsSync(path.join(dir, 'denied.txt'))).toBe(false);
    expect(updates.some((update) => update.sessionUpdate === 'tool_call_update' && update.status === 'failed')).toBe(true);
  });
  it('refuses lexical and symlink escapes before asking the editor', async () => {
    fs.symlinkSync(path.dirname(dir), path.join(dir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await create('view_file', { path: 'escape/outside.txt' })(context(true));
    expect(client).not.toHaveBeenCalled();
    expect(updates.some((update) => update.sessionUpdate === 'tool_call_update' && update.status === 'failed')).toBe(true);
  });
  it('resolves the legacy Morph edit against the session cwd and current editor buffer', async () => {
    vi.stubEnv('MORPH_API_KEY', 'synthetic-test-value');
    fs.writeFileSync(path.join(dir, 'file.txt'), 'disk-before');
    const apply = vi.spyOn(axios, 'post').mockResolvedValue({ data: { choices: [{ message: { content: 'merged-buffer' } }] } });
    expect(dir).not.toBe(process.cwd());
    await create('edit_file', { target_file: 'file.txt', instructions: 'merge', code_edit: 'merged-buffer' })(context(true));
    expect(apply).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ messages: [expect.objectContaining({ content: expect.stringContaining('<code>buffer-only\n</code>') })] }), expect.any(Object));
    expect(client).toHaveBeenCalledWith('fs/write_text_file', expect.objectContaining({ path: path.join(dir, 'file.txt'), content: 'merged-buffer' }));
    expect(fs.readFileSync(path.join(dir, 'file.txt'), 'utf8')).toBe('disk-before');
  });
  it('refuses a legacy Morph path outside the session before editor or provider IO', async () => {
    vi.stubEnv('MORPH_API_KEY', 'synthetic-test-value');
    fs.symlinkSync(path.dirname(dir), path.join(dir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const apply = vi.spyOn(axios, 'post');
    await create('edit_file', { target_file: 'escape/outside.txt', instructions: 'merge', code_edit: 'never' })(context(true));
    expect(apply).not.toHaveBeenCalled();
    expect(client).not.toHaveBeenCalled();
    expect(updates.some((update) => update.status === 'failed')).toBe(true);
  });
  it('keeps the review transaction closed for legacy Morph edits to unsaved buffers', async () => {
    vi.stubEnv('MORPH_API_KEY', 'synthetic-test-value');
    vi.stubEnv('CODEBUDDY_DIFF_REVIEW', 'static');
    const apply = vi.spyOn(axios, 'post').mockResolvedValue({ data: { choices: [{ message: { content: 'merged-buffer' } }] } });
    await create('edit_file', { target_file: 'unsaved.txt', instructions: 'merge', code_edit: 'merged-buffer' })(context(true));
    expect(apply).toHaveBeenCalled();
    expect(client.mock.calls.some(([method]) => method === 'fs/write_text_file')).toBe(false);
    expect(fs.existsSync(path.join(dir, 'unsaved.txt'))).toBe(false);
    expect(updates.some((update) => update.status === 'failed' && JSON.stringify(update.content).includes('requires disk snapshots'))).toBe(true);
  });
  it.each(['review', 'shadow'])('keeps %s disk transactions closed for an unsaved read-only editor buffer', async (gate) => {
    vi.stubEnv(gate === 'review' ? 'CODEBUDDY_DIFF_REVIEW' : 'CODEBUDDY_SHADOW_WORKSPACE', gate === 'review' ? 'static' : 'true');
    fs.writeFileSync(path.join(dir, 'file.txt'), 'disk-before');
    const ctx = context(true);
    ctx.clientCapabilities = { fs: { readTextFile: true } };
    ctx.canRequestClient = (method) => method === 'fs/read_text_file' || method === 'session/request_permission';
    await create('str_replace_editor', { path: 'file.txt', old_str: 'buffer-only', new_str: 'changed' })(ctx);
    expect(client).toHaveBeenCalledWith('fs/read_text_file', expect.objectContaining({ path: path.join(dir, 'file.txt') }));
    expect(client.mock.calls.some(([method]) => method === 'fs/write_text_file')).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'file.txt'), 'utf8')).toBe('disk-before');
    expect(updates.some((update) => update.status === 'failed' && JSON.stringify(update.content).includes('requires disk snapshots'))).toBe(true);
  });
  it('retains a finite tool round limit', async () => {
    expect(await create('list_directory', { path: '.' }, true)(context())).toEqual({ stopReason: 'max_turn_requests' });
  });
  it('streams the actual task list as an ACP plan', async () => {
    await create('todo_update', { action: 'add', text: 'Inspect sources', priority: 'high' })(context());
    expect(updates.find((update) => update.sessionUpdate === 'plan')?.entries).toEqual([
      { content: 'Inspect sources', priority: 'high', status: 'pending' },
    ]);
  });
});
