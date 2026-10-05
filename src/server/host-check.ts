/**
 * Host-header allowlist (DNS-rebinding defense) and Origin access-control helpers.
 *
 * Browsers can resolve an attacker-controlled name to 127.0.0.1 while sending
 * `Host: evil.example`. Without a Host allowlist, loopback `--no-auth` surfaces
 * become remote command execution. CORS alone does not stop side effects.
 */

export function normalizeHostHeader(
  raw: string | undefined,
): { hostname: string; port: string | undefined } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end <= 1) return null;
    const hostname = trimmed.slice(1, end).toLowerCase();
    const rest = trimmed.slice(end + 1);
    if (!rest) return { hostname, port: undefined };
    if (!rest.startsWith(':')) return null;
    const port = rest.slice(1);
    if (!/^\d{1,5}$/.test(port)) return null;
    return { hostname, port };
  }

  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon > 0 && /^\d{1,5}$/.test(trimmed.slice(lastColon + 1))) {
    return {
      hostname: trimmed.slice(0, lastColon).toLowerCase().replace(/\.$/, ''),
      port: trimmed.slice(lastColon + 1),
    };
  }
  return { hostname: trimmed.toLowerCase().replace(/\.$/, ''), port: undefined };
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  return octets[0] === 127 && octets.every((octet) => octet >= 0 && octet <= 255);
}

export function buildDefaultAllowedHosts(options: {
  bindHost?: string;
  extra?: string[];
}): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '::1']);
  const bind = (options.bindHost ?? '127.0.0.1').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (bind && bind !== '0.0.0.0' && bind !== '::') {
    hosts.add(bind);
  }
  for (const extra of options.extra ?? []) {
    const n = normalizeHostHeader(extra);
    if (n) hosts.add(n.hostname);
  }
  return [...hosts];
}

/**
 * True when Host is loopback or on the explicit allowlist, and the port (if
 * present) matches the listen port.
 */
export function isHostAllowed(
  hostHeader: string | undefined,
  allowedHosts: string[],
  listenPort?: number,
): boolean {
  const parsed = normalizeHostHeader(hostHeader);
  if (!parsed) return false;

  const allowed = new Set(
    allowedHosts
      .map((h) => h.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, ''))
      .filter(Boolean),
  );

  const hostnameOk = allowed.has(parsed.hostname) || isLoopbackHostname(parsed.hostname);
  if (!hostnameOk) return false;

  if (parsed.port !== undefined && listenPort !== undefined) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum !== listenPort) return false;
  }
  return true;
}

/** Paths that keep CORS-only Origin behavior (no HTTP 403 on foreign Origin). */
export function isOriginExemptPublicPath(path: string): boolean {
  const p = (path.split('?')[0] || path);
  if (p === '/api/a2a/.well-known/agent.json') return true;
  if (p.startsWith('/api/health')) return true;
  if (p.startsWith('/api/metrics') || p.startsWith('/metrics')) return true;
  if (p === '/healthz' || p === '/readyz' || p === '/livez') return true;
  if (p.startsWith('/api/auth/device')) return true;
  if (p.startsWith('/__codebuddy__/mobile')) return true;
  return false;
}

/**
 * True when the browser `Origin` names the same host:port as the (already
 * allowlisted) `Host` header: the page was served by this server. Must only be
 * used behind the Host allowlist. Scheme is not compared.
 */
export function isSameOriginAsHost(origin: string, hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return new URL(origin).host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}
