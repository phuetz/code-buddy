import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  }

  return {
    __esModule: true,
    default: MockOpenAI,
  };
});

vi.mock('../../src/utils/model-utils', () => ({
  validateModel: vi.fn(),
  getModelInfo: vi.fn().mockReturnValue({
    maxTokens: 8192,
    provider: 'xai',
    isSupported: true,
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { CodeBuddyClient } from '../../src/codebuddy/client';

describe('CodeBuddyClient search compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('omits search_parameters for xAI provider', async () => {
    const client = new CodeBuddyClient('test-key', 'grok-code-fast-1', 'https://api.x.ai/v1');
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    });

    await client.search('hello');

    const payload = mockCreate.mock.calls[0][0];
    expect(payload.search_parameters).toBeUndefined();
  });

  it('includes search_parameters for non-xAI providers', async () => {
    const client = new CodeBuddyClient('test-key', 'gpt-4o', 'https://api.openai.com/v1');
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    });

    await client.search('hello');

    const payload = mockCreate.mock.calls[0][0];
    expect(payload.search_parameters).toEqual({ mode: 'on' });
  });
});
