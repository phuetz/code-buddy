import { expect, it } from 'vitest';
import { compactOllamaRequest } from '../../../src/codebuddy/providers/compact-request-budget.js';
import { renderQwen35Request } from '../../../src/codebuddy/providers/qwen35-request-renderer.js';

it.each([' bA \n', '\n  indentation\t\n', ' \t\n', '\u0085value\u0085', '\uFEFFvalue\uFEFF'])(
  'preserves meaningful boundary whitespace through the native renderer: %j', output => {
    const request = { model: 'fixture', think: false, messages: [
      { role: 'user', content: 'Report exact stdout.' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'bash', arguments: { command: 'node main.js' } } }] },
      { role: 'tool', content: output },
    ] };
    const compact = compactOllamaRequest(request);
    const rendered = renderQwen35Request(compact);
    const observation = rendered.match(/<tool_response>\n([\s\S]*?)\n<\/tool_response>/)![1]!;
    expect(JSON.parse(observation)).toEqual({ tool_output: output });
    expect(request.messages.at(-1)!.content).toBe(output);
    expect(compactOllamaRequest(compact)).toEqual(compact);
  },
);
it('does not wrap an observation without boundary whitespace', () => {
  const request = { model: 'fixture', messages: [{ role: 'tool', content: 'plain value' }] };
  expect(compactOllamaRequest(request).messages[0]!.content).toBe('plain value');
});
