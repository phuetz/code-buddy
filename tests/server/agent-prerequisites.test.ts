import { afterEach, describe, expect, it, vi } from 'vitest';
const imported = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/provider-detector.js', () => ({ detectProviderFromEnv: () => null }));
vi.mock('../../src/agent/codebuddy-agent.js', () => {
  imported();
  throw new Error('Agent must not load before checking prerequisites');
});
import { createServerAgent } from '../../src/server/agent-adapter.js';
afterEach(() => vi.unstubAllEnvs());
describe('HTTP inference prerequisites', () => {
  it('returns an actionable 503 before loading optional agent dependencies', async () => {
    vi.stubEnv('GROK_API_KEY', '');
    vi.stubEnv('XAI_API_KEY', '');
    await expect(createServerAgent()).rejects.toMatchObject({
      status: 503, code: 'PROVIDER_NOT_CONFIGURED',
      message: expect.stringMatching(/buddy login.*Ollama.*API key/),
    });
    expect(imported).not.toHaveBeenCalled();
  });
});
