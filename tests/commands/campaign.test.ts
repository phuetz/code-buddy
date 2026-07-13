import { describe, expect, it, vi } from 'vitest';
import { createCampaignCommand, type CampaignToolCaller } from '../../src/commands/campaign.js';

function caller(): CampaignToolCaller & { call: ReturnType<typeof vi.fn> } {
  return { call: vi.fn().mockResolvedValue({ ok: true }) };
}

describe('campaign command', () => {
  it('creates a PubCommander draft through the native facade', async () => {
    const fake = caller();
    const command = createCampaignCommand(fake);
    await command.parseAsync([
      'node', 'campaign', 'draft', '--content', 'Mon nouveau roman',
      '--platforms', 'linkedin,instagram', '--hashtags', 'livre,roman',
    ]);
    expect(fake.call).toHaveBeenCalledWith('core', 'create_draft_post', {
      content: 'Mon nouveau roman',
      platforms: ['linkedin', 'instagram'],
      hashtags: ['livre', 'roman'],
    });
  });

  it('browses the editorial library', async () => {
    const fake = caller();
    const command = createCampaignCommand(fake);
    await command.parseAsync(['node', 'campaign', 'library', 'viral', '--search', 'thriller']);
    expect(fake.call).toHaveBeenCalledWith('editorial', 'browse_editorial_library', {
      kind: 'viral',
      limit: 20,
      search: 'thriller',
    });
  });

  it('keeps submission separate from approval and publication', async () => {
    const fake = caller();
    const command = createCampaignCommand(fake);
    await command.parseAsync(['node', 'campaign', 'submit', 'post-123']);
    expect(fake.call).toHaveBeenCalledOnce();
    expect(fake.call).toHaveBeenCalledWith('core', 'submit_post_for_approval', { postId: 'post-123' });
  });
});
