import { afterEach, expect, it, vi } from 'vitest';
import type { CodeBuddyClient } from '../../src/codebuddy/client.js';
const runner = vi.hoisted(() => ({ runAll: vi.fn().mockResolvedValue({}), create: vi.fn() }));
vi.mock('../../src/testing/ai-integration-tests.js', () => ({
  createAITestRunner: runner.create.mockReturnValue(runner),
  AITestRunner: { formatResults: () => 'Local suite complete' },
}));
import { handleAITest } from '../../src/commands/handlers/test-handlers.js';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('uses the active local client without a Grok key and leaves terminal rendering to Ink', async () => {
  vi.stubEnv('GROK_API_KEY', '');
  const client = { getBaseURL: () => 'http://127.0.0.1:11434/v1' } as CodeBuddyClient;
  const write = vi.spyOn(process.stderr, 'write');
  const result = await handleAITest(['quick'], client);
  expect(runner.create).toHaveBeenCalledWith(client, expect.objectContaining({ timeout: 120000 }));
  expect(result.entry?.content).toBe('Local suite complete');
  expect(write).not.toHaveBeenCalled();
});
