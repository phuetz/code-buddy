/**
 * Serve real HTML pages over a loopback HTTP server whose origin is
 * registered as a dev origin — the same sanctioned path the app_server tool
 * uses. Replaces the old `data:text/html` fixtures, which the navigation
 * guard now rightly blocks (a data: page's scripts could fetch internal
 * services and leak them via get_content).
 */
import http from 'http';
import type { AddressInfo } from 'net';

import { registerDevOrigin, unregisterDevOrigin } from '../../src/security/dev-origins.js';

export interface TestPageServer {
  /** Base URL, e.g. http://127.0.0.1:41233 — root path serves the (first) page. */
  url: string;
  close(): Promise<void>;
}

/**
 * @param pages Either a single HTML document (served at `/`) or a map of
 *              path → HTML (paths must start with `/`; `/` recommended).
 */
export async function serveTestPages(pages: string | Record<string, string>): Promise<TestPageServer> {
  const routes: Record<string, string> = typeof pages === 'string' ? { '/': pages } : pages;
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const html = routes[path];
    if (html === undefined) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const registration = registerDevOrigin(url);
  if (!registration.ok) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error(`Failed to register test page origin: ${registration.error}`);
  }

  return {
    url,
    async close() {
      unregisterDevOrigin(url);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
