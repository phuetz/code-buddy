import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { budgetFinalPayload } from '../../src/context/final-payload-budget.js';
import { getRestorableCompressor, resetRestorableCompressor } from '../../src/context/restorable-compression.js';
import type { OpenAiChatPayload } from '../../src/codebuddy/providers/ollama-native-transport.js';

const roots: string[] = [];
afterEach(() => {
  resetRestorableCompressor();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('récupère uniquement le journal réduit de B, sans réinjecter toute la conversation', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-recovery-'));
  roots.push(workDir);
  const output = 'Audit header\n' + 'An audit diagnostic line.\n'.repeat(4000) + 'Audit footer';
  const payload: OpenAiChatPayload = {
    model: 'qwen3.8:27b', max_tokens: 512,
    messages: [
      { role: 'system', content: 'Follow the task, preserve the security guards.' },
      { role: 'user', content: 'Fix the audit and verify.' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'audit-read', type: 'function', function: { name: 'bash', arguments: '{"command":"cat audit.log"}' } }] },
      { role: 'tool', tool_call_id: 'audit-read', content: output },
    ],
  };
  const result = budgetFinalPayload(payload, 8192, { workDir, sessionId: 'banc' });
  const reduced = result.payload.messages.find(message => message.role === 'tool')?.content;
  expect(typeof reduced).toBe('string');
  const key = String(reduced).match(/identifier="([^"]+)"/)?.[1];
  expect(key).toBeTruthy();
  const restored = getRestorableCompressor().restore(key!, workDir, 'banc');
  expect(restored.found).toBe(true);
  expect(restored.content).toBe(output);
  expect(getRestorableCompressor().restore(key!, workDir, 'other').found).toBe(false);
  expect(payload.messages.at(-1)?.content).toBe(output);
});
