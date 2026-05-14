import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: vi.fn(class MockCodeBuddyClient {
    constructor(
      public apiKey: string,
      public model?: string,
      public baseURL?: string,
    ) {}

    chat = chatMock;
  }),
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: vi.fn(() => ({
    provider: 'chatgpt',
    apiKey: 'oauth-chatgpt',
    baseURL: 'https://chatgpt.com/backend-api/codex',
    defaultModel: 'gpt-5.5',
  })),
  selectModelForDetectedProvider: vi.fn((detected: { defaultModel: string }) => detected.defaultModel),
}));

import { PromptSuggestionEngine } from '../../src/agent/prompt-suggestions.js';

describe('PromptSuggestionEngine AI integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses AI-generated suggestions into a short deduplicated list', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: `
1. Compare the failing test fixture
2. Compare the failing test fixture
3. Run the focused test file
4. Inspect the parser config
`,
          },
        },
      ],
    });

    const engine = new PromptSuggestionEngine();
    const suggestions = await engine.generateSuggestions(
      'The parser tests are failing',
      'The config looks suspicious'
    );

    expect(suggestions).toEqual([
      'Compare the failing test fixture',
      'Run the focused test file',
      'Inspect the parser config',
    ]);
  });
});
