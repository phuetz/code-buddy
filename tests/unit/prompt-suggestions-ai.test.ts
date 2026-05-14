import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();

const testPaths = vi.hoisted(() => ({
  tmpHome: '',
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testPaths.tmpHome || actual.homedir(),
  };
});

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

import { PromptSuggestionEngine } from '../../src/agent/prompt-suggestions.js';

describe('PromptSuggestionEngine AI integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    delete process.env.CHATGPT_MODEL;
    testPaths.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-suggestions-ai-'));
    const authDir = path.join(testPaths.tmpHome, '.codebuddy');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, 'codex-auth.json'),
      JSON.stringify({ tokens: { access_token: 'test-chatgpt-token' } }),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    if (testPaths.tmpHome) {
      fs.rmSync(testPaths.tmpHome, { recursive: true, force: true });
      testPaths.tmpHome = '';
    }
  });

  it('parses AI-generated suggestions into a short deduplicated list', async () => {
    const { CodeBuddyClient } = await import('../../src/codebuddy/client.js');
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
    expect(CodeBuddyClient).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'gpt-5.5',
      'https://chatgpt.com/backend-api/codex',
    );
  });
});
