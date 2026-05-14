import { vi } from 'vitest';

const providerMocks = vi.hoisted(() => ({
  detectProviderFromEnv: vi.fn(),
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: providerMocks.detectProviderFromEnv,
}));

import { listChatModels } from '../../src/server/routes/chat';

describe('chat model catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    providerMocks.detectProviderFromEnv.mockReturnValue(null);
  });

  it('includes non-Grok providers for the server model endpoint', () => {
    const ids = listChatModels(123).map((model) => model.id);

    expect(ids).toContain('gpt-5.5');
    expect(ids).toContain('gemini-2.5-flash');
    expect(ids).toContain('claude-sonnet-4-20250514');
    expect(ids).toContain('grok-3-fast');
  });

  it('marks and sorts the detected provider first', () => {
    providerMocks.detectProviderFromEnv.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    const models = listChatModels(123);

    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      provider: 'chatgpt',
      active_provider: true,
    });
    expect(models.find((model) => model.id === 'grok-3-fast')?.active_provider).toBe(false);
  });
});
