import { describe, expect, it } from 'vitest';

import { formatWhoamiStatus } from '../../src/commands/whoami-status.js';

describe('whoami status', () => {
  it('mentions an onboarded local provider instead of implying nothing is configured', () => {
    const lines = formatWhoamiStatus({
      chatgpt: null,
      local: { provider: 'ollama', model: 'gemma4-moe-rag:latest', baseURL: 'http://127.0.0.1:11434/v1' },
    });
    expect(lines.some((line) => /ChatGPT: not connected/.test(line))).toBe(true);
    expect(lines.join('\n')).toMatch(/Local: ollama/i);
    expect(lines.join('\n')).toContain('gemma4-moe-rag:latest');
    expect(lines.join('\n')).not.toMatch(/nothing is configured|no provider/i);
  });

  it('stays honest when neither ChatGPT nor a local provider is configured', () => {
    const lines = formatWhoamiStatus({ chatgpt: null, local: null });
    expect(lines).toEqual(['ChatGPT: not connected (run `buddy login` to authenticate)']);
  });
});
