/** Real shared tools and security gates, two sessions, a third launch directory. */
import fs from 'node:fs';
import path from 'node:path';
import fsExtra from 'fs-extra';
import { execFileSync } from 'node:child_process';
import { ToolHandler } from '../../../src/agent/tool-handler.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAcpAgenticRunner, type AcpAgenticRunner } from '../../../src/protocols/acp/acp-agentic-runner.js';
import type { AgentModelClient } from '../../../src/agent/codebuddy-agent.js';
import type { AcpPromptContext } from '../../../src/protocols/acp/acp-stdio-server.js';
import { getPermissionModeManager } from '../../../src/security/permission-modes.js';
import { getTrustFolderManager } from '../../../src/security/trust-folders.js';

const originalCwd = process.cwd();
let root: string;
let a: string;
let b: string;
let launch: string;
let runner: AcpAgenticRunner;
let round = 0;
let args: Record<string, unknown>;
let toolName: string;
let rejectDiffForA: boolean;
let updates: Array<{ id: string; update: unknown }>;
let requests: Array<{ owner: string; sessionId: string; diff: boolean; path?: string }>;
let decisionA: 'allow_once' | 'allow_always';
let editorFiles: boolean;
const model: AgentModelClient = {
  getCurrentModel: () => 'fake-local', isEffectiveTargetLocal: () => true,
  probeToolSupport: async () => true,
  chatStream: async function* () {
    yield { choices: [{ index: 0, delta: round++ === 0 ? {
      tool_calls: [{ index: 0, id: 'edit', type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }],
    } : { content: 'done' }, finish_reason: round === 1 ? 'tool_calls' : 'stop' }] };
  },
};
function context(id: string, cwd: string, signal = new AbortController().signal): AcpPromptContext {
  return { sessionId: id, cwd, signal, prompt: [{ type: 'text', text: `edit boundary ${id}` }],
    clientCapabilities: editorFiles ? { fs: { readTextFile: true, writeTextFile: true } } : {},
    canRequestClient: (method) => method === 'session/request_permission' || editorFiles,
    saveConversation: vi.fn(), sendUpdate: (update) => { updates.push({ id, update }); }, mcpServers: [],
    requestClient: async (method, params = {}) => {
      if (method === 'fs/read_text_file') return { content: fs.readFileSync(String(params.path), 'utf8') };
      if (method === 'fs/write_text_file') {
        expect(String(params.path)).toBe(path.join(cwd, 'sample.txt'));
        fs.writeFileSync(String(params.path), String(params.content)); return {};
      }
      const toolCall = params.toolCall as { content?: unknown[] };
      const diff = JSON.stringify(toolCall.content).includes('Commit message:') || JSON.stringify(toolCall.content).includes('---') || toolCall.content?.some((item) => (item as { type: string }).type === 'diff') === true;
      requests.push({ owner: id, sessionId: String(params.sessionId), diff });
      return { outcome: { outcome: 'selected', optionId: id === 'A' && !rejectDiffForA ? decisionA : diff ? 'reject_once' : 'allow_once' } };
    },
  };
}
async function edit(id: string, cwd: string, relative = false) {
  round = 0; args = { file_path: relative ? 'sample.txt' : path.join(cwd, 'sample.txt'), edits: [{ old_string: 'before', new_string: 'after' }] };
  return runner(context(id, cwd));
}
beforeEach(() => {
  fs.mkdirSync(path.join(originalCwd, '_qa/acp/home'), { recursive: true });
  root = fs.mkdtempSync(path.join(originalCwd, '_qa/acp/home/boundary-'));
  [a, b, launch] = ['A', 'B', 'launch'].map((name) => path.join(root, name));
  for (const dir of [a, b, launch]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'sample.txt'), 'before'); }
  vi.stubEnv('HOME', root); vi.stubEnv('CODEBUDDY_DISABLE_MCP', 'true');
  getPermissionModeManager().setMode('default');
  expect(getTrustFolderManager().trustFolder(root)).toBe(true);
  process.chdir(launch);
  requests = []; updates = []; decisionA = 'allow_once'; editorFiles = false; toolName = 'multi_edit'; rejectDiffForA = false;
  runner = createAcpAgenticRunner({ apiKey: '', model: 'fake-local', modelClient: model, maxRounds: 3 });
});
afterEach(async () => {
  await runner?.dispose(); process.chdir(originalCwd); vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});
describe('ACP shared tool session boundaries', () => {
  it.each(['allow_once', 'allow_always'] as const)('keeps the diff approval in B after %s in A', async (decision) => {
    decisionA = decision;
    await edit('A', a);
    expect(fs.readFileSync(path.join(a, 'sample.txt'), 'utf8')).toBe('after');
    const offset = requests.length;
    await edit('B', b);
    const bRequests = requests.slice(offset);
    expect(bRequests.some((request) => request.diff)).toBe(true);
    expect(bRequests.every((request) => request.owner === 'B' && request.sessionId === 'B')).toBe(true);
    expect(fs.readFileSync(path.join(b, 'sample.txt'), 'utf8')).toBe('before');
  }, 45_000);
  it('reads internal Edit deny rules from B instead of the launch directory', async () => {
    decisionA = 'allow_always';
    await edit('A', a);
    fs.mkdirSync(path.join(b, '.codebuddy'), { recursive: true });
    fs.writeFileSync(path.join(b, '.codebuddy/settings.json'), JSON.stringify({ permissions: { deny: ['Edit(sample.txt)'] } }));
    const offset = requests.length;
    await edit('B', b, true);
    expect(requests.slice(offset).some((request) => request.owner === 'B')).toBe(true);
    expect(JSON.stringify(updates.filter((item) => item.id === 'B'))).toContain('Blocked by declarative permission rule');
    expect(fs.readFileSync(path.join(b, 'sample.txt'), 'utf8')).toBe('before');
  }, 45_000);
  it('revokes category grants when the same session changes workspace', async () => {
    decisionA = 'allow_always';
    await edit('A', a);
    rejectDiffForA = true;
    const offset = requests.length;
    await edit('A', b, true);
    expect(requests.slice(offset).some((request) => request.diff && request.sessionId === 'A')).toBe(true);
    expect(fs.readFileSync(path.join(b, 'sample.txt'), 'utf8')).toBe('before');
  }, 45_000);
  it('uses each session repository for shared git tools and keeps its commit approval local', async () => {
    vi.stubEnv('GIT_AUTHOR_NAME', 'ACP Test'); vi.stubEnv('GIT_AUTHOR_EMAIL', 'acp@example.invalid');
    vi.stubEnv('GIT_COMMITTER_NAME', 'ACP Test'); vi.stubEnv('GIT_COMMITTER_EMAIL', 'acp@example.invalid');
    for (const cwd of [a, b, launch]) {
      execFileSync('git', ['init', '-q', cwd]);
      execFileSync('git', ['-C', cwd, 'add', 'sample.txt']);
    }
    toolName = 'git'; decisionA = 'allow_always';
    round = 0; args = { operation: 'commit', args: { message: 'fixture A' } };
    await runner(context('A', a));
    expect(execFileSync('git', ['-C', a, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('fixture A');
    const offset = requests.length;
    round = 0; args = { operation: 'commit', args: { message: 'fixture B' } };
    await runner(context('B', b));
    expect(requests.slice(offset).some((request) => request.diff)).toBe(true);
    expect(requests.slice(offset).every((request) => request.owner === 'B' && request.sessionId === 'B')).toBe(true);
    for (const cwd of [b, launch]) expect(() => execFileSync('git', ['-C', cwd, 'rev-parse', '--verify', 'HEAD'], { stdio: 'pipe' })).toThrow();
  }, 45_000);
  it('drains a real disk writer at cancellation and prevents its delayed write', async () => {
    toolName = 'submit_plan'; round = 0; args = { plan_content: 'must not be saved after cancellation' };
    let release!: () => void;
    let started!: () => void;
    const reached = new Promise<void>((resolve) => { started = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const ensureDir = fsExtra.ensureDir;
    vi.spyOn(fsExtra, 'ensureDir').mockImplementation(async (target) => {
      await ensureDir(target);
      if (String(target).endsWith(path.join('.codebuddy', 'plans'))) { started(); await barrier; }
    });
    const execute = ToolHandler.prototype.executeTool;
    let toolDone: Promise<unknown> | undefined;
    vi.spyOn(ToolHandler.prototype, 'executeTool').mockImplementation(function (call, extra) {
      const pending = execute.call(this, call, extra);
      if (call.function.name === 'submit_plan') toolDone = pending;
      return pending;
    });
    const controller = new AbortController();
    let finished = false;
    const turn = runner(context('A', a, controller.signal)).then((result) => { finished = true; return result; });
    try {
      await reached;
      expect(requests.some((request) => request.sessionId === 'A')).toBe(true);
      controller.abort();
      // A detached cancelled turn needs more than one tick to finish cleanup.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 150);
        void turn.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
      });
      expect(finished).toBe(false);
      release();
      expect(await turn).toEqual({ stopReason: 'cancelled' });
      for (const cwd of [a, b, launch]) expect(fs.existsSync(path.join(cwd, '.codebuddy/plans/current.md'))).toBe(false);
    } finally {
      release(); await turn; await toolDone;
    }
  }, 45_000);
  it.each([false, true])('resolves a relative multi-edit inside its session (editor IO=%s)', async (caps) => {
    editorFiles = caps;
    await edit('A', a, true);
    expect(fs.readFileSync(path.join(a, 'sample.txt'), 'utf8')).toBe('after');
    expect(fs.readFileSync(path.join(b, 'sample.txt'), 'utf8')).toBe('before');
    expect(fs.readFileSync(path.join(launch, 'sample.txt'), 'utf8')).toBe('before');
    expect(requests.some((request) => request.diff && request.sessionId === 'A')).toBe(true);
  }, 45_000);
});
