import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ContextManagerV3 } from '../../src/context/context-manager-v3.js';
import { getModelToolConfig } from '../../src/config/model-tools.js';

describe('ContextManagerV3 request budget uniqueness and table default', () => {
  it('uses the model table when constructed with only a model name', () => {
    const model = 'nvidia/nemotron-3-super-120b-a12b';
    const manager = new ContextManagerV3({ model });
    expect(manager.getStats([]).maxTokens).toBe(getModelToolConfig(model).contextWindow);
    expect(manager.getStats([]).maxTokens).toBe(256000);
    manager.dispose();
  });

  it('throws CURRENT_REQUEST_EXCEEDS_BUDGET only from rejectIfCurrentRequestExceedsBudget', () => {
    const source = readFileSync(
      new URL('../../src/context/context-manager-v3.ts', import.meta.url),
      'utf8',
    );
    const rejectStart = source.indexOf('private rejectIfCurrentRequestExceedsBudget');
    const rejectEnd = source.indexOf('private assertLastUserPreserved', rejectStart);
    const assertStart = source.indexOf('private assertLastUserPreserved');
    const assertEnd = source.indexOf('private assertFitsTokenLimit', assertStart);
    const rejectIf = source.slice(rejectStart, rejectEnd);
    const assertLast = source.slice(assertStart, assertEnd);
    expect(rejectIf).toContain('CURRENT_REQUEST_EXCEEDS_BUDGET');
    expect(assertLast).not.toContain('CURRENT_REQUEST_EXCEEDS_BUDGET');
  });
});
