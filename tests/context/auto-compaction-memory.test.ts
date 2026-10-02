import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushAutoCompactionMemory } from '../../src/context/auto-compaction-memory.js';
import { createTokenCounter } from '../../src/context/token-counter.js';
import { resetMemoryManagerForTests } from '../../src/memory/persistent-memory.js';
import { resetUserHooksManager } from '../../src/hooks/user-hooks.js';

let cwd: string;
const counter = createTokenCounter('gpt-4');
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archival-qa-')); vi.stubEnv('CODEBUDDY_COMPACTION_MEMORY_FLUSH', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); resetMemoryManagerForTests(); resetUserHooksManager(); fs.rmSync(cwd, { recursive: true, force: true }); });
function args(answer = '[]', reason = 'stop') {
  const chat = vi.fn().mockResolvedValue({ choices: [{ message: { content: answer }, finish_reason: reason }] });
  return { messages: [{ role: 'user' as const, content: 'Preference: use plain text. '.repeat(1200) }],
    memoryEnabled: true, cwd, counter, client: { chat }, recordUsage: vi.fn() };
}

it('bounds the complete auxiliary input and records estimates when provider usage is absent', async () => {
  const options = args();
  await flushAutoCompactionMemory(options);
  const request = options.client.chat.mock.calls[0]!;
  expect(counter.countMessageTokens(request[0])).toBeLessThanOrEqual(2048);
  expect(request[2]).toMatchObject({ maxTokens: 256, tool_choice: 'none', disableProviderFallback: true });
  expect(options.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ estimated: true }));
});

for (const response of ['not json', '[{"kind":"decision","value":"use tests"}]']) {
  it(`does not store ${response.startsWith('not') ? 'malformed' : 'truncated'} output`, async () => {
    await flushAutoCompactionMemory(args(response, response.startsWith('not') ? 'stop' : 'length'));
    expect(fs.existsSync(path.join(cwd, '.codebuddy', 'CODEBUDDY_MEMORY.md'))).toBe(false);
  });
}

it('does not fall back to another provider or leave a write pending on failure', async () => {
  const options = args(); options.client.chat.mockRejectedValue(new Error('network unavailable'));
  await flushAutoCompactionMemory(options);
  expect(options.client.chat).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(path.join(cwd, '.codebuddy', 'CODEBUDDY_MEMORY.md'))).toBe(false);
});

it('honours the existing BeforeMemoryWrite hook', async () => {
  fs.mkdirSync(path.join(cwd, '.codebuddy'));
  fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { BeforeMemoryWrite: [{ type: 'command', command: 'exit 2' }] } }));
  await flushAutoCompactionMemory(args('[{"kind":"fact","value":"The store uses atomic saves"}]'));
  expect(fs.readFileSync(path.join(cwd, '.codebuddy', 'CODEBUDDY_MEMORY.md'), 'utf8')).not.toContain('The store uses atomic saves');
});
