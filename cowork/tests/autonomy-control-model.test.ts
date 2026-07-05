import { describe, expect, it } from 'vitest';

import { guardrailsFor, validatePosture } from '../src/renderer/components/os-actions/utils/autonomy-control-model.js';

describe('autonomy-control-model', () => {
  it('validates supported postures', () => {
    expect(validatePosture('plan')).toEqual({ valid: true });
    expect(validatePosture('manual').valid).toBe(false);
  });

  it('tightens guardrails for full autonomy', () => {
    expect(guardrailsFor('full').map((guardrail) => guardrail.id)).toContain('rollback-snapshot');
    expect(guardrailsFor('plan').map((guardrail) => guardrail.id)).toContain('human-approval');
  });
});
