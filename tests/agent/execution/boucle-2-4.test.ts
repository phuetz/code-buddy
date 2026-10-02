import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeps, createConfig } from './boucle-fixture.js';
import { AgentExecutor } from '../../../src/agent/execution/agent-executor.js';
import { ContextManagerV2 } from '../../../src/context/context-manager-v2.js';
import { createTokenCounter } from '../../../src/context/token-counter.js';
import { StreamingHandler } from '../../../src/agent/streaming/streaming-handler.js';
import { PersistentMemoryManager } from '../../../src/memory/persistent-memory.js';
import { MiddlewarePipeline } from '../../../src/agent/middleware/pipeline.js';
import { PreVerifyMiddleware } from '../../../src/agent/middleware/pre-verify.js';
import { resetUserHooksManager } from '../../../src/hooks/user-hooks.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

vi.mock('../../../src/utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); resetUserHooksManager(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boucle-qa-')); dirs.push(dir); return dir; }

function fixture(cwd: string) {
  const deps = createDeps({});
  deps.contextManager = new ContextManagerV2({ maxContextTokens: 1200, responseReserveTokens: 100,
    autoCompactThreshold: 400, recentMessagesCount: 2, enableEnhancedCompression: false, enableWarnings: false, workingDirectory: cwd });
  deps.tokenCounter = createTokenCounter('gpt-4');
  deps.streamingHandler = new StreamingHandler({ model: 'gpt-4' });
  deps.toolHandler.getWorkingDirectory = () => cwd;
  deps.memoryEnabled = () => true;
  const requests: CodeBuddyMessage[][] = [];
  vi.mocked(deps.client.chatStream).mockImplementation(async function* (messages) {
    requests.push(structuredClone(messages));
    yield { choices: [{ index: 0, delta: { content: 'Task finished' }, finish_reason: null }] } as never;
    yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 4, total_tokens: 84 } } as never;
  });
  const config = createConfig();
  return { deps, config, requests, executor: new AgentExecutor(deps, config), dispose() { deps.contextManager.dispose(); deps.tokenCounter.dispose(); deps.streamingHandler.dispose(); } };
}
function history(): CodeBuddyMessage[] { return [
  { role: 'system', content: 'base' },
  { role: 'user', content: 'Decision: use atomic saves' },
  ...Array.from({ length: 35 }, (_, i) => ({ role: 'assistant' as const, content: `Observation ${i}: ${'data '.repeat(36)}` })),
  { role: 'user', content: 'Finish durable storage' },
]; }

it('automatic compaction awaits exactly one bounded archival call; the fact survives on disk after a fresh memory load', async () => {
  vi.stubEnv('CODEBUDDY_COMPACTION_MEMORY_FLUSH', 'true');
  const cwd = directory();
  const f = fixture(cwd);
  const order: string[] = [];
  const prepare = f.deps.contextManager.prepareMessages.bind(f.deps.contextManager);
  vi.spyOn(f.deps.contextManager, 'prepareMessages').mockImplementation(m => { order.push('compact'); return prepare(m); });
  vi.mocked(f.deps.client.chat).mockImplementation(async (request, tools, opts) => {
    order.push('flush');
    expect(JSON.stringify(request)).toContain('use atomic saves');
    expect(tools).toEqual([]);
    expect(opts?.maxTokens).toBe(256);
    expect(f.deps.tokenCounter.countMessageTokens(request.map(m => ({ role: m.role, content: m.content ?? null })))).toBeLessThanOrEqual(2048);
    return { choices: [{ message: { role: 'assistant', content: '[{"kind":"decision","value":"Use atomic saves"}]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 14, total_tokens: 914 } } as never;
  });
  try {
    await f.executor.processUserMessage('Finish durable storage', [], history());
    expect(order).toEqual(['flush', 'compact']);
    expect(f.deps.client.chat).toHaveBeenCalledTimes(1);
    expect(f.requests[0]!.length).toBeLessThan(history().length);
    const fresh = new PersistentMemoryManager({ projectMemoryPath: path.join(cwd, '.codebuddy', 'CODEBUDDY_MEMORY.md'), userMemoryPath: path.join(cwd, 'user-memory.md') });
    await fresh.initialize();
    expect(fresh.getContextForPrompt()).toContain('Use atomic saves');
    expect(f.config.recordSessionCost).toHaveBeenCalledTimes(2);
    expect(f.config.recordSessionCost).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), { promptTokens: 80, completionTokens: 4 });
    expect(f.config.recordSessionCost).toHaveBeenCalledWith(900, 14, { promptTokens: 900, completionTokens: 14 });
  } finally { f.dispose(); }
});

for (const mode of ['default', 'memory-disabled', 'below-threshold', 'plugin-owned', 'slimming-enough'] as const) {
  it(`does not call the archival model for ${mode}`, async () => {
    if (mode !== 'default') vi.stubEnv('CODEBUDDY_COMPACTION_MEMORY_FLUSH', 'true');
    const f = fixture(directory());
    let messages = history();
    if (mode === 'memory-disabled') f.deps.memoryEnabled = () => false;
    if (mode === 'below-threshold') messages = messages.slice(-1);
    if (mode === 'plugin-owned') {
      vi.spyOn(f.deps.contextManager, 'getContextEngine').mockReturnValue({ ownsCompaction: true } as never);
      vi.spyOn(f.deps.contextManager, 'prepareMessages').mockImplementation(m => m);
    }
    if (mode === 'slimming-enough') messages = [
      { role: 'assistant', content: null, tool_calls: [{ id: 't', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', content: 'noise '.repeat(800), tool_call_id: 't' },
      { role: 'user', content: 'finish' },
    ];
    try { await f.executor.processUserMessage('finish', [], messages); expect(f.deps.client.chat).not.toHaveBeenCalled(); }
    finally { f.dispose(); }
  });
}

describe('pre_verify finalization in the real executor loop', () => {
  for (const code of [0, 1, 2]) {
    it(`awaits a real workspace verification command (exit ${code}) before streaming or persisting the final draft`, async () => {
      vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true');
      const cwd = directory();
      fs.mkdirSync(path.join(cwd, '.codebuddy'));
      fs.writeFileSync(path.join(cwd, 'verify.cjs'), `require('fs').writeFileSync('verified.txt', 'proof'); process.exit(${code});`);
      fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { pre_verify: [{ type: 'command', command: 'node verify.cjs' }] } }));
      const f = fixture(cwd);
      f.deps.middlewarePipeline = new MiddlewarePipeline().use(new PreVerifyMiddleware(cwd));
      const executor = new AgentExecutor(f.deps, f.config);
      const entries: import('../../../src/agent/types.js').ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'finish' }];
      const output: string[] = [];
      try {
        for await (const chunk of executor.processUserMessageStream('finish', entries, messages, null)) {
          if (chunk.type === 'content' && chunk.content) {
            if (chunk.content.includes('Task finished')) expect(fs.readFileSync(path.join(cwd, 'verified.txt'), 'utf8')).toBe('proof');
            output.push(chunk.content);
          }
        }
        expect(fs.existsSync(path.join(cwd, 'verified.txt'))).toBe(true);
        if (code === 0) expect(output.join('')).toContain('Task finished');
        else {
          expect(output.join('')).not.toContain('Task finished');
          expect(output.join('')).toContain('pre_verify');
          expect(JSON.stringify(entries)).not.toContain('Task finished');
          expect(JSON.stringify(messages)).not.toContain('Task finished');
        }
        expect(f.config.recordSessionCost).toHaveBeenCalledTimes(1);
      } finally { f.dispose(); }
    });
  }
});

// Adverse review regressions: publication is a commit boundary, including length recovery.
for (const continuations of [0, 1, 3]) {
  for (const code of [0, 1]) {
    it(`verifies a terminal length response after ${continuations} continuations, exit ${code}`, async () => {
      vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true');
      vi.stubEnv('CODEBUDDY_MAX_LENGTH_CONTINUATIONS', String(continuations));
      const cwd = directory();
      fs.mkdirSync(path.join(cwd, '.codebuddy'));
      fs.writeFileSync(path.join(cwd, 'verify.cjs'), `const fs=require('fs'); let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{fs.appendFileSync('verified.txt',input+'\\n'); process.exit(${code});});`);
      fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { pre_verify: [{ type: 'command', command: 'node verify.cjs' }] } }));
      const f = fixture(cwd);
      f.deps.middlewarePipeline = new MiddlewarePipeline().use(new PreVerifyMiddleware(cwd));
      let round = 0;
      const entries: import('../../../src/agent/types.js').ChatEntry[] = [];
      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'finish' }];
      vi.mocked(f.deps.client.chatStream).mockImplementation(async function* () {
        expect(JSON.stringify(entries)).not.toContain('Task finished');
        expect(JSON.stringify(messages)).not.toContain('Task finished');
        yield { choices: [{ index: 0, delta: { content: `Task finished part ${++round}` }, finish_reason: null }] } as never;
        yield { choices: [{ index: 0, delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 80, completion_tokens: 4, total_tokens: 84 } } as never;
      });

      const output: string[] = [];
      try {
        for await (const chunk of new AgentExecutor(f.deps, f.config).processUserMessageStream('finish', entries, messages, null)) {
          if (chunk.type === 'content' && chunk.content) {
            if (chunk.content.includes('Task finished')) expect(fs.existsSync(path.join(cwd, 'verified.txt'))).toBe(true);
            output.push(chunk.content);
          }
        }
        const proof = fs.readFileSync(path.join(cwd, 'verified.txt'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(proof).toHaveLength(1);
        expect(proof[0].candidate).toContain('Task finished part 1');
        expect(proof[0].candidate).toContain(`Task finished part ${continuations + 1}`);
        expect(round).toBe(continuations + 1);
        if (code === 0) {
          expect(output.join('')).toContain('Task finished part 1');
          expect(entries.at(-1)?.truncated).toBe(true);
        } else {
          expect(output.join('')).not.toContain('Task finished');
          expect(output.join('')).toContain('pre_verify');
          expect(JSON.stringify(entries)).not.toContain('Task finished');
          expect(JSON.stringify(messages)).not.toContain('Task finished');
        }
        expect(f.config.recordSessionCost).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), { promptTokens: 80 * round, completionTokens: 4 * round });
      } finally { f.dispose(); }
    });
  }
}

for (const setup of ['missing', 'empty', 'unrelated'] as const) {
  it(`installs required pre_verify before the first request with a ${setup} pipeline`, async () => {
    vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true');
    const cwd = directory();
    fs.mkdirSync(path.join(cwd, '.codebuddy'));
    fs.writeFileSync(path.join(cwd, 'verify.cjs'), "require('fs').writeFileSync('verified.txt','proof'); process.exit(1);");
    fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { pre_verify: [{ type: 'command', command: 'node verify.cjs' }] } }));
    const f = fixture(cwd);
    f.deps.middlewarePipeline = setup === 'missing' ? undefined : new MiddlewarePipeline();
    if (setup === 'unrelated') f.deps.middlewarePipeline!.use({ name: 'other', beforeComplete: () => ({ action: 'continue' }) });
    try {
      const entries = await new AgentExecutor(f.deps, f.config).processUserMessage('finish', [], [{ role: 'user', content: 'finish' }]);
      expect(fs.existsSync(path.join(cwd, 'verified.txt'))).toBe(true);
      expect(JSON.stringify(entries)).toContain('pre_verify');
      expect(JSON.stringify(entries)).not.toContain('Task finished');
    } finally { f.dispose(); }
  });
}

for (const steeringExit of [0, 1]) {
  it(`keeps an interrupted steering draft private, final verification exit ${steeringExit}`, async () => {
    vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true');
    const cwd = directory();
    fs.mkdirSync(path.join(cwd, '.codebuddy'));
    fs.writeFileSync(path.join(cwd, 'verify.cjs'), `require('fs').writeFileSync('verified.txt','proof'); process.exit(${steeringExit});`);
    fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { pre_verify: [{ type: 'command', command: 'node verify.cjs' }] } }));
    const f = fixture(cwd);
    f.deps.middlewarePipeline = new MiddlewarePipeline().use(new PreVerifyMiddleware(cwd));
    let round = 0;
    vi.mocked(f.deps.client.chatStream).mockImplementation(async function* () {
      yield { choices: [{ index: 0, delta: { content: round++ === 0 ? 'Stale Task finished' : 'Fresh Task finished' }, finish_reason: 'stop' }] } as never;
    });
    let pending = true;
    f.deps.messageQueue = {
      hasPendingMessages: () => false,
      hasSteeringMessage: () => pending,
      consumeSteeringMessage: () => { pending = false; return { content: 'Use the revised goal', source: 'test', timestamp: new Date() }; },
    } as never;
    const entries: import('../../../src/agent/types.js').ChatEntry[] = [];
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'finish' }];
    const output: string[] = [];
    try {
      for await (const chunk of new AgentExecutor(f.deps, f.config).processUserMessageStream('finish', entries, messages, null)) {
        if (chunk.type === 'content') output.push(chunk.content ?? '');
      }
      expect(fs.existsSync(path.join(cwd, 'verified.txt'))).toBe(true);
      expect(output.join('')).not.toContain('Stale Task finished');
      expect(JSON.stringify(entries)).not.toContain('Stale Task finished');
      expect(JSON.stringify(messages)).not.toContain('Stale Task finished');
      if (steeringExit === 0) expect(output.join('')).toContain('Fresh Task finished');
      else expect(output.join('')).not.toContain('Fresh Task finished');
      expect(JSON.stringify(entries)).toContain('Use the revised goal');
    } finally { f.dispose(); }
  });
}

it('bounds archival to one attempt per agent turn even when compaction stays above threshold', async () => {
  vi.stubEnv('CODEBUDDY_COMPACTION_MEMORY_FLUSH', 'true');
  vi.stubEnv('CODEBUDDY_MAX_LENGTH_CONTINUATIONS', '1');
  const f = fixture(directory());
  vi.spyOn(f.deps.contextManager, 'prepareMessages').mockImplementation(m => m);
  vi.mocked(f.deps.client.chat).mockResolvedValue({ choices: [{ message: { content: '[]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 300, completion_tokens: 2 } } as never);
  vi.mocked(f.deps.client.chatStream).mockImplementation(async function* () {
    yield { choices: [{ index: 0, delta: { content: 'Partial answer' }, finish_reason: 'length' }] } as never;
  });
  try {
    await f.executor.processUserMessage('finish', [], history());
    expect(f.deps.client.chatStream).toHaveBeenCalledTimes(2);
    expect(f.deps.client.chat).toHaveBeenCalledTimes(1);
    expect(f.config.recordSessionCost).toHaveBeenCalledWith(300, 2, { promptTokens: 300, completionTokens: 2 });
  } finally { f.dispose(); }
});

for (const ending of ['stop', 'empty-length'] as const) {
  it(`keeps recovery drafts private across compaction and verifies the ${ending} terminal path`, async () => {
    vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true');
    vi.stubEnv('CODEBUDDY_MAX_LENGTH_CONTINUATIONS', '1');
    const cwd = directory();
    fs.mkdirSync(path.join(cwd, '.codebuddy'));
    fs.writeFileSync(path.join(cwd, 'verify.cjs'), "require('fs').writeFileSync('verified.txt','proof'); process.exit(1);");
    fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { pre_verify: [{ type: 'command', command: 'node verify.cjs' }] } }));
    const f = fixture(cwd);
    f.deps.middlewarePipeline = new MiddlewarePipeline().use(new PreVerifyMiddleware(cwd));
    const prepare = vi.spyOn(f.deps.contextManager, 'prepareMessages');
    const entries: import('../../../src/agent/types.js').ChatEntry[] = [];
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'finish' }];
    let round = 0;
    vi.mocked(f.deps.client.chatStream).mockImplementation(async function* () {
      expect(JSON.stringify(entries)).not.toContain('Task finished');
      expect(JSON.stringify(messages)).not.toContain('Task finished');
      const first = round++ === 0;
      yield { choices: [{ index: 0, delta: { content: first ? 'Task finished '+ 'draft '.repeat(1600) : ending === 'stop' ? 'Final answer' : '' },
        finish_reason: first || ending === 'empty-length' ? 'length' : 'stop' }] } as never;
    });
    const output: string[] = [];
    try {
      for await (const chunk of new AgentExecutor(f.deps, f.config).processUserMessageStream('finish', entries, messages, null)) {
        if (chunk.type === 'content') output.push(chunk.content ?? '');
      }
      expect(prepare).toHaveBeenCalled();
      expect(fs.existsSync(path.join(cwd, 'verified.txt'))).toBe(true);
      expect(output.join('')).toContain('pre_verify');
      expect(output.join('')).not.toContain('Task finished');
      expect(output.join('')).not.toContain('Final answer');
      expect(JSON.stringify(messages)).not.toContain('Task finished');
      expect(JSON.stringify(entries)).not.toContain('Task finished');
      expect(round).toBe(2);
    } finally { f.dispose(); }
  });
}

it('includes private continuation input in cost estimates when the provider omits usage', async () => {
  vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true');
  const cwd = directory();
  fs.mkdirSync(path.join(cwd, '.codebuddy'));
  fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { pre_verify: [{ type: 'command', command: 'exit 0' }] } }));
  const f = fixture(cwd);
  let round = 0;
  vi.mocked(f.deps.client.chatStream).mockImplementation(async function* () {
    const first = round++ === 0;
    yield { choices: [{ index: 0, delta: { content: first ? 'Draft '.repeat(200) : 'Final answer' }, finish_reason: first ? 'length' : 'stop' }] } as never;
  });
  try {
    await new AgentExecutor(f.deps, f.config).processUserMessage('finish', [], [{ role: 'user', content: 'finish' }]);
    expect(f.config.recordSessionCost).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.config.recordSessionCost).mock.calls[0]![0]).toBeGreaterThan(200);
  } finally { f.dispose(); }
});
