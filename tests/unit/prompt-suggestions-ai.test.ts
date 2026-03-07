import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: vi.fn(class MockCodeBuddyClient {
    chat = chatMock;
  }),
}));

import { PromptSuggestionEngine } from '../../src/agent/prompt-suggestions.js';

describe('PromptSuggestionEngine AI integration', () => {
  const originalApiKey = process.env.GROK_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GROK_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.GROK_API_KEY;
    } else {
      process.env.GROK_API_KEY = originalApiKey;
    }
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
