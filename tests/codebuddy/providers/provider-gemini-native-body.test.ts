import { describe, expect, it } from 'vitest';
import type {
  ChatOptions,
  CodeBuddyMessage,
  CodeBuddyTool,
} from '../../../src/codebuddy/client.js';
import { GeminiNativeProvider } from '../../../src/codebuddy/providers/provider-gemini-native.js';

interface GeminiRequestBody {
  contents?: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  systemInstruction?: { parts: Array<{ text: string }> };
}

function buildBody(
  provider: GeminiNativeProvider,
  messages: CodeBuddyMessage[],
  tools?: CodeBuddyTool[],
  opts?: ChatOptions,
): GeminiRequestBody {
  const buildGeminiBody = (
    provider as unknown as {
      buildGeminiBody: (
        inputMessages: CodeBuddyMessage[],
        inputTools?: CodeBuddyTool[],
        inputOpts?: ChatOptions,
      ) => Record<string, unknown>;
    }
  ).buildGeminiBody.bind(provider);

  return buildGeminiBody(messages, tools, opts) as GeminiRequestBody;
}

function createProvider(): GeminiNativeProvider {
  return new GeminiNativeProvider({
    apiKey: 'test-key',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    defaultMaxTokens: 8192,
    geminiRequestTimeoutMs: 60_000,
  });
}

describe('GeminiNativeProvider request body', () => {
  it('preserves every system message as a separate systemInstruction part', () => {
    const body = buildBody(createProvider(), [
      { role: 'system', content: 'main execution rules' },
      { role: 'system', content: '<context type="lessons">lessons</context>' },
      { role: 'system', content: '<context type="todo">todo</context>' },
      { role: 'user', content: 'continue' },
    ]);

    expect(body.systemInstruction?.parts).toEqual([
      { text: 'main execution rules' },
      { text: '<context type="lessons">lessons</context>' },
      { text: '<context type="todo">todo</context>' },
    ]);
  });

  it('drops an orphan function response', () => {
    const body = buildBody(createProvider(), [
      { role: 'user', content: 'continue' },
      {
        role: 'tool',
        tool_call_id: 'call-orphan',
        name: 'read_file',
        content: 'orphaned result',
      } as unknown as CodeBuddyMessage,
    ]);

    const parts = body.contents?.flatMap(content => content.parts) ?? [];
    expect(parts.some(part => 'functionResponse' in part)).toBe(false);
    expect(body.contents?.map(content => content.role)).toEqual(['user']);
  });

  it('inserts a user turn when the transcript starts with the model', () => {
    const body = buildBody(createProvider(), [
      { role: 'assistant', content: 'previous answer' },
    ]);

    expect(body.contents?.map(content => content.role)).toEqual(['user', 'model']);
    expect(body.contents?.[0]?.parts).toEqual([
      { text: '(continuing previous conversation)' },
    ]);
  });
});
