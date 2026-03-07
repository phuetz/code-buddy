import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDEConnection, IDERequest, IDEResponse } from '../../src/integrations/ide/types.js';

const chatMock = vi.fn();
const codeBuddyClientMock = vi.fn(class MockCodeBuddyClient {
  chat = chatMock;
});

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: codeBuddyClientMock,
}));

import { IDEExtensionsServer } from '../../src/integrations/ide/server.js';

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
  const originalApiKey = process.env.GROK_API_KEY;
  const originalModel = process.env.GROK_MODEL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GROK_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-code-fast-1';
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.GROK_API_KEY;
    } else {
      process.env.GROK_API_KEY = originalApiKey;
    }

    if (originalModel === undefined) {
      delete process.env.GROK_MODEL;
    } else {
      process.env.GROK_MODEL = originalModel;
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
    delete process.env.GROK_API_KEY;

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
