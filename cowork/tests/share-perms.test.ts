import { describe, expect, it } from 'vitest';

import { buildShareLink, validatePerms } from '../src/renderer/utils/share-perms';

describe('buildShareLink', () => {
  it('builds a stable local share URL', () => {
    expect(buildShareLink('item 1', { access: 'read', allowDownload: false, expiresAt: 1000 })).toBe(
      '/share/item%201?access=read&download=false&expires=1000'
    );
  });
});

describe('validatePerms', () => {
  it('accepts valid permissions', () => {
    expect(validatePerms({ access: 'write', allowDownload: true, expiresAt: 2_000 }, 1_000)).toEqual({ ok: true });
  });

  it('rejects past expirations', () => {
    expect(validatePerms({ access: 'read', allowDownload: true, expiresAt: 500 }, 1_000)).toEqual({
      ok: false,
      error: 'expiry_in_past',
    });
  });
});
