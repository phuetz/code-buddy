/**
 * Origin / host safety helpers for the HTTP + WebSocket server.
 *
 * `isOriginAllowed` lives in a dependency-free leaf module shared by the REST
 * server, both WebSocket handlers, and the Gateway transport without creating
 * an import cycle.
 */

/** Default CORS / WS origins: localhost on any port (matches the Gateway default). */
export const DEFAULT_LOCALHOST_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*'];

const ORIGIN_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\*|\d+))?$/i;
const CONCRETE_ORIGIN = /^([a-z][a-z0-9+.-]*):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?$/i;

function matchesWildcardOrigin(origin: string, pattern: string): boolean {
  const expected = ORIGIN_PATTERN.exec(pattern);
  const candidate = CONCRETE_ORIGIN.exec(origin);
  if (!expected || !candidate) return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return false;
  }
  if (expected[1]!.toLowerCase() !== candidate[1]!.toLowerCase()) return false;

  const hostnamePattern = expected[2]!
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[a-z0-9.-]*');
  if (!new RegExp(`^${hostnamePattern}$`, 'i').test(parsed.hostname)) return false;

  const expectedPort = expected[3];
  const candidatePort = candidate[3];
  return expectedPort === '*' ? candidatePort !== undefined : expectedPort === candidatePort;
}

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
      if (matchesWildcardOrigin(origin, pattern)) return true;
    }
  }
  return false;
}

/** True for loopback binds where network exposure is not a concern. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  return octets[0] === 127 && octets.every((octet) => octet >= 0 && octet <= 255);
}
