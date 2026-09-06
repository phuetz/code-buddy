/**
 * Sensory rules engine — Phase 2: numeric threshold operators in filters.
 * Proves gt/gte/lt/lte/eq/ne, that a string filter stays EXACT equality
 * (byte-identical to the historical path), and validateRule accepts both forms.
 */
import { describe, expect, it } from 'vitest';
import {
  __test as engine,
  validateRule,
  type SensoryRule,
} from '../../src/sensory/sensory-rules-engine.js';

const now = new Date('2026-09-05T14:00:00');

const rule = (over: Partial<SensoryRule> = {}): SensoryRule => ({
  id: 'r1',
  match: { modality: 'system', kind: 'resource_threshold' },
  action: { type: 'alert' },
  ...over,
});

function matchWith(
  filters: NonNullable<SensoryRule['match']['filters']>,
  payload: Record<string, unknown>,
): boolean {
  return engine.ruleMatches(
    rule({ match: { modality: 'system', kind: 'resource_threshold', filters } }),
    { modality: 'system', kind: 'resource_threshold', payload },
    now,
  );
}

describe('numeric threshold operators (Phase 2)', () => {
  it('gt / gte on the boundary', () => {
    expect(matchWith({ diskPct: { op: 'gt', value: 90 } }, { diskPct: 91 })).toBe(true);
    expect(matchWith({ diskPct: { op: 'gt', value: 90 } }, { diskPct: 90 })).toBe(false);
    expect(matchWith({ diskPct: { op: 'gte', value: 90 } }, { diskPct: 90 })).toBe(true);
    expect(matchWith({ diskPct: { op: 'gte', value: 90 } }, { diskPct: 89 })).toBe(false);
  });

  it('lt / lte on the boundary', () => {
    expect(matchWith({ cpu: { op: 'lt', value: 10 } }, { cpu: 9 })).toBe(true);
    expect(matchWith({ cpu: { op: 'lt', value: 10 } }, { cpu: 10 })).toBe(false);
    expect(matchWith({ cpu: { op: 'lte', value: 10 } }, { cpu: 10 })).toBe(true);
    expect(matchWith({ cpu: { op: 'lte', value: 10 } }, { cpu: 11 })).toBe(false);
  });

  it('eq / ne', () => {
    expect(matchWith({ n: { op: 'eq', value: 3 } }, { n: 3 })).toBe(true);
    expect(matchWith({ n: { op: 'eq', value: 3 } }, { n: 4 })).toBe(false);
    expect(matchWith({ n: { op: 'ne', value: 3 } }, { n: 4 })).toBe(true);
    expect(matchWith({ n: { op: 'ne', value: 3 } }, { n: 3 })).toBe(false);
  });

  it('coerces a numeric-string payload but fails on a non-numeric payload', () => {
    expect(matchWith({ diskPct: { op: 'gte', value: 90 } }, { diskPct: '95' })).toBe(true);
    expect(matchWith({ diskPct: { op: 'gte', value: 90 } }, { diskPct: 'lots' })).toBe(false);
    expect(matchWith({ diskPct: { op: 'gte', value: 90 } }, {})).toBe(false);
  });

  it('all filter keys must match (AND)', () => {
    const filters = {
      diskPct: { op: 'gte' as const, value: 90 },
      comm: 'bash',
    };
    expect(matchWith(filters, { diskPct: 95, comm: 'bash' })).toBe(true);
    expect(matchWith(filters, { diskPct: 95, comm: 'node' })).toBe(false);
    expect(matchWith(filters, { diskPct: 50, comm: 'bash' })).toBe(false);
  });
});

describe('string filter stays exact equality (byte-identical to historical path)', () => {
  it('matches equal string, rejects different, numbers coerce to string', () => {
    expect(matchWith({ camera: 'brio' }, { camera: 'brio' })).toBe(true);
    expect(matchWith({ camera: 'brio' }, { camera: 'garage' })).toBe(false);
    expect(matchWith({ camera: 'brio' }, {})).toBe(false);
    // historical String() coercion: payload number 5 vs filter '5'
    expect(matchWith({ code: '5' }, { code: 5 })).toBe(true);
  });

  it('filterMatches helper: string is equality, not threshold', () => {
    expect(engine.filterMatches('brio', 'brio')).toBe(true);
    expect(engine.filterMatches(5, '5')).toBe(true);
    expect(engine.filterMatches(95, { op: 'gte', value: 90 })).toBe(true);
    expect(engine.filterMatches(80, { op: 'gte', value: 90 })).toBe(false);
  });
});

describe('validateRule accepts both filter forms and rejects garbage', () => {
  it('accepts a numeric-threshold filter', () => {
    const v = validateRule(
      rule({ match: { modality: 'system', kind: 'resource_threshold', filters: { diskPct: { op: 'gte', value: 90 } } } }),
    );
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('accepts a string filter (unchanged)', () => {
    const v = validateRule(rule({ match: { kind: 'person_entered', filters: { camera: 'brio' } } }));
    expect(v.ok).toBe(true);
  });

  it('rejects an unknown operator and a non-number value', () => {
    const bad = validateRule(
      rule({ match: { kind: 'x', filters: { d: { op: 'between' as never, value: 1 } } } }),
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/filter 'd'/);

    const badVal = validateRule(
      rule({ match: { kind: 'x', filters: { d: { op: 'gte', value: 'high' as never } } } }),
    );
    expect(badVal.ok).toBe(false);
  });

  it('rejects a non-object filters map', () => {
    const bad = validateRule(rule({ match: { kind: 'x', filters: [] as never } }));
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/match.filters must be an object/);
  });
});

describe('BUG-03: absent/null metric never coerces to 0', () => {
  it('null payload value does NOT match lte/eq/gte numeric operators', () => {
    // Number(null)===0 would spuriously fire `lte 10` and `eq 0` on a GPU-less box.
    expect(matchWith({ vramPct: { op: 'lte', value: 10 } }, { vramPct: null })).toBe(false);
    expect(matchWith({ vramPct: { op: 'eq', value: 0 } }, { vramPct: null })).toBe(false);
    expect(matchWith({ vramPct: { op: 'gte', value: 90 } }, { vramPct: null })).toBe(false);
  });

  it('undefined / missing / empty-string payload never matches a numeric operator', () => {
    expect(matchWith({ fleetUtilization: { op: 'lte', value: 1 } }, { fleetUtilization: undefined })).toBe(false);
    expect(matchWith({ fleetUtilization: { op: 'lte', value: 1 } }, {})).toBe(false);
    expect(matchWith({ x: { op: 'eq', value: 0 } }, { x: '' })).toBe(false);
  });

  it('a real 0 still matches (regression guard — only null/undefined/empty are excluded)', () => {
    expect(matchWith({ x: { op: 'eq', value: 0 } }, { x: 0 })).toBe(true);
    expect(matchWith({ x: { op: 'lte', value: 10 } }, { x: 0 })).toBe(true);
  });

  it('filterMatches helper: null vs numeric filter is false, 0 is honored', () => {
    expect(engine.filterMatches(null, { op: 'lte', value: 10 })).toBe(false);
    expect(engine.filterMatches(undefined, { op: 'eq', value: 0 })).toBe(false);
    expect(engine.filterMatches(0, { op: 'eq', value: 0 })).toBe(true);
  });
});
