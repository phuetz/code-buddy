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
