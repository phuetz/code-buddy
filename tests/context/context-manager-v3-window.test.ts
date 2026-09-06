import { describe, expect, it } from 'vitest';

import { ContextCompactionError } from '../../src/context/context-manager-v2.js';
import { ContextManagerV3, createContextManager } from '../../src/context/context-manager-v3.js';
import { getModelToolConfig } from '../../src/config/model-tools.js';

describe('ContextManagerV3 model window', () => {
  it('uses the family table for NVIDIA Build models that publish no lengths', () => {
    const model = 'nvidia/nemotron-3-super-120b-a12b';
    const manager = createContextManager(model);
    expect(manager.getStats([]).maxTokens).toBe(getModelToolConfig(model).contextWindow);
    expect(manager.getStats([]).maxTokens).toBeGreaterThan(32768);
    manager.dispose();
  });

  it('throws when the current user request alone exceeds the budget', () => {
    const manager = new ContextManagerV3({
      maxContextTokens: 200,
      responseReserveTokens: 50,
      model: 'gpt-4',
    });
    const lastUser = { role: 'user' as const, content: `LATEST_REQUEST ${'x'.repeat(4000)}` };
    expect(() => manager.prepareMessages([
      { role: 'system', content: 'base' },
      lastUser,
    ])).toThrow(ContextCompactionError);
    try {
      manager.prepareMessages([{ role: 'system', content: 'base' }, lastUser]);
    } catch (error) {
      expect(error).toBeInstanceOf(ContextCompactionError);
      expect((error as ContextCompactionError).code).toBe('CURRENT_REQUEST_EXCEEDS_BUDGET');
    }
    manager.dispose();
  });
});
