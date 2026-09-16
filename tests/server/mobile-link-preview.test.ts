import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import {
  fetchLinkPreview,
  readCappedText,
  MAX_LINK_PREVIEW_BYTES,
  LINK_PREVIEW_CACHE_MAX,
  _resetLinkPreviewCacheForTests,
} from '../../src/server/mobile/link-preview.js';

describe('mobile link preview (lot 5)', () => {
  afterEach(() => {
    _resetLinkPreviewCacheForTests();
  });

  it('parses og:title and description from injected HTML', async () => {
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

  it('reads at most 256 KiB from a 5 MiB local response and stops the stream', async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const total = 5 * 1024 * 1024;
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      let sent = 0;
      const pump = (): void => {
        while (sent < total) {
          const ok = res.write(chunk);
          sent += chunk.length;
          if (!ok) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });
    const serverReady = await new Promise<http.Server>((resolve) => {
      const s = server.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const address = serverReady.address();
      if (!address || typeof address === 'string') throw new Error('expected port');
      const res = await fetch(`http://127.0.0.1:${address.port}/`);
      const { text, bytesRead } = await readCappedText(res);
      expect(bytesRead).toBeLessThanOrEqual(MAX_LINK_PREVIEW_BYTES);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_LINK_PREVIEW_BYTES);
      expect(MAX_LINK_PREVIEW_BYTES).toBe(256 * 1024);
    } finally {
      await new Promise<void>((resolve, reject) => {
        serverReady.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('evicts the oldest cache entry once 200 URLs are stored', async () => {
    expect(LINK_PREVIEW_CACHE_MAX).toBe(200);
    for (let i = 0; i < LINK_PREVIEW_CACHE_MAX; i += 1) {
      await fetchLinkPreview(`https://example.com/p${i}`, {
        fetchHtml: async () => `<title>t${i}</title>`,
      });
    }
    await fetchLinkPreview('https://example.com/p-new', {
      fetchHtml: async () => '<title>new</title>',
    });
    let fetched = 0;
    await fetchLinkPreview('https://example.com/p0', {
      fetchHtml: async () => {
        fetched += 1;
        return '<title>again</title>';
      },
    });
    expect(fetched).toBe(1);
    fetched = 0;
    await fetchLinkPreview('https://example.com/p-new', {
      fetchHtml: async () => {
        fetched += 1;
        return '<title>should-be-cached</title>';
      },
    });
    expect(fetched).toBe(0);
  });
});
