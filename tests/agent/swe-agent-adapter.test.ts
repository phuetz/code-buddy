/**
 * Tests for SWE Agent Adapter (registry integration)
 */
import { describe, it, expect } from 'vitest';
import { getSWEAgent, resetSWEAgent, SWESpecializedAgent } from '../../src/agent/specialized/swe-agent-adapter.js';

describe('SWESpecializedAgent', () => {
  it('has correct configuration', () => {
    resetSWEAgent();
    const agent = getSWEAgent();
    expect(agent.getId()).toBe('swe');
    expect(agent.getName()).toBe('SWE Agent');
    expect(agent.hasCapability('code-edit')).toBe(true);
    expect(agent.hasCapability('code-debug')).toBe(true);
    expect(agent.hasCapability('code-analyze')).toBe(true);
  });

  it('handles common file extensions', () => {
    const agent = getSWEAgent();
    expect(agent.canHandleExtension('ts')).toBe(true);
    expect(agent.canHandleExtension('py')).toBe(true);
    expect(agent.canHandleExtension('rs')).toBe(true);
    expect(agent.canHandleExtension('pdf')).toBe(false);
  });

  it('initializes successfully', async () => {
    const agent = new SWESpecializedAgent();
    expect(agent.isReady()).toBe(false);
    await agent.initialize();
    expect(agent.isReady()).toBe(true);
  });

  it('returns supported actions', () => {
    const agent = getSWEAgent();
    const actions = agent.getSupportedActions();
    expect(actions).toContain('edit');
    expect(actions).toContain('debug');
    expect(actions).toContain('refactor');
    expect(actions).toContain('run');
  });

  it('provides action help', () => {
    const agent = getSWEAgent();
    expect(agent.getActionHelp('edit')).toContain('Edit');
    expect(agent.getActionHelp('nonexistent')).toBe('Unknown action');
  });

  it('singleton pattern works', () => {
    resetSWEAgent();
    const a = getSWEAgent();
    const b = getSWEAgent();
    expect(a).toBe(b);
  });
});
