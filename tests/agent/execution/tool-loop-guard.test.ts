import { describe, expect, it } from 'vitest';
import { isRepeatSafeTool, ToolLoopGuard } from '../../../src/agent/execution/tool-loop-guard.js';

const same = { success: true, output: 'same content' };

describe('ToolLoopGuard', () => {
  it('warns once at the threshold and stops on recidivism', () => {
    const guard = new ToolLoopGuard({ isRepeatSafe: () => false });
    const actions = Array.from({ length: 8 }, () =>
      guard.observe({ name: 'view_file', argumentsJson: '{"path":"a.ts"}', result: same }).action,
    );
    expect(actions).toEqual(['none', 'none', 'none', 'none', 'warn', 'none', 'none', 'stop']);
    expect(guard.hasStopped).toBe(true);
    expect(guard.observe({ name: 'view_file', argumentsJson: '{"path":"a.ts"}', result: same }).action).toBe('none');
  });

  it('treats argument key order as the same call', () => {
    const guard = new ToolLoopGuard({ isRepeatSafe: () => false, threshold: 2 });
    guard.observe({ name: 'search', argumentsJson: '{"q":"x","limit":5}', result: same });
    expect(guard.observe({ name: 'search', argumentsJson: '{"limit":5,"q":"x"}', result: same }).action).toBe('warn');
  });

  it('does not count a repeated call whose result changes (progress)', () => {
    const guard = new ToolLoopGuard({ isRepeatSafe: () => false });
    for (let i = 0; i < 12; i++) {
      const decision = guard.observe({ name: 'bash', argumentsJson: '{"command":"ls"}', result: { success: true, output: `tick ${i}` } });
      expect(decision.action).toBe('none');
    }
  });

  it('detects an A→B cycle repeated five times', () => {
    const guard = new ToolLoopGuard({ isRepeatSafe: () => false });
    const decisions = [];
    for (let i = 0; i < 5; i++) {
      decisions.push(guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: same }));
      decisions.push(guard.observe({ name: 'search', argumentsJson: '{"q":"a"}', result: same }));
    }
    const warn = decisions.find((d) => d.action === 'warn');
    expect(warn).toMatchObject({ action: 'warn', kind: 'repeated_cycle', toolNames: ['view_file', 'search'] });
    expect(decisions.filter((d) => d.action === 'warn')).toHaveLength(1);
  });

  it('never observes repeat-safe polling tools', () => {
    const guard = new ToolLoopGuard();
    expect(isRepeatSafeTool('process')).toBe(true);
    for (let i = 0; i < 10; i++) {
      expect(guard.observe({ name: 'process', argumentsJson: '{"action":"list"}', result: same }).action).toBe('none');
    }
    expect(isRepeatSafeTool('view_file')).toBe(false);
  });

  it('includes failures in the no-progress signature', () => {
    const guard = new ToolLoopGuard({ isRepeatSafe: () => false, threshold: 3 });
    const failing = { success: false, error: 'ENOENT' };
    guard.observe({ name: 'view_file', argumentsJson: '{"path":"x"}', result: failing });
    guard.observe({ name: 'view_file', argumentsJson: '{"path":"x"}', result: failing });
    expect(guard.observe({ name: 'view_file', argumentsJson: '{"path":"x"}', result: failing }).action).toBe('warn');
  });
});
