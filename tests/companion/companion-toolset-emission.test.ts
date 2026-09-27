import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCompanionTool } from '../../src/companion/companion-toolset.js';
import { FormalToolRegistry } from '../../src/tools/registry/tool-registry.js';
import type { ITool, ToolSchema } from '../../src/tools/registry/types.js';
import type { ConfirmationService } from '../../src/utils/confirmation-service.js';

const identity = {
  role: 'owner' as const,
  channel: 'pwa' as const,
  confidence: 'high' as const,
  reason: 'test',
};
const env = { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' };

function fakeTool(name: string): ITool {
  return {
    name,
    description: `Fake ${name}`,
    execute: vi.fn(async () => ({ success: true, output: 'fake result' })),
    getSchema: (): ToolSchema => ({
      name,
      description: `Fake ${name}`,
      parameters: { type: 'object', properties: {} },
    }),
  };
}

afterEach(() => FormalToolRegistry.reset());

describe('companion emission consent', () => {
  it.each(['web_search', 'weather', 'stock_quote', 'image_generate', 'image_edit'])(
    'refuses %s without a confirmation service before invoking the tool', async (name) => {
      const registry = FormalToolRegistry.getInstance();
      const tool = fakeTool(name);
      registry.register(tool);

      const result = await executeCompanionTool(name, { query: 'test' }, {
        identity, env, registry,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/confirmation/i);
      expect(tool.execute).not.toHaveBeenCalled();
    },
  );

  it('requires an explicit confirmation result for an emission', async () => {
    const registry = FormalToolRegistry.getInstance();
    const tool = fakeTool('web_search');
    registry.register(tool);
    const requestConfirmation = vi.fn()
      .mockResolvedValueOnce({ confirmed: false })
      .mockResolvedValueOnce({ confirmed: true });
    const confirmationService = { requestConfirmation } as unknown as ConfirmationService;
    const context = { identity, env, registry, confirmationService };

    expect((await executeCompanionTool('web_search', { query: 'test' }, context)).success).toBe(false);
    expect(tool.execute).not.toHaveBeenCalled();
    expect((await executeCompanionTool('web_search', { query: 'test' }, context)).success).toBe(true);
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'web_search', forcePrompt: true }),
      'tool',
    );
  });

  it('keeps a local read tool available without a confirmation service', async () => {
    const registry = FormalToolRegistry.getInstance();
    const tool = fakeTool('recall');
    registry.register(tool);
    const result = await executeCompanionTool('recall', { key: 'test' }, {
      identity, env, registry,
    });
    expect(result.success).toBe(true);
    expect(tool.execute).toHaveBeenCalledOnce();
  });
});
