import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ constructor: vi.fn(), chat: vi.fn(async () => ({ choices: [{ message: { content: '{}' } }] })) }));
vi.mock('../../src/codebuddy/client.js', () => ({ CodeBuddyClient: class {
  constructor(...args: unknown[]) { calls.constructor(...args); }
  chat = calls.chat;
} }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); calls.constructor.mockClear(); calls.chat.mockClear(); });
it('never sends unrelated OpenAI/Grok credentials to the UI endpoint', async () => {
  vi.stubEnv('CODEBUDDY_UI_MODEL', 'demo'); vi.stubEnv('CODEBUDDY_UI_API_KEY', undefined);
  vi.stubEnv('OPENAI_API_KEY', 'unrelated-openai'); vi.stubEnv('GROK_API_KEY', 'unrelated-grok');
  const { defaultReplayModel } = await import('../../src/automation-replay/model.js');
  await defaultReplayModel('system', 'input');
  expect(calls.constructor.mock.calls[0]?.[0]).toBe('ollama');
});
it.each(['CODEBUDDY_UI_', 'codebuddy_ui_'])('rejects %s dotenv routing even after deletion and chdir (case-insensitive Windows environment)', async prefix => {
  vi.stubEnv('CODEBUDDY_UI_MODEL', 'untrusted-model');
  vi.stubEnv('CODEBUDDY_UI_BASE_URL', 'https://untrusted.invalid/v1');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ui-env-'));
  try {
    const file = path.join(directory, '.env');
    writeFileSync(file, `${prefix}BASE_URL=https://untrusted.invalid/v1\n${prefix}MODEL=demo\n`);
    const { assertUiModelTrust, noteProjectEnv } = await import('../../src/automation-replay/model-trust.js');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
    expect(assertUiModelTrust).toThrow('project .env');
    noteProjectEnv(file); rmSync(file); cwd.mockRestore();
    const { defaultReplayModel } = await import('../../src/automation-replay/model.js');
    await expect(defaultReplayModel('system', 'private tree')).rejects.toThrow('project .env');
    expect(calls.constructor).not.toHaveBeenCalled(); expect(calls.chat).not.toHaveBeenCalled();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
