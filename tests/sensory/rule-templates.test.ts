/**
 * Rule templates (Phase 5) — every bundled template must pass the SAME validateRule
 * gate the executor uses, so `buddy rules add --template <name>` can never install a
 * malformed or destructive rule. Also proves the numeric-threshold template is valid.
 */
import { describe, expect, it } from 'vitest';
import {
  RULE_TEMPLATES,
  getRuleTemplate,
  listRuleTemplates,
} from '../../src/sensory/rule-templates.js';
import { validateRule, isNumericFilter } from '../../src/sensory/sensory-rules-engine.js';

describe('rule templates', () => {
  it('every template passes validateRule', () => {
    expect(RULE_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const tpl of RULE_TEMPLATES) {
      const rule = tpl.build();
      const v = validateRule(rule);
      expect(v.errors, `${tpl.name}: ${v.errors.join('; ')}`).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it('template names are unique and rule ids are unique', () => {
    const names = RULE_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const ids = RULE_TEMPLATES.map((t) => t.build().id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships the anti-runaway template (the incident fix)', () => {
    const tpl = getRuleTemplate('process-runaway-alert');
    expect(tpl).toBeDefined();
    const rule = tpl!.build();
    expect(rule.match).toMatchObject({ modality: 'system', kind: 'process_runaway' });
    expect(rule.action.type).toBe('alert');
  });

  it('ships process-runaway-kill (dryRun true, escalate false, cooldown 60s)', () => {
    const tpl = getRuleTemplate('process-runaway-kill');
    expect(tpl).toBeDefined();
    const rule = tpl!.build();
    expect(rule.id).toBe('tpl-process-runaway-kill');
    expect(rule.match).toMatchObject({ modality: 'system', kind: 'process_runaway' });
    expect(rule.action).toMatchObject({ type: 'kill_process', dryRun: true, escalate: false });
    expect(rule.cooldownMs).toBe(60_000);
    expect(Object.prototype.hasOwnProperty.call(rule.action, 'pid')).toBe(false);
    const v = validateRule(rule);
    expect(v.ok).toBe(true);
  });

  it('the disk-low template uses a numeric-threshold filter', () => {
    const rule = getRuleTemplate('disk-low-alert')!.build();
    const f = rule.match.filters?.diskPct;
    expect(isNumericFilter(f)).toBe(true);
    expect(f).toMatchObject({ op: 'gte', value: 90 });
  });

  it('the codex-quota-probe is a time/tick agent rule', () => {
    const rule = getRuleTemplate('codex-quota-probe')!.build();
    expect(rule.match).toMatchObject({ modality: 'time', kind: 'tick' });
    // BUG-04 fix: a between window (not strict hhmm equality) so jitter can't skip the minute.
    expect(rule.match.between).toEqual(['04:20', '04:22']);
    expect(rule.action.type).toBe('agent');
  });

  it('getRuleTemplate is case-insensitive; unknown → undefined', () => {
    expect(getRuleTemplate('PROCESS-RUNAWAY-ALERT')).toBeDefined();
    expect(getRuleTemplate('nope')).toBeUndefined();
  });

  it('listRuleTemplates returns name + description for each', () => {
    const list = listRuleTemplates();
    expect(list).toHaveLength(RULE_TEMPLATES.length);
    for (const t of list) {
      expect(typeof t.name).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});
