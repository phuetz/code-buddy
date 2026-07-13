import { describe, expect, it } from 'vitest';
import { RESTORE_CONTEXT_TOOL } from '../../src/codebuddy/tool-definitions/agent-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { RestoreContextTool } from '../../src/tools/registry/attention-tools.js';

describe('restore_context public contract', () => {
  it('teaches models to prefer exact tool call IDs for raw observation recovery', () => {
    const registryTool = new RestoreContextTool();
    const registrySchema = registryTool.getSchema();
    const providerDescription = RESTORE_CONTEXT_TOOL.function.description;
    const providerIdentifier = RESTORE_CONTEXT_TOOL.function.parameters.properties?.identifier;

    expect(registryTool.description).toContain('exact originating tool call ID');
    expect(registryTool.description).toContain('raw output persisted before optimization');
    expect(registrySchema.parameters.properties.identifier?.description).toContain('tool call ID');
    expect(providerDescription).toContain('exact originating tool call ID');
    expect(providerDescription).toContain('raw output persisted before optimization');
    expect(providerIdentifier?.description).toContain('tool call ID');
  });

  it('keeps metadata aligned with the exact callId recovery contract', () => {
    const metadata = TOOL_METADATA.find((entry) => entry.name === 'restore_context');

    expect(metadata).toMatchObject({
      fleetSafe: true,
      description: expect.stringContaining('callId'),
    });
    expect(metadata?.keywords).toContain('exact');
  });
});
