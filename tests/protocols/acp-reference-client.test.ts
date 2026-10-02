import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type SessionNotification, type RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const qa = path.join(root, '_qa/acp');
const home = path.join(qa, 'home');
const built = process.env.ACP_REFERENCE_BUILT === 'true';
const entrypoint = path.join(root, built ? 'dist/index.js' : 'src/index.ts');
const children: ChildProcessWithoutNullStreams[] = [];
const homes = new Map<string, string>();
const dirs: string[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, timeout = 20_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for real ACP process');
    await sleep(20);
  }
}

function spawnAgent(workspace: string, permissionMode = 'default', nodeEnv = 'test') {
  let testHome = homes.get(workspace);
  if (!testHome) {
    testHome = fs.mkdtempSync(path.join(home, 'client-'));
    homes.set(workspace, testHome);
    dirs.push(testHome);
  }
  const child = spawn(process.execPath, ['--import', 'tsx', '--import', path.join(root, 'tests/fixtures/acp/deterministic-provider.mjs'), entrypoint, 'acp', '--permission-mode', permissionMode], {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: testHome, USERPROFILE: testHome, NODE_ENV: nodeEnv,
      CODEBUDDY_PROVIDER: 'grok', GROK_API_KEY: 'synthetic-test-value', GROK_MODEL: 'grok-code-fast-1',
      GROK_BASE_URL: 'http://acp-fixture.invalid/v1', CODEBUDDY_DISABLE_MCP: 'true',
      ACP_FIXTURE_WORKSPACE: workspace },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  return { child, stderr: () => stderr };
}

function launch(workspace: string, capabilities = true, permissionMode = 'default') {
  const { child, stderr } = spawnAgent(workspace, permissionMode);
  const updates: SessionNotification[] = [];
  const permissions: RequestPermissionRequest[] = [];
  const reads: string[] = [];
  const writes: string[] = [];
  let rejectEditDiff = false;
  let decision: 'allow_once' | 'reject_once' | 'allow_always' | 'cancelled' = 'reject_once';
  let buffer = 'buffer-original\n';
  const connection = new ClientSideConnection(() => ({
    sessionUpdate: (params) => { updates.push(params); },
    requestPermission: (params) => {
      permissions.push(params);
      // This assertion executes at the moment of the request, not after the turn.
      expect(updates.some(({ update }) => update.sessionUpdate === 'tool_call' && update.toolCallId === params.toolCall.toolCallId)).toBe(true);
      const shownDiff = params.toolCall.content?.some((item) => item.type === 'diff') || JSON.stringify(params.toolCall.content).includes('---');
      if (rejectEditDiff && shownDiff) return { outcome: { outcome: 'selected', optionId: 'reject_once' } };
      return decision === 'cancelled' ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: decision } };
    },
    readTextFile: ({ path: file }) => { reads.push(file); return { content: buffer }; },
    writeTextFile: ({ path: file, content }) => { writes.push(file); buffer = content; fs.writeFileSync(file, content); return {}; },
  }), ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  return { child, connection, updates, permissions, reads, writes,
    allow: (value: typeof decision) => { decision = value; },
    rejectDiff: () => { rejectEditDiff = true; },
    resetBuffer: () => { buffer = 'buffer-original\n'; },
    stderr,
    initialize: () => connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: capabilities ? { fs: { readTextFile: true, writeTextFile: true } } : {} }),
    close: async () => { child.stdin.end(); await until(() => child.exitCode !== null, 15_000); },
  };
}

function workspace(): string {
  fs.mkdirSync(home, { recursive: true });
  const dir = fs.mkdtempSync(path.join(qa, 'repo-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'sample.txt'), 'disk-original\n');
  return dir;
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise((resolve) => child.once('close', resolve)); }
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('real buddy acp process shutdown', () => {
  it('closes cleanly with a nonzero status when the client closes stdout', async () => {
    const dir = workspace();
    const { child, stderr } = spawnAgent(dir, 'default', 'development');
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION } }) + '\n');
    await until(() => stdout.includes('"id":1'));
    child.stdout.destroy();
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: dir, mcpServers: [] } }) + '\n');
    await closed;
    expect(child.exitCode).toBe(1);
    expect(stderr()).toContain('ACP transport shutdown failed');
    expect(stderr()).not.toMatch(/unhandled|Unhandled/);
    expect(stderr()).not.toContain('Unexpected error occurred');
  }, 30_000);

  it('answers every accepted request and saves the session when stdin closes before the first response', async () => {
    const dir = workspace();
    const { child, stderr } = spawnAgent(dir);
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    child.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION } },
      { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: dir, mcpServers: [] } },
      { jsonrpc: '2.0', id: 3, method: 'session/list', params: {} },
      { jsonrpc: '2.0', id: 4, method: 'session/load', params: { sessionId: 'unknown' } },
    ].map((message) => JSON.stringify(message)).join('\n') + '\n');
    await closed;
    expect(child.exitCode, stderr()).toBe(0);
    const messages = stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(messages.map((message) => message.id).sort()).toEqual([1, 2, 3, 4]);
    const sessionId = messages.find((message) => message.id === 2)?.result.sessionId;
    expect(sessionId).toEqual(expect.any(String));
    expect(messages.find((message) => message.id === 3)?.result.sessions).toEqual([
      expect.objectContaining({ sessionId, cwd: dir }),
    ]);
    expect(messages.find((message) => message.id === 4)?.error.code).toBe(-32602);
    const saved = JSON.parse(fs.readFileSync(path.join(homes.get(dir)!, '.codebuddy/acp-sessions', `${sessionId}.json`), 'utf8'));
    expect(saved).toMatchObject({ sessionId, cwd: dir });
    fs.writeFileSync(path.join(qa, built ? 'eof-built-transcript.json' : 'eof-transcript.json'), JSON.stringify({ messages, exitCode: child.exitCode, saved }, null, 2));
  }, 30_000);
});

describe('official ACP reference client → real buddy acp process', () => {
  it('uses the buffer, refuses then applies an edit, resumes across processes and cancels a running command', async () => {
    const dir = workspace();
    const editor = launch(dir);
    await editor.initialize();
    const { sessionId } = await editor.connection.newSession({ cwd: dir, mcpServers: [] });
    const prompt = (text: string) => editor.connection.prompt({ sessionId, prompt: [{ type: 'text', text }] });
    expect(await prompt('edit sample.txt')).toEqual({ stopReason: 'end_turn' });
    expect(editor.reads).toContain(path.join(dir, 'sample.txt'));
    expect(editor.permissions.length).toBeGreaterThan(0);
    expect(editor.writes).toHaveLength(0);
    expect(fs.readFileSync(path.join(dir, 'sample.txt'), 'utf8')).toBe('disk-original\n');
    expect(editor.updates.some(({ update }) => update.sessionUpdate === 'tool_call_update' && update.status === 'failed')).toBe(true);
    editor.allow('allow_once');
    expect(await prompt('edit sample.txt')).toEqual({ stopReason: 'end_turn' });
    expect(editor.writes).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, 'sample.txt'), 'utf8')).toBe('buffer-edited\n');
    const diffs = editor.updates.flatMap(({ update }) => update.sessionUpdate === 'tool_call_update' ? update.content ?? [] : []).filter((item) => item.type === 'diff');
    expect(diffs.some((diff) => diff.oldText === 'buffer-original\n' && diff.newText === 'buffer-edited\n')).toBe(true);
    const calls = fs.readFileSync(path.join(dir, 'provider.jsonl'), 'utf8');
    expect(calls).toContain('buffer-original');
    expect(calls).toContain('str_replace_editor');
    await editor.close();
    const resumed = launch(dir);
    await resumed.initialize();
    await resumed.connection.loadSession({ sessionId, cwd: dir, mcpServers: [] });
    expect(resumed.updates.length).toBeGreaterThan(0);
    expect(await resumed.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'remember prior change' }] })).toEqual({ stopReason: 'end_turn' });
    expect(resumed.updates.some(({ update }) => update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' && update.content.text.includes('remembered-buffer-edited'))).toBe(true);
    resumed.allow('allow_once');
    const pending = resumed.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'long command' }] });
    await until(() => fs.existsSync(path.join(dir, 'started.txt')));
    await resumed.connection.cancel({ sessionId });
    expect(await pending).toEqual({ stopReason: 'cancelled' });
    expect(resumed.updates.some(({ update }) => update.sessionUpdate === 'tool_call_update' && update.status === 'failed' && JSON.stringify(update.content).includes('Cancelled by user'))).toBe(true);
    await sleep(3300);
    expect(fs.existsSync(path.join(dir, 'late.txt'))).toBe(false);
    fs.writeFileSync(path.join(qa, built ? 'reference-built-transcript.json' : 'reference-transcript.json'), JSON.stringify({ updates: editor.updates, permissions: editor.permissions, resumedUpdates: resumed.updates, providerCalls: fs.readFileSync(path.join(dir, 'provider.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)), diskAfter: fs.readFileSync(path.join(dir, 'sample.txt'), 'utf8'), delayedWriteExists: fs.existsSync(path.join(dir, 'late.txt')), stderr: editor.stderr() + resumed.stderr() }, null, 2));
    await resumed.close();
  }, 90_000);

  it('finishes the cancelled prompt response when stdin closes during an LLM request', async () => {
    const dir = workspace();
    const editor = launch(dir);
    await editor.initialize();
    const { sessionId } = await editor.connection.newSession({ cwd: dir, mcpServers: [] });
    const pending = editor.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'stall model' }] });
    await until(() => fs.existsSync(path.join(dir, 'provider.jsonl')) && fs.readFileSync(path.join(dir, 'provider.jsonl'), 'utf8').includes('stall model'));
    const closing = editor.close();
    expect(await pending).toEqual({ stopReason: 'cancelled' });
    await closing;
    expect(editor.child.exitCode, editor.stderr()).toBe(0);
  }, 30_000);

  it('cancels an LLM request while waiting for its first token', async () => {
    const dir = workspace();
    const editor = launch(dir);
    await editor.initialize();
    const { sessionId } = await editor.connection.newSession({ cwd: dir, mcpServers: [] });
    const pending = editor.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'stall model' }] });
    await until(() => fs.existsSync(path.join(dir, 'provider.jsonl')) && fs.readFileSync(path.join(dir, 'provider.jsonl'), 'utf8').includes('stall model'));
    await editor.connection.cancel({ sessionId });
    expect(await pending).toEqual({ stopReason: 'cancelled' });
    await editor.close();
  }, 45_000);

  it('applies a patch using the unsaved editor buffer', async () => {
    const dir = workspace();
    const editor = launch(dir);
    editor.allow('allow_once');
    await editor.initialize();
    const { sessionId } = await editor.connection.newSession({ cwd: dir, mcpServers: [] });
    expect(await editor.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'patch sample.txt' }] })).toEqual({ stopReason: 'end_turn' });
    expect(fs.readFileSync(path.join(dir, 'sample.txt'), 'utf8')).toBe('buffer-patched\n');
    expect(editor.writes).toHaveLength(1);
    await editor.close();
  }, 45_000);

  it.each([false, true])('isolates shared multi-edit diff approvals across session workspaces (editor IO=%s)', async (caps) => {
    const dir = workspace();
    fs.writeFileSync(path.join(dir, 'sample.txt'), 'buffer-original\n');
    const firstCwd = path.join(dir, 'A'); const secondCwd = path.join(dir, 'B');
    for (const cwd of [firstCwd, secondCwd]) {
      fs.mkdirSync(cwd); fs.writeFileSync(path.join(cwd, 'sample.txt'), 'buffer-original\n');
    }
    const editor = launch(dir, caps);
    await editor.initialize();
    const first = await editor.connection.newSession({ cwd: firstCwd, mcpServers: [] });
    editor.allow('allow_always');
    await editor.connection.prompt({ sessionId: first.sessionId, prompt: [{ type: 'text', text: 'multi edit sample.txt' }] });
    expect(fs.readFileSync(path.join(firstCwd, 'sample.txt'), 'utf8')).toBe('buffer-multi-edited\n');
    const offset = editor.permissions.length;
    editor.resetBuffer(); editor.allow('allow_once'); editor.rejectDiff();
    const second = await editor.connection.newSession({ cwd: secondCwd, mcpServers: [] });
    await editor.connection.prompt({ sessionId: second.sessionId, prompt: [{ type: 'text', text: 'multi edit sample.txt' }] });
    const requests = editor.permissions.slice(offset);
    expect(requests.some((request) => request.toolCall.content?.some((item) => item.type === 'diff'))).toBe(true);
    expect(requests.every((request) => request.sessionId === second.sessionId)).toBe(true);
    expect(fs.readFileSync(path.join(secondCwd, 'sample.txt'), 'utf8')).toBe('buffer-original\n');
    expect(fs.readFileSync(path.join(dir, 'sample.txt'), 'utf8')).toBe('buffer-original\n');
    await editor.close();
  }, 60_000);

  it('keeps always grants local to the ACP session', async () => {
    const dir = workspace();
    const editor = launch(dir);
    await editor.initialize();
    const first = await editor.connection.newSession({ cwd: dir, mcpServers: [] });
    editor.allow('allow_always');
    await editor.connection.prompt({ sessionId: first.sessionId, prompt: [{ type: 'text', text: 'edit sample.txt' }] });
    const firstPermissions = editor.permissions.length;
    expect(editor.writes).toHaveLength(1);
    editor.resetBuffer();
    editor.allow('reject_once');
    await editor.connection.prompt({ sessionId: first.sessionId, prompt: [{ type: 'text', text: 'edit sample.txt' }] });
    expect(editor.permissions.length).toBe(firstPermissions);
    expect(editor.writes).toHaveLength(2);
    editor.resetBuffer();
    const second = await editor.connection.newSession({ cwd: dir, mcpServers: [] });
    await editor.connection.prompt({ sessionId: second.sessionId, prompt: [{ type: 'text', text: 'edit sample.txt' }] });
    expect(editor.permissions.length).toBeGreaterThan(firstPermissions);
    expect(editor.writes).toHaveLength(2);
    await editor.close();
  }, 60_000);

  it('passes editor stdio MCP servers through the same agent tool gates', async () => {
    const dir = workspace();
    const editor = launch(dir);
    editor.allow('allow_once');
    await editor.initialize();
    const { sessionId } = await editor.connection.newSession({ cwd: dir, mcpServers: [{ name: 'fixture', command: process.execPath, args: [path.join(root, 'tests/fixtures/acp/mcp-server.mjs')], env: [] }] });
    expect(await editor.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'mcp echo' }] })).toEqual({ stopReason: 'end_turn' });
    const completed = editor.updates.filter(({ update }) => update.sessionUpdate === 'tool_call_update' && update.status === 'completed');
    expect(JSON.stringify(completed)).toContain('mcp-reference-ok');
    expect(fs.readFileSync(path.join(dir, 'provider.jsonl'), 'utf8')).toContain('mcp__fixture__echo');
    await editor.close();
  }, 45_000);

  it('keeps restrictive permission modes effective with disk fallback', async () => {
    const dir = workspace();
    fs.writeFileSync(path.join(dir, 'sample.txt'), 'buffer-original\n');
    const editor = launch(dir, false, 'plan');
    editor.allow('allow_always');
    await editor.initialize();
    const { sessionId } = await editor.connection.newSession({ cwd: dir, mcpServers: [] });
    await editor.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'edit sample.txt' }] });
    expect(editor.reads).toHaveLength(0);
    expect(editor.writes).toHaveLength(0);
    expect(fs.readFileSync(path.join(dir, 'sample.txt'), 'utf8')).toBe('buffer-original\n');
    await editor.close();
  }, 45_000);
});
