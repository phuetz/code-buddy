/**
 * End-to-end through the REAL loop (2026-10-04): AgentExecutor.runTurnLoop ->
 * executeToolForBatch -> ToolHandler.executeToolStreaming -> executeStreamingBash
 * -> real bash -> after-hooks -> optimizeToolObservation -> real lm-resizer.
 * Only the LLM provider is scripted. Skipped without the lm-resizer binary.
 */
import { execFile } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentExecutor, type ExecutorConfig, type ExecutorDependencies } from '../../../src/agent/execution/agent-executor.js';
import { ToolHandler } from '../../../src/agent/tool-handler.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import { resetLmResizerCircuitBreakers, resolveLmResizerBin } from '../../../src/context/lm-resizer-compressor.js';
import { getRestorableCompressor, resetRestorableCompressor } from '../../../src/context/restorable-compression.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../../src/security/permission-modes.js';
import { ConfirmationService } from '../../../src/utils/confirmation-service.js';
import { resetToolFilter } from '../../../src/utils/tool-filter.js';

const run = promisify(execFile);
const bin = resolveLmResizerBin();
const hasBin = bin.includes('/') && existsSync(bin);
const MARKER = 'marqueur-9f3a src/db/pool.ts:412';

function lines(markerLine: string, count = 20_000): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i === count / 2
      ? markerLine
      : `2026-10-04T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z INFO worker-${i % 8} requete ok duree=${10 + (i * 7) % 90}ms`);
  }
  return `${out.join('\n')}\n`;
}

function bashCall(id: string, command: string) {
  return { id, type: 'function' as const, function: { name: 'bash', arguments: JSON.stringify({ command, timeout: 60_000 }) } };
}

function createDeps(toolHandler: ToolHandler, workspace: string): ExecutorDependencies {
  void workspace;
  return {
    client: {
      chat: vi.fn(), chatStream: vi.fn(),
      getCurrentModel: vi.fn().mockReturnValue('fixture-model'),
      getProviderName: vi.fn().mockReturnValue('fixture'),
    } as never,
    toolHandler: toolHandler as never,
    toolSelectionStrategy: {
      selectToolsForQuery: vi.fn().mockResolvedValue({ tools: [], selection: null, fromCache: false, query: '', timestamp: new Date() }),
      cacheTools: vi.fn(), shouldUseSearchFor: vi.fn().mockReturnValue(false), clearCache: vi.fn(),
      setActiveSkill: vi.fn(), expandCachedTools: vi.fn().mockResolvedValue(0),
    } as never,
    streamingHandler: {
      reset: vi.fn(),
      accumulateChunk: vi.fn().mockReturnValue({ displayContent: '', rawContent: '', hasNewToolCalls: false, shouldEmitTokenCount: false }),
      extractToolCalls: vi.fn().mockReturnValue({ toolCalls: [], remainingContent: '' }),
      getAccumulatedMessage: vi.fn(), getTokenCount: vi.fn().mockReturnValue(10), hasYieldedToolCalls: vi.fn().mockReturnValue(false),
    } as never,
    contextManager: {
      prepareMessages: vi.fn().mockImplementation((m: unknown[]) => m),
      prepareMessagesRaw: vi.fn().mockImplementation((m: unknown[]) => m),
      getContextEngine: vi.fn().mockReturnValue(null),
      shouldWarn: vi.fn().mockReturnValue({ warn: false }),
      shouldAutoCompact: vi.fn().mockReturnValue(false),
      getStats: vi.fn().mockReturnValue({ isNearLimit: false, totalTokens: 100, maxTokens: 128_000 }),
    } as never,
    tokenCounter: {
      countTokens: vi.fn().mockImplementation((t: string) => Math.ceil(String(t).length / 4)),
      countMessageTokens: vi.fn().mockReturnValue(100),
      dispose: vi.fn(),
    } as never,
  };
}

function createConfig(): ExecutorConfig {
  return {
    maxToolRounds: 4,
    isGrokModel: vi.fn().mockReturnValue(false),
    recordSessionCost: vi.fn(),
    isSessionCostLimitReached: vi.fn().mockReturnValue(false),
    estimateSessionCostLimitReached: vi.fn().mockReturnValue(false),
    getSessionCost: vi.fn().mockReturnValue(0),
    getSessionCostLimit: vi.fn().mockReturnValue(10),
  };
}

/** Round 1 asks for `call`; round 2 answers. Returns the requests the model saw. */
function scriptProvider(deps: ExecutorDependencies, call: ReturnType<typeof bashCall>) {
  const requests: CodeBuddyMessage[][] = [];
  let round = 0;
  const stream = deps.client.chatStream as unknown as ReturnType<typeof vi.fn>;
  const acc = deps.streamingHandler.getAccumulatedMessage as unknown as ReturnType<typeof vi.fn>;
  stream.mockImplementation(async function* (messages: CodeBuddyMessage[]) {
    round += 1;
    requests.push(structuredClone(messages));
    yield { choices: [{ delta: { content: round === 1 ? '' : 'Termine.' } }] };
  });
  acc.mockImplementation(() => (round === 1
    ? { content: '', tool_calls: [call] }
    : { content: 'Termine.', tool_calls: undefined }));
  return requests;
}

describe.skipIf(!hasBin || process.platform === 'win32')('real loop: streaming bash -> lm-resizer', () => {
  const saved = { ...process.env };
  const dirs: string[] = [];
  let workspace: string;
  let cwdBefore: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'lmr-loop-'));
    dirs.push(workspace);
    cwdBefore = process.cwd();
    process.chdir(workspace);
    resetToolFilter();
    resetPermissionModeManager();
    getPermissionModeManager().setMode('bypassPermissions');
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    resetRestorableCompressor();
    resetLmResizerCircuitBreakers();
    // The client refuses implicit IO under NODE_ENV=test; this test wants the real transport.
    process.env.NODE_ENV = 'development';
    process.env.CODEBUDDY_LM_RESIZER = 'true';
    process.env.CODEBUDDY_LM_RESIZER_BIN = bin;
    process.env.CODEBUDDY_LM_RESIZER_URL = 'http://127.0.0.1:1';
    process.env.CODEBUDDY_LM_RESIZER_STORE = join(workspace, 'ccr.db');
  });
  afterEach(() => {
    process.chdir(cwdBefore);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

  async function playTurn(command: string, id: string): Promise<{ toolMessage: string; requests: CodeBuddyMessage[][]; sessionId: string | undefined }> {
    const handler = new ToolHandler({
      checkpointManager: { checkpointBeforeCreate: vi.fn(), checkpointBeforeEdit: vi.fn() } as never,
      hooksManager: { executeHooks: vi.fn().mockResolvedValue([]) } as never,
      marketplace: { executeTool: vi.fn() } as never,
      repairCoordinator: { isRepairEnabled: vi.fn(() => false) } as never,
    });
    const deps = createDeps(handler, workspace);
    const requests = scriptProvider(deps, bashCall(id, command));
    const executor = new AgentExecutor(deps, createConfig());
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'lis le journal' }];
    for await (const chunk of executor.processUserMessageStream('lis le journal', [], messages, null)) { if (process.env.DBG_LOOP && (chunk as {type:string}).type === 'tool_result') console.log('META', JSON.stringify((chunk as {toolResult?: {metadata?: unknown}}).toolResult?.metadata)); }
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const tool = requests[1]!.filter((m) => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === id);
    expect(tool).toHaveLength(1);
    if (process.env.DBG_LOOP) console.log('TOOLMSG', String(tool[0]!.content).length, JSON.stringify(String(tool[0]!.content).slice(0, 200)), '...', JSON.stringify(String(tool[0]!.content).slice(-700)));
    return { toolMessage: String(tool[0]!.content), requests, sessionId: handler.getRecoverySessionId?.() };
  }

  function writeScript(name: string, body: string, exit = 0): string {
    const data = join(workspace, `${name}.data`);
    writeFileSync(data, body);
    const script = join(workspace, name);
    writeFileSync(script, `#!/bin/bash\ncat '${data}'\nexit ${exit}\n`);
    chmodSync(script, 0o755);
    return script;
  }

  it('success: a 1.1 MB log with ERROR in the middle -> the model sees the marker, the original is recoverable', async () => {
    // An ANSI colour code: the after-hook strips it, the native copy must keep it.
    const log = lines(`\u001b[31mERROR\u001b[0m: ${MARKER}`);
    const script = writeScript('journalctl', log);
    const { toolMessage, sessionId } = await playTurn(`${script} -u svc`, 'call_ok');
    expect(toolMessage).toContain(MARKER);
    expect(toolMessage.length).toBeLessThan(2_000);
    const hash = /lm-resizer CCR ([0-9a-f]+)/.exec(toolMessage)?.[1];
    expect(hash).toBeTruthy();
    const back = await run(bin, ['retrieve', '--store', join(workspace, 'ccr.db'), hash!], { maxBuffer: 64 * 1024 * 1024 });
    expect(back.stdout.trimEnd()).toBe(log.trimEnd());
    // The native copy was persisted by the streaming path itself.
    const restored = getRestorableCompressor().restore('call_ok', workspace, sessionId);
    expect(restored.found).toBe(true);
    expect(restored.found && restored.content).toContain(MARKER);
    // Native, not bounded to head+tail, not sanitized: byte-for-byte what bash printed.
    expect(restored.found && restored.content.trimEnd()).toContain(log.trimEnd());
    expect(restored.found && restored.content).toContain('\u001b[31m');
  }, 90_000);

  it('failure: a failing `make`-like command whose cause is "echec: ..." -> the model sees the failure AND the cause', async () => {
    const log = lines('echec: connexion refusee (src/db/pool.ts:412)', 8_000);
    const script = writeScript('make', log, 2);
    const { toolMessage, sessionId } = await playTurn(`${script} test`, 'call_fail');
    expect(toolMessage).toMatch(/\[command failed: exit [1-9]/);
    expect(toolMessage).toContain('echec: connexion refusee (src/db/pool.ts:412)');
    expect(toolMessage).not.toMatch(/^Output of bash:\n---\nmake: completed\n/);
    const restored = getRestorableCompressor().restore('call_fail', workspace, sessionId);
    expect(restored.found).toBe(true);
  }, 90_000);

  it('failure through `./make test`: lm-resizer\'s own diagnostic guard keeps the text, the fallback cap still shows the cause', async () => {
    const log = lines('echec: connexion refusee (src/db/pool.ts:412)', 8_000);
    writeScript('make', log, 2);
    const { toolMessage, sessionId } = await playTurn('./make test', 'call_fail_reduced');
    expect(toolMessage).toMatch(/\[command failed: exit [1-9]/);
    expect(toolMessage).toContain('echec: connexion refusee (src/db/pool.ts:412)');
    expect(toolMessage).toContain('restore_context({"identifier":"call_fail_reduced"})');
    expect(getRestorableCompressor().restore('call_fail_reduced', workspace, sessionId).found).toBe(true);
  }, 90_000);
});
