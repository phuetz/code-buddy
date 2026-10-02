import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import { prepareTurnMessages } from '../../src/agent/execution/context-pipeline.js';
import { getRestorableCompressor, resetRestorableCompressor } from '../../src/context/restorable-compression.js';
import { budgetFinalPayload } from '../../src/context/final-payload-budget.js';

afterEach(() => resetRestorableCompressor());

it.each([false, true])('restaure une ancienne observation réduite sans exposer une autre session (gestionnaire réel=%s)', realManager => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'old-observation-'));
  vi.stubEnv('CODEBUDDY_HOME', path.join(root, 'profile'));
  const old = 'Earlier source needed for the repair.\n'.repeat(300);
  const messages: CodeBuddyMessage[] = [
    { role: 'user', content: 'Repair the implementation and test it.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'view_file', arguments: '{"path":"src/old.ts"}' } }] },
    { role: 'tool', tool_call_id: 'old', content: old },
    { role: 'assistant', content: null, tool_calls: [{ id: 'latest', type: 'function', function: { name: 'view_file', arguments: '{"path":"src/new.ts"}' } }] },
    { role: 'tool', tool_call_id: 'latest', content: 'Fresh source.' },
  ];
  const manager = realManager ? new ContextManagerV2({
    model: 'qwen3.8:27b', maxContextTokens: 8192, responseReserveTokens: 1024,
    autoCompactThreshold: 1000, workingDirectory: root,
  }) : {
    shouldAutoCompact: (input: CodeBuddyMessage[]) => input.some(m => m.content === old),
    getStats: () => ({ isNearLimit: false }),
    getContextEngine: () => null,
  } as unknown as ContextManagerV2;
  const scope = { workDir: root, sessionId: 'mission-a' };
  try {
    const prepared = prepareTurnMessages(manager, messages, { recoveryScope: scope });
    const reduced = prepared.find(m => m.role === 'tool' && m.tool_call_id === 'old');
    const key = String(reduced?.content).match(/identifier="([^"]+)"/)?.[1];
    expect(key).toBeTruthy();
    const store = getRestorableCompressor();
    expect(store.restore(key!, scope.workDir, scope.sessionId).content).toBe(old);
    expect(store.restore(key!, scope.workDir, 'other-session').found).toBe(false);
    expect(store.restore(key!, '/tmp/other-workspace', scope.sessionId).found).toBe(false);
    expect(prepared.at(-1)?.content).toBe('Fresh source.');
    expect(messages[2]?.content).toBe(old);
    const final = budgetFinalPayload({ model: 'qwen3.8:27b', messages: prepared, max_tokens: 1024 }, 8192, scope);
    expect(final.payload.messages.find(m => m.tool_call_id === 'old')?.content).toBe(reduced?.content);
    expect(final.inputTokens + final.outputTokens + final.safetyTokens).toBeLessThanOrEqual(8192);
  } finally {
    if (realManager) manager.dispose();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
