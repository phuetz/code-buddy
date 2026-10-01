import { describe, expect, it } from 'vitest';
import { compactRuleDigest } from '../../src/prompts/compact-rule-digest.js';

describe('compact project rule digest', () => {
  it('keeps late French and English imperatives ahead of narrative, within a fixed ceiling', () => {
    const text = '<!-- context: AGENTS.md (hierarchy) -->\n' + 'A historical narrative.\n'.repeat(1000) + '\nNever change tests.\nRéponds exactement CODE_QA.\nNe pas publier.\n';
    const digest = compactRuleDigest(text);
    expect(digest.length).toBeLessThanOrEqual(1000);
    expect(digest).toContain('Never change tests.');
    expect(digest).toContain('Réponds exactement CODE_QA.');
    expect(digest).toContain('Ne pas publier.');
    expect(digest).not.toContain('historical narrative');
  });
  it('keeps the local overriding rule when inherited rules fill the ceiling', () => {
    const text = '<!-- context: AGENTS.md (global) -->\n' + 'Always preserve inherited configuration.\n'.repeat(80) + '<!-- context: nested/AGENTS.md (hierarchy) -->\nAlways answer LOCAL_CODE.\n';
    expect(compactRuleDigest(text)).toContain('Always answer LOCAL_CODE.');
  });
  it('does not cut a rule into a different instruction', () => {
    expect(compactRuleDigest('Never ' + 'x'.repeat(2000))).not.toContain('Never x');
  });
});
