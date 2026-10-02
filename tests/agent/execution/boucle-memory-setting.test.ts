import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { CodeBuddyAgent } from '../../../src/agent/codebuddy-agent.js';

it('the public memory switch controls the archival dependency, even though the legacy field stays true', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-switch-qa-'));
  vi.stubEnv('CODEBUDDY_DISABLE_MCP', 'true');
  vi.stubEnv('CODEBUDDY_HEADLESS', 'true');
  const agent = new CodeBuddyAgent('local-test', 'http://127.0.0.1:11434/v1', 'qwen3:4b-instruct', 1, false, undefined, cwd, undefined, 'base');
  try {
    await agent.systemPromptReady;
    await agent.getSkillsReady();
    const peek = agent as unknown as { executor: { deps: { memoryEnabled: () => boolean } }; memoryEnabled: boolean };
    agent.setMemoryEnabled(false);
    expect(agent.isMemoryEnabled()).toBe(false);
    expect(peek.memoryEnabled).toBe(true); // exercises the historical two-state trap
    expect(peek.executor.deps.memoryEnabled()).toBe(false);
    agent.setMemoryEnabled(true);
    expect(peek.executor.deps.memoryEnabled()).toBe(true);
  } finally {
    agent.dispose({ skipSessionLearning: true });
    vi.unstubAllEnvs();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

it('first-turn initialization and concurrent auto-observation retain pre_verify and the default middleware', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'preverify-first-turn-qa-'));
  vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true');
  vi.stubEnv('CODEBUDDY_DISABLE_MCP', 'true');
  vi.stubEnv('CODEBUDDY_HEADLESS', 'true');
  fs.mkdirSync(path.join(cwd, '.codebuddy'));
  fs.writeFileSync(path.join(cwd, 'verify.cjs'), "require('fs').writeFileSync('verified.txt','proof'); process.exit(1);");
  fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { pre_verify: [{ type: 'command', command: 'node verify.cjs' }] } }));
  const agent = new CodeBuddyAgent('local-test', 'http://127.0.0.1:11434/v1', 'qwen3:4b-instruct', 1, false, undefined, cwd, undefined, 'base');
  const peek = agent as unknown as { middlewareReady: Promise<void>; executor: import('../../../src/agent/execution/agent-executor.js').AgentExecutor };
  const deps = (peek.executor as unknown as { deps: import('../../../src/agent/execution/agent-executor.js').ExecutorDependencies }).deps;
  vi.spyOn(deps.client, 'chatStream').mockImplementation(async function* () {
    yield { choices: [{ index: 0, delta: { content: 'Task finished' }, finish_reason: 'stop' }] } as never;
  });
  try {
    // Invoke the executor immediately, before the constructor imports finish.
    const [entries] = await Promise.all([
      peek.executor.processUserMessage('finish', [], [{ role: 'user', content: 'finish' }]),
      agent.enableAutoObservation(),
    ]);
    await Promise.all([peek.middlewareReady, agent.systemPromptReady, agent.getSkillsReady()]);
    expect(fs.existsSync(path.join(cwd, 'verified.txt'))).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('Task finished');
    expect(JSON.stringify(entries)).toContain('pre_verify');
    expect(peek.executor.getMiddlewarePipeline()?.getMiddlewareNames()).toEqual(expect.arrayContaining(['pre_verify', 'auto-observation', 'workflow-guard', 'turn-limit', 'cost-limit']));
  } finally {
    agent.dispose({ skipSessionLearning: true });
    vi.unstubAllEnvs();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
