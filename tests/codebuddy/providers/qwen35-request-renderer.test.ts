import { expect, it } from 'vitest';
import { renderQwen35Request } from '../../../src/codebuddy/providers/qwen35-request-renderer.js';
it('includes the native empty think prefix and groups consecutive tool results', () => {
  const result = renderQwen35Request({ model: 'fixture', think: false, messages: [
    { role: 'user', content: 'hello' }, { role: 'tool', content: 'one' }, { role: 'tool', content: 'two' },
  ] });
  expect(result).toBe('<|im_start|>user\nhello<|im_end|>\n<|im_start|>user\n<tool_response>\none\n</tool_response>\n<tool_response>\ntwo\n</tool_response><|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n');
});
it('uses native float formatting for function arguments instead of JSON numbers', () => {
  const rendered = renderQwen35Request({ model: 'fixture', think: false, messages: [{ role: 'assistant', content: '',
    tool_calls: [{ function: { name: 'read', arguments: { huge: 1000000, small: 0.00001 } } }] }] });
  expect(rendered).toContain('<parameter=huge>\n1e+06\n</parameter>');
  expect(rendered).toContain('<parameter=small>\n1e-05\n</parameter>');
});
it('refuses image token counts it cannot establish', () => {
  expect(() => renderQwen35Request({ model: 'fixture', messages: [{ role: 'user', content: 'image', images: ['AA=='] }] })).toThrow(/image/);
});

it.each(['\uFEFF', '\u0085'])('matches Go whitespace handling at native boundaries: %j', char => {
  const retained = char === '\uFEFF' ? char : '';
  const rendered = renderQwen35Request({ model: 'fixture', think: true, messages: [
    { role: 'user', content: char + 'value' + char },
    { role: 'assistant', content: 'done', thinking: char + 'reason' + char },
  ] });
  expect(rendered).toContain('user\n' + retained + 'value' + retained + '<|im_end|>');
  expect(rendered).toContain('<think>\n' + retained + 'reason' + retained + '\n</think>');
});
