import { describe, expect, it } from 'vitest';
import { requireFlowResponseContent } from '../../src/commands/flow.js';
import { requireDirectResearchContent } from '../../src/commands/research/index.js';
import { requireDocsLlmContent } from '../../src/commands/slash/docs-command.js';

describe('user-facing LLM response content guards', () => {
  it('keeps non-empty flow content', () => {
    expect(requireFlowResponseContent({
      choices: [{ message: { content: '{"steps":[]}' } }],
    })).toBe('{"steps":[]}');
  });

  it('rejects blank flow content', () => {
    expect(() => requireFlowResponseContent({
      choices: [{ message: { content: '   ' } }],
    })).toThrow('Flow LLM returned no response content');
  });

  it('rejects missing flow choices', () => {
    expect(() => requireFlowResponseContent({ choices: [] }))
      .toThrow('Flow LLM returned no response content');
  });

  it('keeps non-empty docs LLM content', () => {
    expect(requireDocsLlmContent({
      choices: [{ message: { content: 'Generated documentation text' } }],
    })).toBe('Generated documentation text');
  });

  it('rejects blank docs LLM content', () => {
    expect(() => requireDocsLlmContent({
      choices: [{ message: { content: '\n\t' } }],
    })).toThrow('/docs LLM enrichment returned no response content');
  });

  it('keeps non-empty direct research content', () => {
    expect(requireDirectResearchContent('topic', {
      choices: [{ message: { content: '# Report' } }],
    })).toBe('# Report');
  });

  it('rejects blank direct research content', () => {
    expect(() => requireDirectResearchContent('test topic', {
      choices: [{ message: { content: '' } }],
    })).toThrow('Direct research returned no provider content for topic: test topic');
  });
});
