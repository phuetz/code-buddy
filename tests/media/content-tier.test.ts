import { describe, expect, it } from 'vitest';

import {
  CONTENT_TIERS,
  isContentTier,
  isPrivateTier,
  type ContentTier,
} from '../../src/media/content-tier.js';
import type { ContentTier as RouterContentTier } from '../../src/tools/video/hybrid-video-router.js';

describe('content-tier canonical source', () => {
  it('enumerates the three tiers from safe to explicit', () => {
    expect(CONTENT_TIERS).toEqual(['safe', 'sensual', 'explicit']);
  });

  it('narrows untrusted values fail-closed', () => {
    expect(isContentTier('safe')).toBe(true);
    expect(isContentTier('explicit')).toBe(true);
    expect(isContentTier('SAFE')).toBe(false);
    expect(isContentTier('nsfw')).toBe(false);
    expect(isContentTier(undefined)).toBe(false);
    expect(isContentTier(3)).toBe(false);
  });

  it('treats everything but safe as private', () => {
    expect(isPrivateTier('safe')).toBe(false);
    expect(isPrivateTier('sensual')).toBe(true);
    expect(isPrivateTier('explicit')).toBe(true);
  });

  it('stays structurally compatible with the router re-export', () => {
    // If the router re-export drifts from the canonical type this fails to compile.
    const canonical: ContentTier = 'sensual';
    const viaRouter: RouterContentTier = canonical;
    expect(viaRouter).toBe('sensual');
  });
});
