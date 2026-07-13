import { describe, it, expect, vi, afterEach } from 'vitest';

import { safeFetch } from '../../src/security/safe-fetch.js';

/**
 * Regression guard for the SSRF-redirect bypass: assertSafeUrl only validated the
 * INITIAL url, so a public URL that 302-redirects to a metadata/loopback IP sailed
 * through. safeFetch re-validates every hop. IP literals are used as start URLs so
 * the test is hermetic (no DNS): 8.8.8.8 / 1.1.1.1 are public (safe), 169.254.169.254
 * is link-local and 127.0.0.1 is loopback (both refused).
 */
describe('safeFetch — SSRF redirect protection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a 302 redirect to the cloud-metadata IP and never fetches it', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(safeFetch('http://8.8.8.8/start')).rejects.toThrow(/SSRF protection/);
    // Only the initial (public) URL was requested; the metadata URL was refused pre-fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://8.8.8.8/start',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('refuses a 301 redirect to loopback (127.0.0.1)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'http://127.0.0.1:8080/admin' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(safeFetch('http://8.8.8.8/x')).rejects.toThrow(/SSRF protection/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a safe redirect to another public IP and returns the final response', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://8.8.8.8/a') {
        return new Response(null, { status: 302, headers: { location: 'http://1.1.1.1/b' } });
      }
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await safeFetch('http://8.8.8.8/a');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not follow redirects when followRedirects is false', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://1.1.1.1/b' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await safeFetch('http://8.8.8.8/a', {}, { followRedirects: false });
    expect(res.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
