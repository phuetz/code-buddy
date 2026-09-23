import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_LOOP_GUARDRAILS,
  loadToolLoopGuardOptions,
  resolveToolLoopGuardrails,
  ToolLoopGuard,
} from '../../../src/agent/execution/tool-loop-guard.js';

const same = { success: true, output: 'same content' };
const fail = (error: string) => ({ success: false as const, error });

describe('tool loop guardrails', () => {
  it('keeps the historical 5-then-3 sequence when nothing is configured', () => {
    expect(DEFAULT_TOOL_LOOP_GUARDRAILS.warnAfter).toEqual({
      exact_failure: 0,
      same_tool_failure: 0,
      idempotent_no_progress: 5,
    });
    expect(DEFAULT_TOOL_LOOP_GUARDRAILS.hardStopAfter.idempotent_no_progress).toBe(8);
    expect(DEFAULT_TOOL_LOOP_GUARDRAILS.hardStopEnabled).toBe(true);
    const guard = new ToolLoopGuard({ isRepeatSafe: () => false });
    const actions = Array.from({ length: 8 }, () =>
      guard.observe({ name: 'view_file', argumentsJson: '{"path":"a.ts"}', result: same }).action,
    );
    expect(actions).toEqual(['none', 'none', 'none', 'none', 'warn', 'none', 'none', 'stop']);
  });

  it('does not treat a different error text as a loop until exact_failure is enabled', () => {
    const historical = new ToolLoopGuard({ isRepeatSafe: () => false });
    for (let i = 0; i < 6; i++) {
      expect(historical.observe({
        name: 'view_file',
        argumentsJson: '{"path":"a"}',
        result: fail(`error ${i}`),
      }).action).toBe('none');
    }

    const guard = new ToolLoopGuard({
      isRepeatSafe: () => false,
      guardrails: {
        warnAfter: { exact_failure: 2 },
        hardStopAfter: { exact_failure: 4 },
      },
    });
    expect(guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: fail('one') }).action).toBe('none');
    expect(guard.observe({ name: 'view_file', argumentsJson: '{"path":"b"}', result: fail('one') }).action).toBe('none');
    const warned = guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: fail('two') });
    expect(warned).toMatchObject({ action: 'warn', kind: 'exact_failure', repetitions: 2 });
    expect(guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: fail('three') }).action).toBe('none');
    expect(guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: fail('four') })).toMatchObject({
      action: 'stop',
      kind: 'exact_failure',
      repetitions: 4,
    });
  });

  it('counts same_tool_failure across arguments and clears that count after a success', () => {
    const guardrails = {
      warnAfter: { same_tool_failure: 3 },
      hardStopAfter: { same_tool_failure: 5 },
    };
    const guard = new ToolLoopGuard({ isRepeatSafe: () => false, guardrails });
    expect(guard.observe({ name: 'bash', argumentsJson: '{"command":"a"}', result: fail('a') }).action).toBe('none');
    expect(guard.observe({ name: 'bash', argumentsJson: '{"command":"b"}', result: fail('b') }).action).toBe('none');
    expect(guard.observe({ name: 'bash', argumentsJson: '{}', result: same }).action).toBe('none');
    expect(guard.observe({ name: 'bash', argumentsJson: '{"command":"c"}', result: fail('c') }).action).toBe('none');
    expect(guard.observe({ name: 'bash', argumentsJson: '{"command":"d"}', result: fail('d') }).action).toBe('none');
    expect(guard.observe({ name: 'bash', argumentsJson: '{"command":"e"}', result: fail('e') })).toMatchObject({
      action: 'warn',
      kind: 'same_tool_failure',
      repetitions: 3,
    });
  });

  it('moves the historical identical-result guard when idempotent_no_progress changes', () => {
    const guard = new ToolLoopGuard({
      isRepeatSafe: () => false,
      guardrails: {
        warnAfter: { idempotent_no_progress: 2 },
        hardStopAfter: { idempotent_no_progress: 4 },
      },
    });
    const actions = Array.from({ length: 4 }, () =>
      guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: same }).action,
    );
    expect(actions).toEqual(['none', 'warn', 'none', 'stop']);
    expect(guard.hasStopped).toBe(true);
  });

  it('warns on a shorter identical cycle when idempotent_no_progress is lowered', () => {
    const guard = new ToolLoopGuard({
      isRepeatSafe: () => false,
      guardrails: { warnAfter: { idempotent_no_progress: 2 } },
    });
    const decisions = [
      guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: same }),
      guard.observe({ name: 'search', argumentsJson: '{"q":"a"}', result: same }),
      guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: same }),
      guard.observe({ name: 'search', argumentsJson: '{"q":"a"}', result: same }),
    ];
    expect(decisions[3]).toMatchObject({ action: 'warn', kind: 'repeated_cycle' });
  });

  it('does not hard-stop when hard_stop_enabled is false', () => {
    const guard = new ToolLoopGuard({
      isRepeatSafe: () => false,
      guardrails: { hardStopEnabled: false },
    });
    const actions = Array.from({ length: 12 }, () =>
      guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: same }).action,
    );
    expect(actions.filter((action) => action === 'warn')).toEqual(['warn']);
    expect(actions).not.toContain('stop');
    expect(guard.hasStopped).toBe(false);
  });

  it('hard-stops a pure streak without a warning when warnings are disabled', () => {
    const guard = new ToolLoopGuard({
      isRepeatSafe: () => false,
      guardrails: { warningsEnabled: false },
    });
    const actions = Array.from({ length: 8 }, () =>
      guard.observe({ name: 'view_file', argumentsJson: '{"path":"a"}', result: same }).action,
    );
    expect(actions).toEqual(['none', 'none', 'none', 'none', 'none', 'none', 'none', 'stop']);
  });

  it('still ignores repeat-safe tools when failure counters are enabled', () => {
    const guard = new ToolLoopGuard({
      guardrails: { warnAfter: { same_tool_failure: 1 }, hardStopAfter: { same_tool_failure: 2 } },
    });
    for (let i = 0; i < 5; i++) {
      expect(guard.observe({ name: 'process', argumentsJson: '{"action":"list"}', result: fail('busy') }).action).toBe('none');
    }
  });

  it('rejects non-integers and keeps idempotent_no_progress at least 2', () => {
    const resolved = resolveToolLoopGuardrails({
      warn_after: { exact_failure: 1.5, same_tool_failure: -1, idempotent_no_progress: 0 },
      hard_stop_after: { exact_failure: '4', idempotent_no_progress: 2 },
    });
    expect(resolved.warnAfter).toEqual(DEFAULT_TOOL_LOOP_GUARDRAILS.warnAfter);
    expect(resolved.hardStopAfter.exact_failure).toBe(0);
    expect(resolved.hardStopAfter.idempotent_no_progress).toBeGreaterThan(resolved.warnAfter.idempotent_no_progress);
  });

  it('reads tool_loop_guardrails from config.toml text', () => {
    const options = loadToolLoopGuardOptions(() => `
[tool_loop_guardrails]
hard_stop_enabled = false

[tool_loop_guardrails.warn_after]
exact_failure = 2
same_tool_failure = 3
idempotent_no_progress = 4

[tool_loop_guardrails.hard_stop_after]
exact_failure = 5
same_tool_failure = 6
idempotent_no_progress = 7
`);
    expect(options.guardrails).toMatchObject({
      hardStopEnabled: false,
      warnAfter: { exact_failure: 2, same_tool_failure: 3, idempotent_no_progress: 4 },
      hardStopAfter: { exact_failure: 5, same_tool_failure: 6, idempotent_no_progress: 7 },
    });
    expect(loadToolLoopGuardOptions(() => 'model = "demo"\n')).toEqual({});
    expect(loadToolLoopGuardOptions(() => 'tool_loop_guardrails = "nope"\n').guardrails?.warnAfter?.idempotent_no_progress).toBe(5);
  });
});
