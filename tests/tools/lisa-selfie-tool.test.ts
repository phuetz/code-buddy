import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('../../src/companion/lisa-selfie.js', () => ({
  createAndMaybeSendLisaSelfie: hoisted.create,
}));

import { LisaSelfieTool } from '../../src/tools/registry/multimodal-tools.js';

describe('LisaSelfieTool content tier', () => {
  beforeEach(() => {
    hoisted.create.mockReset();
    hoisted.create.mockResolvedValue({
      success: true,
      prompt: 'prompt',
      trigger: 'ohwx lisa',
      telegramSent: false,
      spokenReply: 'prête',
    });
  });

  it('publishes the bounded content-tier schema', () => {
    const property = LisaSelfieTool.prototype.getSchema.call(new LisaSelfieTool())
      .parameters.properties?.content_tier;
    expect(property).toMatchObject({
      type: 'string',
      enum: ['safe', 'sensual', 'explicit'],
    });
  });

  it('passes sensual through to the selfie generator', async () => {
    const tool = new LisaSelfieTool({ rootDir: '/tmp/codebuddy-lisa-test' });
    const result = await tool.execute({ mood: 'bold', content_tier: 'sensual' });

    expect(result.success).toBe(true);
    expect(hoisted.create).toHaveBeenCalledWith(expect.objectContaining({
      mood: 'bold',
      contentTier: 'sensual',
    }));
  });

  it('fails unknown tier values closed to safe', async () => {
    const tool = new LisaSelfieTool({ rootDir: '/tmp/codebuddy-lisa-test' });
    await tool.execute({ content_tier: 'unrestricted' });

    expect(hoisted.create).toHaveBeenCalledWith(expect.objectContaining({
      contentTier: 'safe',
    }));
  });
});
