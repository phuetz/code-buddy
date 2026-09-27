import { describe, expect, it } from 'vitest';
import { toProposerView } from '../../../src/agent/self-improvement/tool-proposer.js';
import type { ToolBenchmarkScenario } from '../../../src/agent/self-improvement/tool-types.js';

describe('toProposerView', () => {
  it('cas held-out jamais visibles du proposeur', () => {
    const scenario: ToolBenchmarkScenario = {
      id: 'test',
      capability: 'test cap',
      description: 'test desc',
      visibleCases: [{ input: {}, expectedOutput: 'v' }],
      heldOutCases: [{ input: {}, expectedOutput: 'h' }]
    };
    const view = toProposerView(scenario);
    expect(view.id).toBe('test');
    expect(view.capability).toBe('test cap');
    expect(view.description).toBe('test desc');
    expect(view.visibleCases).toEqual(scenario.visibleCases);
    expect('heldOutCases' in view).toBe(false);
  });
});
