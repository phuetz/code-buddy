import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { prepareTurnMessages } from '../../src/agent/execution/context-pipeline.js';
import { budgetFinalPayload } from '../../src/context/final-payload-budget.js';

it.each([false, true])('garde la lecture fraîche après préparation et budget final (compression améliorée=%s)', enableEnhancedCompression => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-observation-'));
  vi.stubEnv('CODEBUDDY_HOME', path.join(root, 'profile'));
  const manager = new ContextManagerV2({
    model: 'qwen3.8:27b', maxContextTokens: 8192, responseReserveTokens: 1024,
    autoCompactThreshold: 6000, recentMessagesCount: 4, enableEnhancedCompression,
    workingDirectory: root,
  });
  try {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'Respect the operator capabilities. '.repeat(50) },
      { role: 'user', content: 'Replace the checksum with signature verification and test the result.' },
    ];
    for (let index = 0; index < 10; index++) {
      messages.push({ role: 'assistant', content: null, ollama_thinking: 'Older analysis. '.repeat(600), tool_calls: [{ id: `old-${index}`, type: 'function', function: { name: 'bash', arguments: '{"command":"read old output"}' } }] });
      messages.push({ role: 'tool', tool_call_id: `old-${index}`, content: 'Old diagnostic. '.repeat(100) });
    }
    const source = 'export class LicenseGate { /* fresh source needed for the edit */ }\n'.repeat(20);
    messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'fresh', type: 'function', function: { name: 'bash', arguments: '{"command":"read source"}' } }] });
    messages.push({ role: 'tool', tool_call_id: 'fresh', content: source });
    const prepared = prepareTurnMessages(manager, messages);
    const final = budgetFinalPayload({ model: 'qwen3.8:27b', messages: prepared, max_tokens: 1024 }, 8192, { workDir: root, sessionId: 'banc' });
    expect(final.payload.messages.find(message => message.tool_call_id === 'fresh')?.content).toBe(source);
    expect(final.inputTokens + final.outputTokens + final.safetyTokens).toBeLessThanOrEqual(8192);
  } finally {
    manager.dispose(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true });
  }
});
