import { WritePolicy } from '../../../src/security/write-policy.js';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { compactOllamaRequest } from '../../../src/codebuddy/providers/compact-request-budget.js';
import { checkOllamaRequest } from '../../../src/codebuddy/providers/ollama-request-preflight.js';
describe('assembled compact request budget', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    WritePolicy.resetInstance();
  });
  it('keeps canonical types, requirements, enums and every mandatory instruction', () => {
    const request = {
      model: 'fixture',
      messages: [
        { role: 'system', content: '<project_rules>Never touch tests.</project_rules>' },
        { role: 'user', content: 'Fix tests' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'view_file',
            description: 'Read a file.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                file_path: { type: 'string', description: 'Alias for path' },
              },
              required: ['path'],
            },
          },
        },
      ],
      options: { num_ctx: 32768 },
      stream: true,
    };
    const compact = compactOllamaRequest(request);
    const tool = compact.tools?.[0] as (typeof request.tools)[0];
    expect(tool.function.parameters.required).toEqual(['path']);
    expect(tool.function.parameters.properties.path).toEqual({ type: 'string' });
    expect(tool.function.parameters.properties).not.toHaveProperty('file_path');
    expect(compact.messages[0]?.content).toContain('Never touch tests.');
    expect(request.tools[0]?.function.parameters.properties).toHaveProperty('file_path');
  });
  it('refuses a measured assembled compact prompt beyond 1500 including tools and context', async () => {
    vi.stubEnv('CODEBUDDY_HEADLESS', 'true');
    vi.stubEnv('CODEBUDDY_PROMPT_COMPACT', 'true');
    const body = {
      model: 'fixture',
      messages: [{ role: 'user', content: 'Explain' }],
      options: { num_ctx: 32768 },
      stream: false,
    };
    const fetcher = vi.fn(
      async () => new Response('{"models":[{"name":"fixture","context_length":32768}]}')
    );
    await expect(checkOllamaRequest('http://localhost:11434', body, 1501, fetcher)).rejects.toThrow(
      /compact.*1500.*1501/i
    );
  });
  it('keeps patch grammar immediately under strict policy and restores it after discovery', () => {
    const names = ['view_file', 'str_replace_editor', 'apply_patch', 'tool_search'];
    const request = {
      model: 'fixture',
      messages: [{ role: 'user', content: 'run tests and fix failures' }],
      tools: names.map((name) => ({
        type: 'function',
        function: {
          name,
          parameters: {
            type: 'object',
            properties: {
              patch: {
                type: 'string',
                description: '*** Begin Patch / *** Update File: path / *** End Patch',
              },
            },
            required: ['patch'],
          },
        },
      })),
      options: { num_ctx: 32768 },
      stream: false,
    };
    const tools = (value: ReturnType<typeof compactOllamaRequest>) =>
      value.tools?.map((tool) => (tool as (typeof request.tools)[0]).function.name);
    expect(tools(compactOllamaRequest(request))).not.toContain('apply_patch');
    WritePolicy.getInstance().setMode('strict');
    const strict = compactOllamaRequest(request);
    expect(tools(strict)).toContain('apply_patch');
    expect(
      (strict.tools?.[2] as (typeof request.tools)[0]).function.parameters.properties.patch
        .description
    ).toContain('*** Begin Patch');
    WritePolicy.getInstance().setMode('confirm');
    const discovered = {
      ...request,
      messages: [
        ...request.messages,
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'tool_search', arguments: {} } }],
        },
      ],
    };
    expect(tools(compactOllamaRequest(discovered))).toContain('apply_patch');
  });
});

it('defers duplicate editors for ordinary tasks but keeps discovery and an editor', () => {
  WritePolicy.resetInstance();
  const request = { model: 'fixture', stream: true, messages: [{ role: 'user', content: 'Explain the entry point, then rename its export.' }],
    tools: ['view_file', 'str_replace_editor', 'apply_patch', 'tool_search'].map(name => ({ type: 'function', function: { name } })) };
  const names = compactOllamaRequest(request).tools?.map(tool => (tool as { function: { name: string } }).function.name);
  expect(names).toEqual(['view_file', 'str_replace_editor', 'tool_search']);
  expect(request.tools).toHaveLength(4);
  WritePolicy.resetInstance();
});
