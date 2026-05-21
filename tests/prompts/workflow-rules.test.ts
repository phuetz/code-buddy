/**
 * Tests for getWorkflowRulesBlock()
 *
 * Pure function — no fs, no mocks needed.
 * Verifies that the block contains all 6 required sections and
 * key concrete keywords used by the agent.
 */

import { getWorkflowRulesBlock } from '../../src/prompts/workflow-rules.js';

describe('getWorkflowRulesBlock', () => {
  let block: string;

  beforeAll(() => {
    block = getWorkflowRulesBlock();
  });

  it('should return a non-empty string', () => {
    expect(typeof block).toBe('string');
    expect(block.trim().length).toBeGreaterThan(0);
  });

  it('should not throw when called', () => {
    expect(() => getWorkflowRulesBlock()).not.toThrow();
  });

  it('should be idempotent — two calls return the same value', () => {
    expect(getWorkflowRulesBlock()).toBe(getWorkflowRulesBlock());
  });

  // --------------------------------------------------------------------------
  // Required sections
  // --------------------------------------------------------------------------

  it('should contain a "When to Plan" section', () => {
    expect(block).toContain('When to Plan');
  });

  it('should contain an "Auto-Correction" section', () => {
    expect(block).toContain('Auto-Correction');
  });

  it('should contain a "Verification Contract" section', () => {
    expect(block).toContain('Verification Contract');
  });

  it('should contain an "Internet Automation Proof Loop" section', () => {
    expect(block).toContain('Internet Automation Proof Loop');
  });

  it('should contain an "Uncertainty Protocol" section', () => {
    expect(block).toContain('Uncertainty Protocol');
  });

  it('should contain an "Elegance Gate" section', () => {
    expect(block).toContain('Elegance Gate');
  });

  it('should contain a "Subagent" section', () => {
    expect(block).toContain('Subagent');
  });

  // --------------------------------------------------------------------------
  // Concrete keywords expected by the agent
  // --------------------------------------------------------------------------

  it('should reference the 3+ action verb trigger', () => {
    expect(block).toContain('3+');
  });

  it('should reference npx tsc --noEmit for TypeScript verification', () => {
    expect(block).toContain('npx tsc --noEmit');
  });

  it('should reference the task_verify tool', () => {
    expect(block).toContain('task_verify');
  });

  it('should reference Assumption: pattern for uncertainty protocol', () => {
    expect(block).toContain('Assumption:');
  });

  it('should reference lessons_add for self-improvement loop', () => {
    expect(block).toContain('lessons_add');
  });

  it('should reference lessons_search for pre-task lookup', () => {
    expect(block).toContain('lessons_search');
  });

  it('should reference browser observe/extract/assert_text for web proof loops', () => {
    expect(block).toContain('action=`observe`');
    expect(block).toContain('action=`extract`');
    expect(block).toContain('action=`assert_text`');
    expect(block).toContain('persistWhenProven=true');
    expect(block).toContain('persistenceSuggestions');
  });

  it('omits tool-specific guidance for unavailable tools', () => {
    const filtered = getWorkflowRulesBlock({
      isToolAvailable: toolName => ![
        'browser',
        'lessons_add',
        'lessons_search',
        'remember',
        'task_verify',
        'web_fetch',
        'web_search',
      ].includes(toolName),
    });

    expect(filtered).toContain('Internet Automation Proof Loop');
    expect(filtered).not.toContain('`web_search`');
    expect(filtered).not.toContain('`web_fetch`');
    expect(filtered).not.toContain('`browser`');
    expect(filtered).not.toContain('`task_verify`');
    expect(filtered).not.toContain('`remember`');
    expect(filtered).not.toContain('`lessons_add`');
    expect(filtered).not.toContain('`lessons_search`');
    expect(filtered).toContain('do not claim live verification');
  });

  it('keeps static web guidance without browser actions when browser is unavailable', () => {
    const filtered = getWorkflowRulesBlock({
      isToolAvailable: toolName => ['web_search', 'web_fetch'].includes(toolName),
    });

    expect(filtered).toContain('`web_search`');
    expect(filtered).toContain('`web_fetch`');
    expect(filtered).not.toContain('action=`observe`');
    expect(filtered).not.toContain('action=`extract`');
    expect(filtered).not.toContain('action=`assert_text`');
  });
});
