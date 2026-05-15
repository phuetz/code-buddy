import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDEConnection, IDERequest, IDEResponse } from '../../src/integrations/ide/types.js';

const mocks = vi.hoisted(() => {
  const chatMock = vi.fn();
  return {
    chatMock,
    codeBuddyClientMock: vi.fn(class MockCodeBuddyClient {
      chat = chatMock;
    }),
  };
});

const { chatMock, codeBuddyClientMock } = mocks;

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
  CodeBuddyClient: mocks.codeBuddyClientMock,
}));

import { IDEExtensionsServer } from '../../src/integrations/ide/server.js';

const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CHATGPT_MODEL',
  'CODEBUDDY_PROVIDER',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROK_API_KEY',
  'GROK_MODEL',
  'OLLAMA_HOST',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
] as const;

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    delete process.env[key];
  }
}

function useNoProvider(): void {
  clearProviderEnv();
  process.env.CODEBUDDY_PROVIDER = 'none';
}

function useChatGptAuth(): void {
  clearProviderEnv();
  process.env.CODEBUDDY_PROVIDER = 'chatgpt';
  const authDir = path.join(testPaths.tmpHome, '.codebuddy');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(
    path.join(authDir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-chatgpt-token' } }),
  );
}

function createConnection(): IDEConnection {
  return {
    id: 'conn-test',
    type: 'unknown',
    name: 'Test IDE',
    connected: true,
    lastActivity: Date.now(),
  };
}

async function invoke(
  server: IDEExtensionsServer,
  method: string,
  params: Record<string, unknown>
): Promise<IDEResponse | null> {
  const request: IDERequest = {
    id: `${method}-1`,
    method,
    params,
  };

  return (server as unknown as {
    handleRequest: (request: IDERequest, connection: IDEConnection) => Promise<IDEResponse | null>;
  }).handleRequest(request, createConnection());
}

describe('IDEExtensionsServer', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    clearProviderEnv();
    process.env.CODEBUDDY_PROVIDER = 'grok';
    process.env.GROK_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-code-fast-1';
    testPaths.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-extensions-server-'));
  });

  afterEach(() => {
    process.env = originalEnv;
    if (testPaths.tmpHome) {
      fs.rmSync(testPaths.tmpHome, { recursive: true, force: true });
      testPaths.tmpHome = '';
    }
  });

  it('returns AI-backed completions and caches repeated requests', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '```json\n[{"label":"map","insertText":"map","detail":"Array helper","documentation":"Maps items","kind":"method"}]\n```',
          },
        },
      ],
    });

    const server = new IDEExtensionsServer();
    const first = await invoke(server, 'completion', {
      file: 'missing.ts',
      line: 0,
      column: 6,
      prefix: 'items.',
      language: 'typescript',
    });
    const second = await invoke(server, 'completion', {
      file: 'missing.ts',
      line: 0,
      column: 6,
      prefix: 'items.',
      language: 'typescript',
    });

    expect(chatMock).toHaveBeenCalledTimes(1);

    const firstItems = (first?.result as { items: Array<Record<string, unknown>> }).items;
    const secondItems = (second?.result as { items: Array<Record<string, unknown>> }).items;

    expect(firstItems).toEqual([
      {
        label: 'map',
        insertText: 'map',
        detail: 'Array helper',
        documentation: 'Maps items',
        kind: 'function',
        sortText: '000',
      },
    ]);
    expect(secondItems).toEqual(firstItems);
  });

  it('advertises only implemented automatic IDE capabilities', async () => {
    const server = new IDEExtensionsServer();
    const response = await invoke(server, 'initialize', {
      ide: 'vscode',
      version: '1.98.0',
    });

    expect(response?.result).toEqual({
      capabilities: {
        completion: true,
        hover: false,
        codeAction: false,
        diagnostics: false,
      },
      serverVersion: '1.0.0',
    });
  });

  it('falls back to lexical completions when no API key is configured', async () => {
    useNoProvider();

    const server = new IDEExtensionsServer();
    const response = await invoke(server, 'completion', {
      prefix: 'const result = calc',
      context: 'calculateValue(input);\ncalculateVelocity(input);\nrenderOutput();',
      language: 'typescript',
    });

    const items = (response?.result as { items: Array<{ label: string }> }).items;
    expect(items.map((item) => item.label)).toContain('calculateValue');
    expect(items.map((item) => item.label)).toContain('calculateVelocity');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('constructs IDE AI clients from the detected provider', async () => {
    useChatGptAuth();
    chatMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'Use a boundary interface.' } }],
    });

    const server = new IDEExtensionsServer();
    await invoke(server, 'ask', {
      question: 'How should I isolate the file system?',
    });

    expect(codeBuddyClientMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'gpt-5.5',
      'https://chatgpt.com/backend-api/codex'
    );
  });

  it('answers ask requests through CodeBuddyClient', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'Use dependency inversion to decouple the file system access.',
          },
        },
      ],
    });

    const server = new IDEExtensionsServer();
    const response = await invoke(server, 'ask', {
      question: 'How should I decouple file system access?',
    });

    expect((response?.result as { answer: string }).answer).toBe(
      'Use dependency inversion to decouple the file system access.'
    );
  });

  it('returns an error when the IDE AI provider sends an empty response', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [],
    });

    const server = new IDEExtensionsServer();
    const response = await invoke(server, 'ask', {
      question: 'How should I decouple file system access?',
    });

    expect(response?.error?.message).toBe('AI provider returned an empty IDE response');
  });

  it('returns refactored code without markdown fences', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '```ts\nconst value = input.trim();\n```',
          },
        },
      ],
    });

    const server = new IDEExtensionsServer();
    const response = await invoke(server, 'refactor', {
      code: 'const value = input;',
      instruction: 'Trim the input before assigning it',
      language: 'typescript',
    });

    expect((response?.result as { refactored: string }).refactored).toBe(
      'const value = input.trim();'
    );
  });

  it('parses structured fix suggestions', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              fix: 'return cachedValue;',
              range: {
                start: { line: 1, character: 2 },
                end: { line: 1, character: 15 },
              },
              message: 'Use the cached value directly.',
            }),
          },
        },
      ],
    });

    const server = new IDEExtensionsServer();
    const response = await invoke(server, 'suggestFix', {
      file: '/workspace/example.ts',
      context: 'function read() {\n  return cache.get();\n}',
      diagnostics: [
        {
          message: 'Prefer cached value',
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 15 },
          },
        },
      ],
    });

    expect(response?.result).toEqual({
      fix: 'return cachedValue;',
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 15 },
      },
      message: 'Use the cached value directly.',
    });
  });
});
