import { describe, expect, it } from 'vitest';
import { fetchLinkPreview, _resetLinkPreviewCacheForTests } from '../../src/server/mobile/link-preview.js';

describe('mobile link preview (lot 5)', () => {
  it('parses og:title and description from injected HTML', async () => {
    _resetLinkPreviewCacheForTests();
    const preview = await fetchLinkPreview('https://example.com/page', {
      fetchHtml: async () =>
        '<html><head><meta property="og:title" content="Hello"><meta property="og:description" content="World"><title>x</title></head></html>',
    });
    expect(preview).toMatchObject({ title: 'Hello', description: 'World' });
  });

  it('rejects a non-http URL', async () => {
    const result = await fetchLinkPreview('file:///etc/passwd');
    expect(result).toMatchObject({ status: 400 });
  });
});
