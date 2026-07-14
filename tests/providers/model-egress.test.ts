import { describe, expect, it } from 'vitest';
import {
  classifyModelEgress,
  classifyProviderModelEgress,
} from '../../src/providers/model-egress.js';

describe('model egress classification', () => {
  it('does not confuse a local subscription CLI process with local inference', () => {
    expect(classifyModelEgress('local://gemini-cli', true)).toBe('lan');
    expect(classifyProviderModelEgress('gemini-cli', 'local://gemini-cli', true)).toBe('cloud');
    expect(classifyProviderModelEgress('agy-cli', 'local://agy-cli', true)).toBe('cloud');
  });

  it('keeps actual loopback inference local and remote APIs cloud', () => {
    expect(classifyProviderModelEgress('ollama', 'http://127.0.0.1:11434', true)).toBe('local');
    expect(classifyProviderModelEgress('grok', 'https://api.x.ai/v1', false)).toBe('cloud');
  });
});
