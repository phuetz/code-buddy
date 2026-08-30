import { describe, expect, it } from 'vitest';

import { DESIGN_SYSTEM_TOOL } from '../../src/codebuddy/tool-definitions/design-tools.js';
import { createInteractiveToolAdapters } from '../../src/tools/registry/interactive-adapters.js';

describe('design_system App Studio availability', () => {
  it('provides the fixed model schema used by the Studio-only selection', () => {
    expect(DESIGN_SYSTEM_TOOL.function.name).toBe('design_system');
    expect(DESIGN_SYSTEM_TOOL.function.parameters.required).toContain('action');
  });

  it('is dispatchable when App Studio adds its schema to the selected set', () => {
    expect(createInteractiveToolAdapters().some((tool) => tool.name === 'design_system')).toBe(true);
  });
});
