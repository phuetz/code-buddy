/**
 * Origin / host safety helpers for the HTTP + WebSocket server.
 *
 * `isOriginAllowed` mirrors the Gateway's check (src/gateway/ws-transport.ts) but
 * lives in a dependency-free leaf module so both the REST server (src/server/index.ts)
 * and the WS handler (src/server/websocket/handler.ts) can share it without importing
 * the gateway — avoiding an import cycle.
 */

/** Default CORS / WS origins: localhost on any port (matches the Gateway default). */
export const DEFAULT_LOCALHOST_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*'];

/**
 * Returns true if `origin` matches one of `allowedOrigins`. Supports `*` (any),
 * exact match, and wildcard patterns such as `http://localhost:*`.
 * An empty/undefined origin returns false — callers that want to permit
 * non-browser clients (which send no Origin header) must handle that case first.
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  for (const pattern of allowedOrigins) {
    if (pattern === '*') return true;
    if (pattern === origin) return true;
    if (pattern.includes('*')) {
      const escaped: string = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (new RegExp(`^${escaped}$`).test(origin)) return true;
    }
  }
  return false;
}

/** True for loopback binds where network exposure is not a concern. */
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
