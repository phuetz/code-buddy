import { describe, expect, it } from 'vitest';
import { getSystemPromptForMode } from '../../src/prompts/system-base.js';

describe('compact base prompt', () => {
  it('preserves the entire security block and leaves room for project instructions', () => {
    const full = getSystemPromptForMode('default', false, '/workspace');
    const compact = getSystemPromptForMode('default', false, '/workspace', undefined, true);
    const security = full.match(/<security_rules>[\s\S]*?<\/security_rules>/)?.[0];
    expect(security).toBeDefined();
    expect(compact).toContain(security);
    expect(compact.length + 2_000 + 600).toBeLessThanOrEqual(6_000);
    expect(compact).toContain('apply_patch');
  });

  it('keeps custom instructions and mode guards in compact mode', () => {
    for (const mode of ['yolo', 'safe', 'code', 'research'] as const) {
      const full = getSystemPromptForMode(mode, false, '/workspace', 'CUSTOM_RULE');
      const compact = getSystemPromptForMode(mode, false, '/workspace', 'CUSTOM_RULE', true);
      expect(compact).toContain('CUSTOM_RULE');
      expect(compact).toContain(full.slice(full.indexOf('<mode_override>')));
    }
  });
});
